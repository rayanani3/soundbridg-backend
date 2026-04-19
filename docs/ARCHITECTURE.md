# SoundBridg — Architectural Integrity Audit (Lens 1)

Snapshot of the system as of 2026-04-18, generated from a read-only pass over all four active repos under `~/Developer/soundbridg/`. This document is descriptive: it describes what the code does today, not what it should do. Refinement decisions should be made against this baseline.

Repos covered:
- `soundbridg-backend/` — Node 18+/Express API, single `server.js` (~555 lines), deployed on Render.
- `soundbridg-frontend/` — React 19 + Vite 8, deployed on Cloudflare (vite-plugin-cloudflare + wrangler). `netlify.toml` also present but stale.
- `soundbridg-desktop/` — Electron 28 tray app (macOS), vanilla HTML/CSS/JS renderer.
- `Built-Apps/soundbridg-mobile/` — Expo 55 / React Native 0.83 / Expo Router, TypeScript.

---

## 1. High-level system diagram

```
                ┌──────────────────────────────────────────────┐
                │                 CLIENTS                      │
                │                                              │
  ┌─────────────┤  Web (React, Cloudflare)                     │
  │             │  Desktop (Electron, macOS menubar)           │
  │             │  Mobile (Expo iOS/Android)                   │
  │             └──────────────────┬───────────────────────────┘
  │                                │  HTTPS + Bearer JWT (30d)
  │                                │  (all three use the same API)
  │                                ▼
  │        ┌─────────────────────────────────────────────────┐
  │        │  Render: soundbridg-backend.onrender.com        │
  │        │  Express 4.x, single process, single server.js  │
  │        │  - /api/auth/*        (bcrypt + HS256 JWT)      │
  │        │  - /api/tracks/*      (CRUD + convert + stream) │
  │        │  - /api/sync-group(s) (grouped queries)         │
  │        │  - /api/folders/*     (hierarchical folders)    │
  │        │  - /api/shared/:tok   (public, no auth)         │
  │        │  - /api/storage-info  & /api/storage-plans      │
  │        └──────┬─────────────────────────────────────┬────┘
  │               │                                     │
  │               │ Postgres (REST)                     │ S3-compatible
  │               ▼                                     ▼
  │      ┌────────────────────┐           ┌────────────────────────┐
  │      │ Supabase Postgres  │           │ Cloudflare R2          │
  │      │ (service-role key) │           │ bucket = soundbridg    │
  │      │                    │           │ keys = <uid>/<tid>-… │
  │      │ users              │           │                        │
  │      │ tracks             │           │ presigned GET URLs     │
  │      │ folders            │           │ (1h TTL) for stream +  │
  │      │                    │           │ download.              │
  │      │ RLS = allow-all    │           └────────────────────────┘
  │      │ (backend enforces) │
  │      └────────────────────┘
  │
  └─── Public share: https://soundbridg.com/shared/<token>
       Served by web client; hits /api/shared/:token (no auth).
```

**Key architectural property:** The Render backend is the single gatekeeper. No client talks to Supabase or R2 directly — everything is brokered through the API, and the server holds the Supabase service-role key and R2 credentials. This is explicitly noted in `soundbridg-mobile/lib/api.ts`.

---

## 2. Backend API — endpoint reference

All endpoints live in `soundbridg-backend/server.js`. Auth-required endpoints read `Authorization: Bearer <jwt>` and reject with 401 otherwise. Request bodies are JSON unless marked multipart. All responses are JSON.

### Health
| Method | Path | Auth | Behavior |
|---|---|---|---|
| GET | `/health` | — | `{ status:'ok', message }` |
| GET | `/api/health` | — | `{ status:'OK', timestamp, version:'2.0.0' }` |

