-- SoundBridg Schema v3 — matches desktop scanner + web app architecture
-- Run in Supabase SQL Editor. Safe to run multiple times.

-- Users
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN
    ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
  END IF;
END $$;

-- Tracks — the core table. One row per synced audio file.
-- Scanner uploads MP3s (already converted from WAV via ffmpeg on Mac).
-- Web app can also upload directly.
CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  duration REAL,                              -- seconds, from ffprobe or scanner
  daw TEXT DEFAULT 'FL Studio',               -- source DAW
  bpm INTEGER,                                -- detected or entered BPM
  tags TEXT,                                   -- comma-separated tags
  source TEXT DEFAULT 'web',                   -- 'scanner' or 'web'
  shareable_token TEXT UNIQUE,                 -- for public share links
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_user_title ON tracks(user_id, title);
CREATE INDEX IF NOT EXISTS idx_tracks_shareable ON tracks(shareable_token);
CREATE INDEX IF NOT EXISTS idx_tracks_created ON tracks(user_id, created_at DESC);

-- RLS — allow all via service role (backend handles auth)
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'tracks_service_all') THEN
    CREATE POLICY tracks_service_all ON tracks FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

SELECT 'SoundBridg v3 migration complete' AS status;
