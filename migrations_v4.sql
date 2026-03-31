-- SoundBridg v4 Migration — Sync Groups
-- Run this in Supabase SQL Editor AFTER the v3 migration has been applied.
-- Safe to run multiple times.

-- Add sync_group columns to tracks
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracks' AND column_name='sync_group') THEN
    ALTER TABLE tracks ADD COLUMN sync_group VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracks' AND column_name='is_original') THEN
    ALTER TABLE tracks ADD COLUMN is_original BOOLEAN DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracks' AND column_name='converted_from') THEN
    ALTER TABLE tracks ADD COLUMN converted_from VARCHAR(255);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tracks' AND column_name='format') THEN
    ALTER TABLE tracks ADD COLUMN format VARCHAR(20);
  END IF;
END $$;

-- Backfill: existing tracks get sync_group derived from title
UPDATE tracks SET sync_group = title WHERE sync_group IS NULL;

-- Backfill: detect format from filename extension
UPDATE tracks SET format = CASE
  WHEN filename ILIKE '%.mp3' THEN 'mp3'
  WHEN filename ILIKE '%.wav' THEN 'wav'
  WHEN filename ILIKE '%.flac' THEN 'flac'
  WHEN filename ILIKE '%.m4a' THEN 'm4a'
  WHEN filename ILIKE '%.flp' THEN 'flp'
  ELSE 'unknown'
END WHERE format IS NULL;

-- Index for fast sync_group lookups
CREATE INDEX IF NOT EXISTS idx_tracks_sync_group ON tracks(user_id, sync_group);

-- Refresh PostgREST cache
NOTIFY pgrst, 'reload schema';

SELECT 'SoundBridg v4 (sync groups) migration complete' AS status;
