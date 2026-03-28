# SoundBridg Backend

Express.js API for FL Studio project sync and audio conversion.

## Quick Start

```bash
npm install
cp .env.example .env   # then fill in your credentials
npm run dev             # starts on http://localhost:5000
```

## Dependencies

| Package | Purpose |
|---------|---------|
| express | Web framework |
| @aws-sdk/client-s3 | Cloudflare R2 uploads/downloads |
| @supabase/supabase-js | PostgreSQL database |
| bcryptjs | Password hashing |
| jsonwebtoken | JWT auth |
| multer | File upload handling |
| helmet | Security headers |
| compression | Response compression |

## Environment Variables

See `.env.example` for all required variables.

## Database Setup

1. Open your Supabase dashboard → SQL Editor
2. Paste and run `migrations.sql`
3. Tables `users`, `projects`, and `conversions` will be created

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | No | Create account |
| POST | /api/auth/login | No | Sign in |
| POST | /api/projects/upload | Yes | Upload .FLP |
| GET | /api/projects | Yes | List projects |
| GET | /api/projects/:id | Yes | Get project |
| DELETE | /api/projects/:id | Yes | Delete project |
| POST | /api/convert/mp3 | Yes | Convert to MP3 |
| POST | /api/convert/wav | Yes | Convert to WAV |
| GET | /api/conversions | Yes | List conversions |
| GET | /api/health | No | Health check |

## Deployment (Render)

1. Push to GitHub
2. New Web Service on Render → connect repo
3. Build command: `npm install`
4. Start command: `npm start`
5. Add all env vars from `.env` in Render dashboard
6. Set `NODE_ENV=production` and `FRONTEND_URL` to your production frontend URL
