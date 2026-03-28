-- SoundBridg Schema v2 — Run in Supabase SQL Editor
-- Safe to run multiple times (IF NOT EXISTS everywhere)

-- Users (original columns preserved)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_hash') THEN
    ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN
    ALTER TABLE users ADD COLUMN username TEXT UNIQUE;
  END IF;
END $$;

-- Tracks table (replaces separate projects + conversions for the new sync model)
CREATE TABLE IF NOT EXISTS tracks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  original_file_key TEXT NOT NULL,
  original_file_size BIGINT NOT NULL DEFAULT 0,
  format TEXT NOT NULL DEFAULT 'mp3' CHECK (format IN ('mp3', 'wav', 'both')),
  mp3_file_key TEXT,
  mp3_file_size BIGINT,
  wav_file_key TEXT,
  wav_file_size BIGINT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  synced_from_device TEXT DEFAULT 'web',
  shareable_token TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks(user_id);
CREATE INDEX IF NOT EXISTS idx_tracks_shareable_token ON tracks(shareable_token);
CREATE INDEX IF NOT EXISTS idx_tracks_name ON tracks(user_id, name);

-- Keep legacy tables alive (old data still accessible)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  format TEXT NOT NULL CHECK (format IN ('mp3', 'wav')),
  file_key TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies for tracks
ALTER TABLE tracks ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "tracks_all" ON tracks FOR ALL USING (true) WITH CHECK (true);

-- Refresh PostgREST schema cache
NOTIFY pgrst, 'reload schema';

SELECT 'Migration v2 complete — tracks table ready' AS status;
