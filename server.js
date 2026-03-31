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
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';

dotenv.config();

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const JWT_SECRET = process.env.JWT_SECRET;
const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024;

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
    console.warn(`CORS: "${origin}" not in list, allowing`);
    return cb(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Multer — accept audio AND .flp files
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.aiff', '.flp'];
    const allowedMime = [
      'audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/ogg',
      'audio/aiff', 'application/octet-stream',
    ];
    if (allowed.includes(ext) || allowedMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not accepted: ${ext}`));
    }
  },
});

// ── Helpers ─────────────────────────────────────────────────────────────────
function signToken(user) {
  return jwt.sign({ id: user.id, email: user.email, username: user.username }, JWT_SECRET, { expiresIn: '30d' });
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
async function getSignedR2Url(key, expiresIn = 3600) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn });
}
async function getSignedDownloadUrl(key, filename) {
  return getSignedUrl(r2, new GetObjectCommand({
    Bucket: R2_BUCKET, Key: key,
    ResponseContentDisposition: `attachment; filename="${filename}"`,
  }), { expiresIn: 3600 });
}

async function cleanup(p) { try { await fs.unlink(p); } catch {} }

function detectFormat(filename) {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const map = { flp: 'flp', mp3: 'mp3', wav: 'wav', flac: 'flac', m4a: 'm4a', ogg: 'ogg', aiff: 'aiff' };
  return map[ext] || 'unknown';
}

function contentTypeFromExt(ext) {
  const map = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.aiff': 'audio/aiff',
    '.flp': 'application/octet-stream',
  };
  return map[ext] || 'application/octet-stream';
}

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/health', (_req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════════════════════════
// AUTH — signup, login, register, me
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/auth/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { data: existing } = await supabase.from('users').select('id').eq('email', email).limit(1);
    if (existing?.length > 0) return res.status(409).json({ error: 'Email already registered' });

    const id = uuidv4();
    const username = name || email.split('@')[0];
    const { error } = await supabase.from('users').insert({
      id, email, username, password_hash: await bcrypt.hash(password, 10),
    });
    if (error) return res.status(500).json({ error: `Database error: ${error.message}` });

    const user = { id, email, username };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, username } = req.body;
    if (!email || !password || !username)
      return res.status(400).json({ error: 'Email, password, and username required' });
    if (password.length < 8)
      return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const { data: existing } = await supabase.from('users').select('id')
      .or(`email.eq.${email},username.eq.${username}`).limit(1);
    if (existing?.length > 0) return res.status(409).json({ error: 'Email or username taken' });

    const id = uuidv4();
    const { error } = await supabase.from('users').insert({
      id, email, username, password_hash: await bcrypt.hash(password, 10),
    });
    if (error) return res.status(500).json({ error: `Database error: ${error.message}` });

    const user = { id, email, username };
    res.status(201).json({ token: signToken(user), user });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('users')
      .select('id, email, username, created_at')
      .eq('id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'User not found' });
    res.json(data[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// TRACKS — upload with sync_group support (replace-on-upload)
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/tracks/upload', authMiddleware, upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const trackId = uuidv4();
    const ext = path.extname(req.file.originalname).toLowerCase() || '.mp3';
    const title = req.body.title || path.parse(req.file.originalname).name;
    const filename = `${title}${ext}`;
    const format = detectFormat(filename);
    const r2Key = `${req.user.id}/${trackId}-${filename}`;
    const contentType = contentTypeFromExt(ext);

    // Sync group: use provided value or derive from title
    const syncGroup = req.body.sync_group || title;
    const isOriginal = req.body.is_original === 'true' || req.body.is_original === true || format === 'flp';
    const convertedFrom = req.body.converted_from || null;

    // ── Replace logic: delete old file with same sync_group + format ──
    const { data: existing } = await supabase.from('tracks')
      .select('id, r2_key')
      .eq('user_id', req.user.id)
      .eq('sync_group', syncGroup)
      .eq('format', format);

    if (existing?.length > 0) {
      for (const old of existing) {
        console.log(`[Replace] Deleting old ${format} for sync_group "${syncGroup}": ${old.id}`);
        await deleteFromR2(old.r2_key);
        await supabase.from('tracks').delete().eq('id', old.id);
      }
    }

    // ── Upload to R2 ──
    const fileBuffer = await fs.readFile(tmpPath);
    await uploadToR2(r2Key, fileBuffer, contentType);

    // ── Save to Supabase ──
    const record = {
      id: trackId,
      user_id: req.user.id,
      title,
      filename,
      r2_key: r2Key,
      size: req.file.size,
      duration: req.body.duration ? parseFloat(req.body.duration) : null,
      daw: req.body.daw || 'FL Studio',
      bpm: req.body.bpm ? parseInt(req.body.bpm) : null,
      tags: req.body.tags || null,
      source: req.body.source || 'web',
      shareable_token: null,
      sync_group: syncGroup,
      is_original: isOriginal,
      converted_from: convertedFrom,
      format,
    };

    const { error: dbErr } = await supabase.from('tracks').insert(record);
    if (dbErr) return res.status(500).json({ error: `Database error: ${dbErr.message}` });

    res.status(201).json({
      id: trackId,
      title,
      filename,
      size: req.file.size,
      sync_group: syncGroup,
      format,
      is_original: isOriginal,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: `Upload failed: ${err.message}` });
  } finally {
    if (tmpPath) await cleanup(tmpPath);
  }
});

// List tracks — returns all tracks, frontend groups by sync_group
app.get('/api/tracks', authMiddleware, async (req, res) => {
  try {
    const { sort = 'newest', q, daw, period } = req.query;
    let query = supabase.from('tracks').select('*').eq('user_id', req.user.id);

    if (q?.trim()) query = query.ilike('title', `%${q.trim()}%`);
    if (daw && daw !== 'all') query = query.eq('daw', daw);

    if (period === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', weekAgo);
    } else if (period === 'month') {
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte('created_at', monthAgo);
    }

    switch (sort) {
      case 'oldest': query = query.order('created_at', { ascending: true }); break;
      case 'a-z':    query = query.order('title', { ascending: true }); break;
      case 'z-a':    query = query.order('title', { ascending: false }); break;
      default:       query = query.order('created_at', { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('Fetch tracks error:', err);
    res.status(500).json({ error: 'Failed to fetch tracks' });
  }
});

// Get tracks grouped by sync_group
app.get('/api/tracks/grouped', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by sync_group
    const groups = {};
    for (const track of (data || [])) {
      const sg = track.sync_group || track.title;
      if (!groups[sg]) {
        groups[sg] = { sync_group: sg, files: [], updated_at: track.created_at };
      }
      groups[sg].files.push(track);
      // Keep newest updated_at
      if (track.created_at > groups[sg].updated_at) {
        groups[sg].updated_at = track.created_at;
      }
    }

    // Sort groups by newest first
    const sorted = Object.values(groups).sort((a, b) =>
      new Date(b.updated_at) - new Date(a.updated_at)
    );

    res.json(sorted);
  } catch (err) {
    console.error('Grouped tracks error:', err);
    res.status(500).json({ error: 'Failed to fetch grouped tracks' });
  }
});

// Get files by sync_group name
app.get('/api/tracks/by-sync-group/:syncGroup', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('*')
      .eq('user_id', req.user.id)
      .eq('sync_group', req.params.syncGroup)
      .order('is_original', { ascending: false });

    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Sync group not found' });

    // Add signed URLs
    const files = await Promise.all(data.map(async (t) => ({
      ...t,
      stream_url: t.format !== 'flp' ? await getSignedR2Url(t.r2_key) : null,
      download_url: await getSignedDownloadUrl(t.r2_key, t.filename),
    })));

    res.json({ sync_group: req.params.syncGroup, files });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sync group' });
  }
});

// Delete entire sync group
app.delete('/api/sync-group/:syncGroup', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('id, r2_key')
      .eq('user_id', req.user.id)
      .eq('sync_group', req.params.syncGroup);

    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Sync group not found' });

    // Delete all files from R2
    for (const track of data) {
      await deleteFromR2(track.r2_key);
    }

    // Delete all DB records
    await supabase.from('tracks').delete()
      .eq('user_id', req.user.id)
      .eq('sync_group', req.params.syncGroup);

    res.json({ message: `Deleted sync group "${req.params.syncGroup}" (${data.length} files)` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sync group' });
  }
});

// Stream — returns signed URL for audio playback
app.get('/api/tracks/:id/stream', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('r2_key, title, filename, format')
      .eq('id', req.params.id).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    if (data[0].format === 'flp') {
      return res.status(400).json({ error: 'Cannot stream .flp files — download only' });
    }

    const url = await getSignedR2Url(data[0].r2_key);
    res.json({ stream_url: url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get stream URL' });
  }
});

// Download
app.get('/api/tracks/:id/download', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('r2_key, filename')
      .eq('id', req.params.id).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    const url = await getSignedDownloadUrl(data[0].r2_key, data[0].filename);
    res.json({ download_url: url, filename: data[0].filename });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get download URL' });
  }
});

// Delete single track
app.delete('/api/tracks/:id', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('r2_key')
      .eq('id', req.params.id).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    await deleteFromR2(data[0].r2_key);
    await supabase.from('tracks').delete().eq('id', req.params.id);
    res.json({ message: 'Track deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete track' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SHARE
// ══════════════════════════════════════════════════════════════════════════════

app.post('/api/tracks/:id/share', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('shareable_token')
      .eq('id', req.params.id).eq('user_id', req.user.id).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    let token = data[0].shareable_token;
    if (!token) {
      token = crypto.randomBytes(16).toString('hex');
      await supabase.from('tracks').update({ shareable_token: token }).eq('id', req.params.id);
    }

    const base = (process.env.FRONTEND_URL || 'http://localhost:3000').split(',')[0].trim();
    res.json({ token, share_url: `${base}/shared/${token}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to share track' });
  }
});

