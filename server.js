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
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const execFileAsync = promisify(execFile);

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const FFMPEG_PATH = process.env.FFMPEG_PATH || '/usr/bin/ffmpeg';
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB

// ── Supabase ────────────────────────────────────────────────────────────────
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// ── Cloudflare R2 ───────────────────────────────────────────────────────────
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_ACCESS_KEY,
    secretAccessKey: process.env.CLOUDFLARE_SECRET_KEY,
  },
});
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET;

// ── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',').map((u) => u.trim().replace(/\/+$/, ''));
console.log('CORS allowed origins:', allowedOrigins);

app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.warn(`CORS: origin "${origin}" not in list, allowing`);
    return cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.flp', '.mp3', '.wav', '.flac'].includes(ext) ||
        ['application/octet-stream', 'audio/mpeg', 'audio/wav'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  try {
    req.user = jwt.verify(h.split(' ')[1], JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Token expired or invalid' }); }
}

async function uploadToR2(key, body, ct = 'application/octet-stream') {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: ct }));
}
async function deleteFromR2(key) {
  try { await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })); } catch {}
}
async function getR2Url(key) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 3600 });
}
async function cleanup(p) { try { await fs.unlink(p); } catch {} }

async function runFFmpeg(input, output, fmt) {
  const args = ['-i', input, '-y'];
  if (fmt === 'mp3') args.push('-codec:a', 'libmp3lame', '-b:a', '192k', '-ar', '44100', '-ac', '2');
  else args.push('-codec:a', 'pcm_s24le', '-ar', '44100', '-ac', '2');
  args.push(output);
  await execFileAsync(FFMPEG_PATH, args, { timeout: 300_000 });
}

