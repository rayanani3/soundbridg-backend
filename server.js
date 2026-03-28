import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const FFMPEG_PATH = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ── Cloudflare R2 (S3-compatible) ───────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_KEY,
  },
});
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET;

// ── Express App ─────────────────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
// CORS – allow FRONTEND_URL origins (comma-separated) + localhost for dev
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((u) => u.trim().replace(/\/+$/, '')); // strip trailing slashes

console.log('CORS allowed origins:', allowedOrigins);

app.use(
  cors({
    origin(origin, callback) {
      // Allow requests with no origin (health checks, curl, mobile)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      // Log but still allow — prevents 500 on preflight while debugging
      console.warn(`CORS: origin "${origin}" not in allowedOrigins, allowing anyway`);
      return callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Multer – store uploads in OS temp dir
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/octet-stream',
      'application/x-fl-studio',
      'audio/mpeg',
      'audio/wav',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.flp')) {
      cb(null, true);
    } else {
      cb(new Error('Only .flp, .mp3, and .wav files are allowed'));
    }
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid' });
  }
}

async function uploadToR2(key, body, contentType = 'application/octet-stream') {
  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

async function deleteFromR2(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

async function getR2DownloadUrl(key) {
  const command = new GetObjectCommand({ Bucket: R2_BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn: 3600 }); // 1 hour
}

async function cleanupFile(filePath) {
  try {
    await fs.unlink(filePath);
  } catch {
    /* ignore */
  }
}

// ── HEALTH CHECK ────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── AUTH ROUTES ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username) {
      return res.status(400).json({ error: 'Email, password, and username are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check existing
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .or(`email.eq.${email},username.eq.${username}`)
      .limit(1);

    if (existing && existing.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const id = uuidv4();
    const hashedPassword = await bcrypt.hash(password, 10);

    const { error: insertError } = await supabase.from('users').insert({
      id,
      email,
      username,
      password: hashedPassword,
    });

    if (insertError) throw insertError;

    const user = { id, email, username };
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .limit(1);

    if (error) throw error;
    if (!users || users.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = users[0];
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const payload = { id: user.id, email: user.email, username: user.username };
    const token = signToken(payload);
    res.json({ token, user: payload });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ── PROJECT ROUTES ──────────────────────────────────────────────────────────

app.post('/api/projects/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const projectId = uuidv4();
    const originalName = req.file.originalname;
    const name = path.parse(originalName).name;
    const fileKey = `projects/${req.user.id}/${projectId}_${originalName}`;

    const fileBuffer = await fs.readFile(tmpPath);
    await uploadToR2(fileKey, fileBuffer);

    const { error: dbError } = await supabase.from('projects').insert({
      id: projectId,
      user_id: req.user.id,
      name,
      file_key: fileKey,
      file_size: req.file.size,
    });

    if (dbError) throw dbError;

    res.status(201).json({
      id: projectId,
      name,
      fileSize: req.file.size,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'Failed to upload project' });
  } finally {
    if (tmpPath) await cleanupFile(tmpPath);
  }
});

app.get('/api/projects', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Fetch projects error:', err);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

app.get('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.json(data[0]);
  } catch (err) {
    console.error('Fetch project error:', err);
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

app.delete('/api/projects/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .limit(1);

    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await deleteFromR2(data[0].file_key);

    const { error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Failed to delete project' });
  }
});

// ── CONVERSION ROUTES ───────────────────────────────────────────────────────

async function handleConversion(req, res, format) {
  const tmpInput = req.file?.path;
  const ext = format === 'mp3' ? 'mp3' : 'wav';
  const tmpOutput = path.join(os.tmpdir(), `${uuidv4()}_output.${ext}`);

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    // Build FFmpeg arguments
    const args = ['-i', tmpInput, '-y'];
    if (format === 'mp3') {
      args.push('-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2');
    } else {
      args.push('-codec:a', 'pcm_s24le', '-ar', '44100', '-ac', '2');
    }
    args.push(tmpOutput);

    await execFileAsync(FFMPEG_PATH, args, { timeout: 300_000 });

    const conversionId = uuidv4();
    const fileKey = `conversions/${req.user.id}/${conversionId}_output.${ext}`;
    const outputBuffer = await fs.readFile(tmpOutput);
    const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    await uploadToR2(fileKey, outputBuffer, contentType);

    const fileStat = await fs.stat(tmpOutput);

    const { error: dbError } = await supabase.from('conversions').insert({
      id: conversionId,
      user_id: req.user.id,
      project_id: null,
      format: ext,
      file_key: fileKey,
      file_size: fileStat.size,
    });

    if (dbError) throw dbError;

    const downloadUrl = await getR2DownloadUrl(fileKey);

    res.json({
      id: conversionId,
      format: ext,
      fileSize: fileStat.size,
      downloadUrl,
    });
  } catch (err) {
    console.error(`Convert to ${format} error:`, err);
    res.status(500).json({ error: `Failed to convert to ${format}` });
  } finally {
    if (tmpInput) await cleanupFile(tmpInput);
    await cleanupFile(tmpOutput);
  }
}

app.post('/api/convert/mp3', authMiddleware, upload.single('file'), (req, res) =>
  handleConversion(req, res, 'mp3')
);

app.post('/api/convert/wav', authMiddleware, upload.single('file'), (req, res) =>
  handleConversion(req, res, 'wav')
);

app.get('/api/conversions', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversions')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Generate fresh download URLs
    const withUrls = await Promise.all(
      (data || []).map(async (c) => ({
        ...c,
        downloadUrl: await getR2DownloadUrl(c.file_key),
      }))
    );

    res.json(withUrls);
  } catch (err) {
    console.error('Fetch conversions error:', err);
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});

// ── Error handler for multer ────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File too large. Maximum size is 500 MB.' });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SoundBridg API running on port ${PORT} [${NODE_ENV}]`);
});