### Auth
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/signup` | — | `{ name?, email, password }` | 201 `{ token, user:{id,email,username} }` |
| POST | `/api/auth/register` | — | `{ email, password, username }` (pw ≥ 8 chars) | 201 `{ token, user }` |
| POST | `/api/auth/login` | — | `{ email, password }` | `{ token, user }` |
| GET | `/api/auth/me` | ✓ | — | `{ id, email, username, created_at }` |

`signup` and `register` both exist. They differ in validation: `register` enforces password ≥ 8 chars and uniqueness across email **or** username; `signup` only checks email. Both call `bcrypt.hash(…, 10)` and mint a 30-day HS256 JWT with payload `{ id, email, username }`.

### Folders
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/folders?parent_id=<uuid?>` | ✓ | (query) | `[{ id, user_id, name, parent_id, … }]` |
| POST | `/api/folders` | ✓ | `{ name, parent_id? }` | 201 `{ id, user_id, name, parent_id }` |
| PATCH | `/api/folders/:id` | ✓ | `{ name }` | `{ id, name }` |
| DELETE | `/api/folders/:id` | ✓ | — | `{ message }` (promotes children/tracks to the deleted folder's parent) |
| GET | `/api/folders/:id/breadcrumb` | ✓ | — | `[{ id, name }, …]` (root-first) |

### Tracks
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/tracks/upload` | ✓ | multipart: `file` + fields `title?, duration?, daw?, bpm?, tags?, source?, sync_group?, is_original?, converted_from?, folder_id?` | 201 `{ id, title, filename, size, sync_group, format, is_original, folder_id, created_at }` |
| GET | `/api/tracks?sort=&q=&daw=&period=&folder_id=&format=` | ✓ | (query) | `Track[]` (excludes `deleted_at != null`) |
| GET | `/api/tracks/grouped` | ✓ | — | `[{ sync_group, files:Track[], updated_at }]` |
| GET | `/api/sync-groups` | ✓ | — | identical to `/api/tracks/grouped` |
| GET | `/api/tracks/by-sync-group/:syncGroup` | ✓ | — | `{ sync_group, files:[{…Track, stream_url?, download_url}] }` (signed URLs minted) |
| PATCH | `/api/sync-group/:syncGroup/rename` | ✓ | `{ name }` | `{ old_name, new_name }` (updates all tracks in group) |
| DELETE | `/api/sync-group/:syncGroup` | ✓ | — | `{ message }` (hard deletes from R2 + DB) |
| GET | `/api/tracks/:id/stream` | ✓ | — | `{ stream_url }` (1h R2 presigned GET; 400 if `.flp`) |
| GET | `/api/tracks/:id/download` | ✓ | — | `{ download_url, filename }` (1h R2 presigned GET with `Content-Disposition: attachment`) |
| GET | `/api/tracks/deleted` | ✓ | — | `Track[]` in trash (`deleted_at != null`) |
| DELETE | `/api/tracks/:id` | ✓ | — | `{ message }` (soft-delete: sets `deleted_at`) |
| PATCH | `/api/tracks/:id/restore` | ✓ | — | `{ message }` (clears `deleted_at`) |
| PATCH | `/api/tracks/:id/move` | ✓ | `{ folder_id }` | `{ id, folder_id }` |
| POST | `/api/tracks/:id/convert` | ✓ | `{ format:'mp3'\|'wav' }` | 201 new track row |
| POST | `/api/tracks/:id/share` | ✓ | — | `{ token, share_url }` (mints on first call, then stable) |
| GET | `/api/shared/:token` | — (public) | — | `{ id, title, filename, size, duration, daw, bpm, format, sync_group, created_at, stream_url, download_url }` |
| GET | `/api/tracks/latest-timestamp` | ✓ | — | `{ latest, count:0 }` (intended for client polling; currently unused by web/desktop/mobile) |

### Storage
| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/storage-info` | ✓ | `{ used_bytes, limit_bytes, used_pct, track_count, warning }` (limit hardcoded to 10 GiB) |
| GET | `/api/storage-plans` | — | static array of Free / Pro / Studio plans |

### Cross-cutting middleware
- `helmet({ contentSecurityPolicy:false })` — standard security headers, CSP off.
- `compression()` — gzip responses.
- `express.json()` — JSON body parser (no explicit size limit; default 100kb).
- CORS: origins parsed from `FRONTEND_URL` (comma-separated, trailing slashes stripped). **However, unknown origins are currently allowed with only a `console.warn` — effective policy is allow-all.**
- Multer: disk storage in `os.tmpdir()`, 500 MB per-file limit, whitelist on extension **or** MIME type (`.mp3/.wav/.flac/.m4a/.ogg/.aiff/.flp`).
- Error handler: special-cases `LIMIT_FILE_SIZE` → 413; otherwise 500 with `err.message`.

---

## 3. Database schema (Supabase Postgres)

Declared across `migrations.sql` (v3) and `migrations_v4.sql`. Tables are:

### `users`
- `id UUID PRIMARY KEY` (generated by backend via `uuidv4()`, not by Postgres)
- `email TEXT` (uniqueness enforced at insert-time by application code, not a DB constraint)
- `username TEXT UNIQUE` (added by v3 migration)
- `password_hash TEXT NOT NULL DEFAULT ''` (bcrypt, cost factor 10)
- `created_at TIMESTAMPTZ DEFAULT NOW()`

### `tracks`
- `id UUID PRIMARY KEY`
- `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`
- `title TEXT NOT NULL`
- `filename TEXT NOT NULL`
- `r2_key TEXT NOT NULL` — pattern: `<user_id>/<track_id>-<filename>`
- `size BIGINT NOT NULL DEFAULT 0`
- `duration REAL` (seconds)
- `daw TEXT DEFAULT 'FL Studio'`
- `bpm INTEGER`
- `tags TEXT` (comma-separated, despite mobile TS type declaring `string[]`)
- `source TEXT DEFAULT 'web'` — observed values: `'web' | 'desktop' | 'conversion'`
- `shareable_token TEXT UNIQUE` — null until the track is first shared
- `sync_group VARCHAR(255)` — the group-identity string (name-based, not FK)
- `is_original BOOLEAN DEFAULT false` — `.flp` is always `true`
- `converted_from VARCHAR(255)` — source filename when `source='conversion'`
- `format VARCHAR(20)` — mp3/wav/flac/m4a/ogg/aiff/flp/unknown
- `folder_id` — nullable, backing `/api/folders` hierarchy
- `deleted_at TIMESTAMPTZ` — soft-delete marker
- `created_at`, `updated_at`

Indexes: `user_id`, `(user_id, title)`, `shareable_token`, `(user_id, created_at DESC)`, `(user_id, sync_group)`.

### `folders`
Referenced by `/api/folders/*` endpoints. The SQL migration files check in don't create this table — it must have been applied out-of-band or in a migration not in the repo. Columns used by the API: `id, user_id, name, parent_id`.

### Row Level Security
`tracks_service_all` policy allows all operations. The backend enforces per-user isolation through `user_id` predicates in every query. Anyone holding `SUPABASE_KEY` (service-role) effectively has god access.

---

## 4. Data flows

### 4a. File upload (web or desktop)

```
  Web UI / Desktop watcher
        │
        │  multipart POST /api/tracks/upload
        │  (file + title + optional sync_group/folder_id/etc.)
        │  Authorization: Bearer <jwt>
        ▼
  multer writes to /tmp/<random>
        │
        ▼
  Server reads file → buffer → R2 PutObject
  (key = <user_id>/<track_id>-<title><ext>)
        │
        ▼
  Insert row into `tracks`
        │
        ▼
  Delete /tmp file (finally-block)
        │
        ▼
  201 JSON { id, title, filename, size, sync_group, format, is_original, folder_id, created_at }
```

**Dedup rule (server-side):** before insert, server SELECTs all existing tracks with the same `(user_id, sync_group, format)` and **deletes them from R2 + DB**. Consequence: uploading the same title twice replaces the older version. `sync_group` defaults to `title` if not supplied.

**Dedup rule (desktop-side):** desktop computes MD5 of every file before upload, caches `{hash → metadata}` in `electron-store` under `uploadedHashes`. If the hash is in cache, skip. This cache is local-only — uninstalling the app or clearing history (via the "Clear History" dialog) forces re-uploads on next scan.

### 4b. Desktop auto-sync (watch folder → cloud)

```
  FL Studio exports .wav / .mp3 to
    ~/Documents/Image-Line/FL Studio/…
    ~/Documents/Image-Line/FL Studio 2025/Audio/…
        │
        ▼
  chokidar watcher (depth=3, debounce awaitWriteFinish=3s)
  - ignoreInitial: true (new events only)
  - whitelists: .mp3/.wav/.flac/.ogg/.aiff/.m4a/.flp
  - blacklists: .rss, .ds_store, .tmp, .part, dotfiles
        │
        ▼
  enqueueUpload(path)  — dedup against uploadQueue array
        │
        ▼
  if (autoSync) processQueue() immediately
  else          wait for manual "Sync Now" or timer tick
        │
        ▼
  processQueue() serial loop:
    compute MD5
    if hash ∈ uploadedHashes → skip
    else                       → axios POST /api/tracks/upload (source='desktop')
                                  retry at 5s / 15s / 45s on error (then give up)
        │
        ▼
  On success:
    - update uploadedHashes
    - macOS Notification (if enabled)
    - send stats-update IPC to renderer
```

Interval options: 0 (instant only), 1/5/30 min, 1/2 h. `0` means "only chokidar triggers uploads"; any non-zero value also schedules a periodic `runSync()` that re-scans watched dirs. `runSync()` is also invoked manually from the tray or the "Sync Now" button.

**Desktop is upload-only.** There is no download, play, or list flow — the desktop app never calls `GET /api/tracks`.

### 4c. Streaming / download (web + mobile)

```
  Client calls GET /api/tracks/:id/stream
  Authorization: Bearer <jwt>
        │
        ▼
  Server SELECT r2_key FROM tracks WHERE id AND user_id
        │
        ▼
  getSignedUrl(GetObjectCommand, expiresIn=3600)
        │
        ▼
  Response: { stream_url: "<presigned R2 URL>" }
        │
        ▼
  Client sets <audio>.src = stream_url and plays
```

Download is identical except `ResponseContentDisposition: attachment; filename="…"` is baked into the signed URL.

`.flp` files return 400 on `/stream` — can only be downloaded.

Mobile client (`lib/tracks.ts::getTrackStreamUrl`) retries three URL shapes (`/stream` → `/url` → `/download`) as a compatibility fallback across older backend deployments. Only `/stream` and `/download` exist on the current server; `/url` is legacy.

### 4d. Share link flow

```
  Owner (authed) POSTs /api/tracks/:id/share
        │
        ▼
  If track already has shareable_token → return it
  Else → crypto.randomBytes(16).toString('hex'), persist, return
        │
        ▼
  Response: { token, share_url: "<FRONTEND_URL>/shared/<token>" }
        │
        ▼
  Owner copies / sends URL.

  Recipient (unauthed) opens https://soundbridg.com/shared/<token>
        │
        ▼
  Web SPA matches path `/shared/:token` before any auth routing
  (see soundbridg-frontend/src/App.jsx)
        │
        ▼
  GET /api/shared/<token>  (public endpoint, no auth)
        │
        ▼
  Server returns track metadata + 1h presigned stream_url + download_url
  (r2_key is scrubbed from response)
        │
        ▼
  SharedTrack.jsx renders waveform, play/pause, download button
```

Web app defensively rewrites the share URL on the client: if the backend returned a URL whose origin doesn't match `window.location.origin` (e.g. `localhost` in dev, or the Render default), the web app rebuilds it from the current origin.

Mobile share uses `Share.share()` with `https://soundbridg.com/shared/<shareable_token>` **only if the token already exists on the track row** — it does not call the mint endpoint. Users who haven't shared from web first will get a stream URL share instead (see `app/(tabs)/tracks.tsx:74`).

### 4e. Conversion flow

Backend `/api/tracks/:id/convert`:

```
  Client POST { format: "mp3"|"wav" }
        │
        ▼
  Server downloads source from R2 to /tmp
        │
        ▼
  ffmpeg (fluent-ffmpeg):
    mp3 → libmp3lame, 192 kbps
    wav → pcm_s16le, 44100 Hz
        │
        ▼
  ffprobe for duration (falls back to source duration)
        │
        ▼
  Dedup on (user_id, sync_group, format) — delete existing
        │
        ▼
  Upload converted file to R2 + insert new tracks row
  (source='conversion', is_original=false, converted_from=<src filename>)
        │
        ▼
  Cleanup /tmp files in finally block
```

Web "Convert" UI (`Convert.jsx`, `Dashboard.jsx::ConvertPanel`) actually performs **upload → convert → download** as three sequential calls. This means Convert is effectively a one-way round-trip through cloud storage even for files the user never wants to keep. Notable because it burns both R2 storage and user quota per conversion.

---

## 5. Auth — same mechanism everywhere

All three clients use the **exact same custom-JWT flow**. No client uses Supabase Auth; the `app/auth/callback.tsx` magic-link landing on mobile is a historical no-op from the pre-migration era (documented as such in comments).

| Client | Token storage | Attached as |
|---|---|---|
| Web | `localStorage.sb_token`, `localStorage.sb_user` | `Authorization: Bearer <t>` on every `fetch` |
| Desktop | `electron-store` (`~/Library/Application Support/soundbridg-config/…`) keys `token`, `userEmail` | `Authorization: Bearer <t>` on axios calls |
| Mobile | iOS/Android: `expo-secure-store` (Keychain/Keystore); Web build: `AsyncStorage`. Keys `soundbridg.token`, `soundbridg.user` | `Authorization: Bearer <t>` on `apiFetch` |

**Token shape:** HS256 JWT, payload `{ id, email, username, iat, exp }`, signed with `JWT_SECRET`, 30-day expiry. There is no refresh token and no revocation mechanism — if a token leaks, it's valid until expiry.

**401 handling:** mobile installs a global 401 interceptor (`setUnauthorizedHandler` in `lib/api.ts`) that flushes the session. Web and desktop currently do not — a 401 surfaces as a failed fetch and the UI typically shows an empty state.

**Registration:** only web exposes it (uses `/api/auth/register`). Mobile is sign-in only. Desktop is sign-in only.

---

## 6. Environment variables and configuration

### Backend (`soundbridg-backend/.env`)
| Var | Purpose |
|---|---|
| `PORT` | HTTP listen port (default 5000) |
| `NODE_ENV` | `development` / `production` |
| `FRONTEND_URL` | Comma-separated list of allowed CORS origins (but effectively allow-all — see §2) |
| `SUPABASE_URL`, `SUPABASE_KEY` | Service-role Supabase credentials |
| `CLOUDFLARE_R2_ENDPOINT` | e.g. `https://<acct>.r2.cloudflarestorage.com` |
| `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_KEY` | R2 S3 credentials |
| `CLOUDFLARE_R2_BUCKET` | bucket name (set to `soundbridg`) |
| `CLOUDFLARE_R2_PUBLIC_URL` | declared in `.env.example` but **not referenced in `server.js`** |
| `JWT_SECRET` | HS256 signing secret — must be set; no fallback |
| `FFMPEG_PATH` | declared in `.env.example` but **not referenced in `server.js`** (fluent-ffmpeg uses `ffmpeg` on PATH) |

### Frontend (`soundbridg-frontend/`)
**No environment variables are read.** The backend URL `https://soundbridg-backend.onrender.com` is hardcoded in two places: `src/context/AuthContext.jsx:5` and `src/pages/SharedTrack.jsx:4`. Config files:
- `vite.config.js` — React + `@cloudflare/vite-plugin`.
- `wrangler.jsonc` — Cloudflare Workers asset config; SPA fallback; `nodejs_compat` flag.
- `netlify.toml` — SPA redirect rule (present, but Cloudflare is the active deploy target).
- `tailwind.config.js`, `postcss.config.js` — Tailwind 3.
- `package.json` dependencies: **only `react` + `react-dom`**. No routing library, no HTTP client. Client-side routing is custom (matches `/shared/:token`, otherwise uses a `page` state string).

### Desktop (`soundbridg-desktop/`)
No `.env` file; no runtime config file shipped. Configuration lives in:
- `main.js:13` — `API_BASE = 'https://soundbridg-backend.onrender.com'` (hardcoded).
- `main.js:20-23` — default watch directories: `~/Documents/Image-Line/FL Studio` and `~/Documents/Image-Line/FL Studio 2025/Audio`.
- `electron-store` on disk — persists token, userEmail, syncInterval, uploadedHashes, watchFolders, autoSync, notifications, launchAtStartup.
- `package.json` build section references `build/entitlements.mac.plist`, but that file was deleted in the migration checkpoint commit (`9a240b3`). **Next `npm run dist` will fail** until the file is restored or the references are removed.

### Mobile (`Built-Apps/soundbridg-mobile/`)
| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL; default in code is the production Render URL |

`app.json` declarations that shape behavior:
- `scheme: "soundbridg"`, `associatedDomains: ["applinks:soundbridg.com"]` — universal-link / deep-link support. Only `/auth/callback` is actually routed today.
- `ios.infoPlist.UIBackgroundModes: ["audio"]` — playback continues when app is backgrounded.
- `newArchEnabled: true` — React Native new architecture is on.
- `updates.url = https://u.expo.dev/9c681b75-…` — EAS Update is wired; `runtimeVersion.policy = 'appVersion'`.
- `extra.eas.projectId = 9c681b75-49e0-4076-be67-2f82361701d5`.

---

## 7. Architectural assumptions — do not violate without agreement

These are invariants the current system relies on. Breaking them requires coordinated changes across repos.

1. **Single API gateway.** Every client (web, desktop, mobile) talks only to the Render backend. No client holds Supabase or R2 credentials. Any "move to Supabase Auth" or "direct R2 upload" changes this contract and breaks the mobile `lib/api.ts` comment that is treated as a spec.

2. **Custom JWT, 30-day lifetime, no refresh.** The JWT payload is `{ id, email, username }`. Changing the payload shape will silently break the existing `authMiddleware` (it stores `req.user = jwt.verify(…)` and downstream code reads `req.user.id`).

3. **R2 key layout.** `<user_id>/<track_id>-<filename>`. This enables per-user cleanup on account delete, and the `DELETE` handlers rely on the row's `r2_key` being authoritative. Never write R2 under a different scheme without updating delete handlers.

4. **Sync-group identity is a string, not an ID.** `tracks.sync_group` is a `VARCHAR(255)` whose default is the track title. Dedup works on the tuple `(user_id, sync_group, format)`. Renaming a sync group updates every track's `sync_group` column to the new string. There is no `sync_groups` table despite what `SyncGroups.jsx` assumes (see §8).

5. **Upload-replaces-same-format contract.** When a user uploads `Beat.wav` twice, the second upload hard-deletes the first from both R2 and Postgres. The system is a **version-flat** store per `(sync_group, format)`. The desktop MD5 cache is what prevents churn — lose the cache, replace the file.

6. **Soft-delete via `deleted_at`.** Track deletes from the web UI set `deleted_at` (recoverable via `/api/tracks/:id/restore`). Sync-group delete is hard. Desktop never deletes.

7. **Share tokens are permanent.** Once minted, `tracks.shareable_token` is unique and reused forever. There is no unshare / rotate endpoint. A leaked share URL cannot be revoked without deleting the track.

8. **`.flp` is download-only.** Backend explicitly rejects streaming for `format='flp'`. Clients must not attempt to play it.

9. **Storage limit is advisory.** `/api/storage-info` returns `used_pct` and a `warning` flag, but **no upload endpoint enforces the 10 GiB limit**. Over-quota accounts will keep uploading.

10. **CORS is effectively open.** `allowedOrigins` is parsed but a non-match is logged and allowed. Tightening this will break clients that call from unexpected origins (e.g. preview deploys) unless they're added to `FRONTEND_URL` first.

11. **RLS is off in practice.** The `tracks_service_all` policy and the service-role key mean per-user isolation is enforced only by the backend's `WHERE user_id = ?` clauses. Any future bypass of the backend (e.g. direct Supabase client in a new feature) will expose all users' data.

12. **No write APIs from desktop beyond upload.** Desktop does not call delete, share, convert, or list. It is strictly a one-way producer.

13. **Mobile is read-only for tracks.** Mobile can list, stream, delete, and share (if token already minted), but cannot upload, record, or convert.

---

## 8. Known architectural divergences (documentary — not fixes)

These are places where the clients and server disagree today. They are not broken in the "nothing works" sense, but they are the friction points most likely to surface during refinement.

- **`soundbridg-frontend/src/pages/SyncGroups.jsx`** — the entire page assumes a CRUD resource at `/api/sync-groups` (`POST` to create, `DELETE /api/sync-groups/:id`). The backend exposes **no such resource**: only `GET /api/sync-groups` (read-only list of groupings), plus `PATCH /api/sync-group/:syncGroup/rename` and `DELETE /api/sync-group/:syncGroup` (singular, keyed by name). Create and delete from this page silently fail.

- **Frontend folders UI is disconnected.** `Dashboard.jsx` keeps folders as a hardcoded JS array (`['All Files', 'Recently Deleted']`) and never calls `/api/folders`. Backend has a full folder CRUD + breadcrumb API that no web client currently hits. Mobile has a `listProjects()` that tries both `/api/folders` and legacy `/api/projects`.

- **Trash UX is stubbed.** `Dashboard.jsx::fetchRecentlyDeleted` is a no-op and `handleRestore` does nothing, despite backend providing `/api/tracks/deleted` and `/api/tracks/:id/restore`.

- **Duplicate auth endpoints.** `/api/auth/signup` and `/api/auth/register` both create accounts with slightly different validation rules. Web calls `/register`; nothing calls `/signup`.

- **Duplicate grouped-tracks endpoints.** `/api/tracks/grouped` and `/api/sync-groups` return identical payloads.

- **Mobile `Track` type drift.** `Track.tags` is declared `string[] | null` in TS but the DB column is `TEXT` (comma-separated). `Track.sync_group_id: string | null` is declared but the DB column is `sync_group: VARCHAR(255)` (no `_id` suffix, not an FK). Today this only affects TypeScript consumers, not runtime behavior.

- **Mobile URL fallback chain.** `lib/tracks.ts::getTrackStreamUrl` tries `/stream` → `/url` → `/download`. `/url` has never been part of the current backend. Safe to treat as legacy compatibility, but noise.

- **Desktop packaging reference deleted.** `soundbridg-desktop/package.json` still references `build/entitlements.mac.plist`, which was removed in commit `9a240b3`. `npm run dist` / `dist:universal` will fail until this is addressed.

- **`/api/tracks/latest-timestamp` is unused.** No client polls it, so "auto-sync propagation" from desktop-upload to web-dashboard currently requires a manual refresh.

- **Two deploy configs on the frontend.** `netlify.toml` and `wrangler.jsonc` both exist. Cloudflare is active (build script: `vite build && wrangler deploy`). Netlify config is stale.

- **`.env.example` vars unused by the backend.** `CLOUDFLARE_R2_PUBLIC_URL` and `FFMPEG_PATH` are advertised but never read.

---

## 9. Repo-at-a-glance config map

| Repo | Entry | Lang | Build tool | Deploy | Backend URL source |
|---|---|---|---|---|---|
| backend | `server.js` | Node ESM | — | Render | itself |
| frontend | `src/main.jsx` | JSX | Vite 8 | Cloudflare (wrangler) | hardcoded in `AuthContext.jsx` + `SharedTrack.jsx` |
| desktop | `main.js` (+ `preload.js`, `renderer/`) | CommonJS | electron-builder | DMG → soundbridg.com | hardcoded in `main.js:13` |
| mobile | `app/_layout.tsx` via `expo-router/entry` | TS/TSX | Metro (Expo) | EAS Build + EAS Update | `EXPO_PUBLIC_API_URL` env, fallback hardcoded |

---

*End of Lens 1 (Architectural Integrity) audit. Lenses 2–4 (UX Friction, Visual Coherence, Performance & Reliability) are intentionally deferred.*