// ── HEALTH ──────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username)
      return res.status(400).json({ error: 'Email, password, and username are required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { data: existing } = await supabase.from('users').select('id')
      .or(`email.eq.${email},username.eq.${username}`).limit(1);
    if (existing?.length > 0)
      return res.status(409).json({ error: 'Email or username already taken' });

    const id = uuidv4();
    const { error } = await supabase.from('users').insert({
      id, email, username, password_hash: await bcrypt.hash(password, 10),
    });
    if (error) return res.status(500).json({ error: `Database error: ${error.message}` });

    const user = { id, email, username };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: users, error } = await supabase.from('users').select('*').eq('email', email).limit(1);
    if (error) throw error;
    if (!users?.length) return res.status(401).json({ error: 'Invalid email or password' });

    const user = users[0];
    if (!(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Invalid email or password' });

    const payload = { id: user.id, email: user.email, username: user.username };
    res.json({ token: signToken(payload), user: payload });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// ── TRACKS ──────────────────────────────────────────────────────────────────

// Upload with format selection
app.post('/api/tracks/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  const tmpOutputs = [];
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const format = req.body.format || 'mp3';
    if (!['mp3', 'wav', 'both'].includes(format))
      return res.status(400).json({ error: 'Format must be mp3, wav, or both' });

    const trackId = uuidv4();
    const name = path.parse(req.file.originalname).name;

    // Upload original
    const origKey = `tracks/${req.user.id}/${trackId}/original_${req.file.originalname}`;
    await uploadToR2(origKey, await fs.readFile(tmpPath));

    // Convert
    const fmts = format === 'both' ? ['mp3', 'wav'] : [format];
    const converted = {};

    for (const fmt of fmts) {
      const out = path.join(os.tmpdir(), `${trackId}.${fmt}`);
      tmpOutputs.push(out);
      try {
        await runFFmpeg(tmpPath, out, fmt);
        const buf = await fs.readFile(out);
        const key = `tracks/${req.user.id}/${trackId}/${name}.${fmt}`;
        await uploadToR2(key, buf, fmt === 'mp3' ? 'audio/mpeg' : 'audio/wav');
        const stat = await fs.stat(out);
        converted[fmt] = { file_key: key, file_size: stat.size };
      } catch (e) {
        console.error(`FFmpeg ${fmt} error:`, e.message);
      }
    }

    const record = {
      id: trackId,
      user_id: req.user.id,
      name,
      original_file_key: origKey,
      original_file_size: req.file.size,
      format,
      mp3_file_key: converted.mp3?.file_key || null,
      mp3_file_size: converted.mp3?.file_size || null,
      wav_file_key: converted.wav?.file_key || null,
      wav_file_size: converted.wav?.file_size || null,
      synced_at: new Date().toISOString(),
      synced_from_device: req.body.device || 'web',
    };

    const { error: dbErr } = await supabase.from('tracks').insert(record);
    if (dbErr) return res.status(500).json({ error: `Database error: ${dbErr.message}` });

    const response = { id: trackId, name, format, original_file_size: req.file.size, created_at: new Date().toISOString() };
    if (converted.mp3) { response.mp3_url = await getR2Url(converted.mp3.file_key); response.mp3_file_size = converted.mp3.file_size; }
    if (converted.wav) { response.wav_url = await getR2Url(converted.wav.file_key); response.wav_file_size = converted.wav.file_size; }

    res.status(201).json(response);
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  } finally {
    if (tmpPath) await cleanup(tmpPath);
    for (const p of tmpOutputs) await cleanup(p);
  }
});

// List tracks (sort + search)
app.get('/api/tracks', authMiddleware, async (req, res) => {
  try {
    const { sort = 'newest', q } = req.query;
    let query = supabase.from('tracks').select('*').eq('user_id', req.user.id);

    if (q?.trim()) query = query.ilike('name', `%${q.trim()}%`);

    switch (sort) {
      case 'oldest': query = query.order('created_at', { ascending: true }); break;
      case 'a-z':    query = query.order('name', { ascending: true }); break;
      case 'z-a':    query = query.order('name', { ascending: false }); break;
      default:       query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;

    const withUrls = await Promise.all((data || []).map(async (t) => ({
      ...t,
      mp3_url: t.mp3_file_key ? await getR2Url(t.mp3_file_key) : null,
      wav_url: t.wav_file_key ? await getR2Url(t.wav_file_key) : null,
    })));

    res.json(withUrls);
  } catch (err) {
    console.error('Fetch tracks error:', err);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// Delete track
app.delete('/api/tracks/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('*')
      .eq('id', req.params.id).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    const t = data[0];
    if (t.original_file_key) await deleteFromR2(t.original_file_key);
    if (t.mp3_file_key) await deleteFromR2(t.mp3_file_key);
    if (t.wav_file_key) await deleteFromR2(t.wav_file_key);

    await supabase.from('tracks').delete().eq('id', req.params.id);
    res.json({ message: 'Track deleted' });
  } catch (err) {
    console.error('Delete track error:', err);
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

// Storage info
app.get('/api/storage-info', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('original_file_size, mp3_file_size, wav_file_size')
      .eq('user_id', req.user.id);
    if (error) throw error;

    const used = (data || []).reduce((s, t) =>
      s + (t.original_file_size || 0) + (t.mp3_file_size || 0) + (t.wav_file_size || 0), 0);

    res.json({
      used_bytes: used,
      limit_bytes: STORAGE_LIMIT_BYTES,
      used_pct: Math.round((used / STORAGE_LIMIT_BYTES) * 10000) / 100,
      warning: used > STORAGE_LIMIT_BYTES * 0.9,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get storage info' });
  }
});

// Share — generate shareable link
app.post('/api/share/:trackId', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('*')
      .eq('id', req.params.trackId).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    let token = data[0].shareable_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      await supabase.from('tracks').update({ shareable_token: token }).eq('id', req.params.trackId);
    }

    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim();
    res.json({ shareable_token: token, share_url: `${base}/shared/${token}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate share link' });
  }
});

// Public shared track (no auth)
app.get('/api/shared/:token', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('id, name, format, mp3_file_key, wav_file_key, mp3_file_size, wav_file_size, created_at')
      .eq('shareable_token', req.params.token).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    const t = data[0];
    res.json({
      id: t.id, name: t.name, format: t.format, created_at: t.created_at,
      mp3_file_size: t.mp3_file_size, wav_file_size: t.wav_file_size,
      mp3_url: t.mp3_file_key ? await getR2Url(t.mp3_file_key) : null,
      wav_url: t.wav_file_key ? await getR2Url(t.wav_file_key) : null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shared track' });
  }
});

// Download redirect
app.get('/api/download/:trackId', authMiddleware, async (req, res) => {
  try {
    const fmt = req.query.format || 'mp3';
    const { data, error } = await supabase.from('tracks').select('*')
      .eq('id', req.params.trackId).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    const key = fmt === 'wav' ? data[0].wav_file_key : data[0].mp3_file_key;
    if (!key) return res.status(404).json({ error: `No ${fmt} version available` });

    res.json({ download_url: await getR2Url(key), format: fmt, name: data[0].name });
  } catch (err) {
    res.status(500).json({ error: 'Download failed' });
  }
});

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (500 MB max)' });
  console.error('Unhandled:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`SoundBridg API on :${PORT} [${NODE_ENV}]`));