app.get('/api/shared/:token', async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('id, title, filename, r2_key, size, duration, daw, bpm, format, sync_group, created_at')
      .eq('shareable_token', req.params.token).limit(1);
    if (error) throw error;
    if (!data?.length) return res.status(404).json({ error: 'Track not found' });

    const t = data[0];
    const stream_url = t.format !== 'flp' ? await getSignedR2Url(t.r2_key) : null;
    const download_url = await getSignedDownloadUrl(t.r2_key, t.filename);
    res.json({ ...t, r2_key: undefined, stream_url, download_url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load shared track' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// STORAGE INFO
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/storage-info', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks').select('size').eq('user_id', req.user.id);
    if (error) throw error;

    const used = (data || []).reduce((s, t) => s + (t.size || 0), 0);
    res.json({
      used_bytes: used,
      limit_bytes: STORAGE_LIMIT_BYTES,
      used_pct: Math.round((used / STORAGE_LIMIT_BYTES) * 10000) / 100,
      track_count: data?.length || 0,
      warning: used > STORAGE_LIMIT_BYTES * 0.9,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get storage info' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Polling helper — returns latest updated_at for change detection
// ══════════════════════════════════════════════════════════════════════════════

app.get('/api/tracks/latest-timestamp', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.from('tracks')
      .select('created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    res.json({ latest: data?.[0]?.created_at || null, count: 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Error handler ───────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'File too large (500 MB max)' });
  console.error('Unhandled:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => console.log(`SoundBridg API on :${PORT} [${NODE_ENV}]`));
