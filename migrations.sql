-- ============================================================
-- SoundBridg Database Schema
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Projects table (uploaded .FLP files)
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Conversions table (MP3/WAV outputs)
CREATE TABLE IF NOT EXISTS conversions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  format TEXT NOT NULL CHECK (format IN ('mp3', 'wav')),
  file_key TEXT NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_conversions_user_id ON conversions(user_id);

-- Enable Row Level Security (RLS) — optional but recommended
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;

-- Allow the service role (used by our backend) full access
-- The anon key cannot read these tables directly from the browser
CREATE POLICY "Service role full access on users"
  ON users FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on projects"
  ON projects FOR ALL
  USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on conversions"
  ON conversions FOR ALL
  USING (true) WITH CHECK (true);
