# SoundBridg — Constraints

The do-not-violate list for SoundBridg 2.0 refinement. Read this before every session. If a proposed change touches anything in this file, the change requires an explicit, documented decision — not a casual edit.

Companion to `ARCHITECTURE.md` (descriptive) and `PHILOSOPHY.md` (prescriptive intent). This file is **normative**: rules, not suggestions.

---

## 1. Auth model — frozen

- **Custom HS256 JWT. 30-day expiry. No refresh token.** Do not introduce Supabase Auth. Do not introduce OAuth, magic links, or passkeys without a cross-repo migration plan.
- **Token payload is `{ id, email, username, iat, exp }`.** `req.user.id` is load-bearing in every authenticated handler. Never remove, rename, or retype these fields. Adding new claims is tolerable; renaming the existing three is not.
- **`JWT_SECRET` is the one signing key.** No per-client secrets, no asymmetric migration, no co-existing signing schemes. Rotating `JWT_SECRET` invalidates every active session — plan accordingly.
- **Bearer transport only.** `Authorization: Bearer <token>` header. No cookie-based auth. No tokens in query strings or path segments.
- **Token storage per client is fixed:**
  - Web: `localStorage.sb_token` / `localStorage.sb_user`.
  - Desktop: `electron-store` keys `token` / `userEmail`.
  - Mobile: `expo-secure-store` on native, `AsyncStorage` on web build; keys `soundbridg.token` / `soundbridg.user`.
  Do not migrate between stores without an in-place compatibility shim.
- **401 clears the session.** Mobile already enforces this globally; web/desktop should match behavior on any session-affecting change. Never silently retry a 401.

## 2. Backend is the single gatekeeper

- **No client holds Supabase or R2 credentials, ever.** Not in env files, not in build artifacts, not in debug builds. Any feature that appears to require direct Supabase/R2 access is wrong — route it through a new backend endpoint instead.
- The mobile app's comment in `lib/api.ts` ("The mobile app talks ONLY to this API — there is no direct Supabase / R2 access") is a contract. Extend the same rule to every future client (iPad, watch, plugin, CLI).
- **Supabase access uses the service-role key server-side only.** Per-user isolation is enforced by `WHERE user_id = req.user.id` in every query. RLS is effectively off — protect it at the application layer.
- **R2 access is always through presigned URLs minted by the backend.** Presigned URLs have a 1-hour TTL; do not extend. Do not expose permanent public R2 URLs.

## 3. Data model — invariants

- **Every track belongs to exactly one user.** `tracks.user_id` is non-null and the only ownership signal. No cross-user track mutations. Sharing exposes read access, not ownership.
- **R2 key layout is `<user_id>/<track_id>-<filename>`.** Do not restructure. Do not drop the `<filename>` suffix — it preserves human-readability in the bucket browser and helps debug recovery. Per-user cleanup on account deletion depends on the `<user_id>/` prefix.
- **Soft-delete only for tracks.** User-initiated track deletion sets `deleted_at`. Never hard-delete from `tracks` without going through `/api/tracks/:id/restore` semantics first. Exception: the server's internal dedup in `/api/tracks/upload` and `/api/tracks/:id/convert` hard-deletes the prior `(user_id, sync_group, format)` tuple — this is part of the upload-replaces contract and stays.
- **Sync-group identity is the `sync_group` string, not an ID.** Keep it a `VARCHAR(255)` on `tracks`. Do not introduce a `sync_groups` table without migrating every query that groups on the string column.
- **Upload-replaces-same-format is the canonical dedup rule.** Uploading `Beat.wav` twice replaces the prior row in both R2 and Postgres. Clients assume this contract (the desktop MD5 cache is what prevents unnecessary re-uploads).
- **`.flp` files are download-only.** The server rejects `/api/tracks/:id/stream` for `format='flp'`. Never attempt to play `.flp` on any client.
- **Share tokens are permanent, one-per-track.** `tracks.shareable_token` is minted on first `POST /api/tracks/:id/share` and reused forever. Any rotation/revocation feature must preserve this history (e.g. by adding a new column, not mutating the existing one). Revoking a token today requires deleting the track.

## 4. Storage quota — canonical value

- **Free tier = 10 GiB per user** (`10 * 1024 * 1024 * 1024` bytes = `10,737,418,240`). This is the value encoded in `server.js::STORAGE_LIMIT_BYTES` and matches the `Free` plan in `/api/storage-plans`. Any other number (5 GB, 10 GB in decimal, etc.) found in docs, UI copy, or marketing is wrong and must be corrected to match the canonical value.
- **Paid tiers from `/api/storage-plans` (authoritative):** Free 10 GiB / $0, Pro 50 GiB / $9.99/mo, Studio 200 GiB / $24.99/mo. Do not introduce additional tiers without updating both the plans endpoint and `STORAGE_LIMIT_BYTES` selection logic.
- **Quota is advisory today.** `/api/storage-info` returns `warning: true` above 90% but no upload endpoint enforces the cap. When enforcement is added, it must be in the backend (never in a client) and must return `413 Payload Too Large` with the standard error shape.

## 5. API contract — additive only

- **Error shape is `{ error: "<human-readable string>" }`.** Status codes: 400 client error, 401 missing/bad auth, 403 forbidden (not used today — reserve), 404 not found, 409 conflict, 413 payload too large, 500 server error. Never return errors as a bare string, a different key, or nested inside a `data` field.
- **Success shape is the resource or a `{ message }` acknowledgement.** Never wrap success payloads in an envelope (`{ success: true, data: … }`) — clients don't expect one.
- **JSON only.** No XML, no form-encoded responses. Requests may be `application/json` or `multipart/form-data` (for uploads); nothing else.
- **Additive changes only.** Never remove or rename an existing endpoint path, query param, or response field. Clients are pinned to production and some (desktop installers) will not update for months. When deprecating, ship the replacement alongside the original and remove the original only after telemetry confirms zero traffic.
- **The existing endpoint surface is frozen as documented in `ARCHITECTURE.md §2`.** Duplicates (`/api/auth/signup` vs `/api/auth/register`; `/api/tracks/grouped` vs `/api/sync-groups`) stay — removing them is a breaking change.
- **Presigned URL TTL is 1 hour.** Do not extend. If a client needs a longer-lived URL, mint a new one on demand.
- **Auth-required unless explicitly public.** Public today: `/health`, `/api/health`, `/api/storage-plans`, `/api/shared/:token`. Everything else is authenticated. Never add an anonymous endpoint that returns user-scoped data.

## 6. Security posture

- **CORS is intentionally loose today** (parses `FRONTEND_URL` but falls through to allow-all). Tightening is allowed and encouraged, but must include at minimum: production web origin, Cloudflare Pages preview domains, `http://localhost:*` for dev. Don't tighten in a way that breaks the Electron app (origin is `file://` or similar).
- **HTTPS only in production.** The Render-hosted API is HTTPS by default; do not regress to mixed content.
- **Helmet is on with CSP disabled.** Keep helmet. Enabling CSP requires auditing every inline style in the React/Electron apps — don't do it opportunistically.
- **No server-side logging of tokens, passwords, R2 credentials, or signed URL query strings.** `console.warn` statements that dump request bodies are a bug.
- **bcrypt cost factor = 10.** Do not lower. Raising requires coordinated rollout (existing hashes stay at cost 10).
- **Max upload size = 500 MiB per file** (multer config). Raising this requires confirming Render's request timeout and R2 upload path. Lowering is safe but breaks existing users producing large WAVs.
- **No rate limits today.** Adding per-IP or per-user rate limits is fine but must exempt the desktop app's sync burst (a scan can legitimately enqueue dozens of files back-to-back).
- **Sensitive config (JWT secret, R2 keys, Supabase service key) lives only in Render's env and the developer's local `.env`.** Never in git, never in CI logs, never in frontend bundles, never in Electron packages, never in `eas.json`.

## 7. Repo topology — canonical

- **The four repos at `~/Developer/soundbridg/` are the active codebase:** `soundbridg-frontend/`, `soundbridg-backend/`, `soundbridg-desktop/`, `Built-Apps/soundbridg-mobile/`.
- **`~/Developer/SoundBridg_BACKUP/` is a read-only safety net.** Never write, commit, or delete anything under this path. Do not `git init` inside it. Do not copy files out of it except to recover from verified loss.
- **`~/Developer/soundbridg/soundbridg-desktop-archived/` is a read-only archive** of pre-migration desktop code. Not a git repo. Do not reference it for current behavior — it may disagree with the active `soundbridg-desktop/`.
- **iCloud Drive is no longer authoritative.** If a file path with `Mobile Documents` or `com~apple~CloudDocs` appears in a diff, it's a regression.

## 8. Git hygiene

- **SSH-only remotes for GitHub.** No HTTPS remotes. No personal access tokens baked into `.git/config` or `.gitconfig`.
- **No secrets in commits.** This includes `.env`, `.env.local`, R2 credentials, JWT secrets, session dumps, database exports, EAS credentials. The `.gitignore` in each repo is the first line of defense — do not override it with `git add -f`.
- **No co-author lines that don't reflect reality.** The existing `Co-Authored-By: Claude Opus 4.7` trailer in checkpoint commits is fine; inventing human co-authors is not.
- **No force-push to `main` on any repo, ever.** Force-push is allowed on feature branches you own, never on shared branches.
- **Never commit `node_modules/`, build artifacts (`dist/`, `.wrangler/`, `.expo/`), or packaged binaries.** If a `.DS_Store` slips in, remove it in a follow-up commit.

## 9. Cross-client behavior invariants

- **Desktop is upload-only.** It does not list, download, delete, share, or convert. Adding read flows to desktop is a product decision — don't add them to satisfy an implementation convenience.
- **Mobile is read-only for tracks.** Listen, delete, share-existing-token. No upload, no record, no convert. Adding mobile upload requires a deliberate product decision and the corresponding multipart path must be paved for cellular (chunked, resumable) before shipping.
- **Web is the only client that mints share tokens today.** Mobile shares existing tokens only; if no token exists it falls back to a stream URL. Do not add share minting on desktop without product review.
- **Share URLs are `https://soundbridg.com/shared/<token>`.** The web SPA routes this path before auth. Never embed the backend origin in a share URL shown to a user — the web client rewrites mismatches defensively; keep that fallback.
- **Sync propagation is pull-based, client-initiated.** There is no push channel. `/api/tracks/latest-timestamp` exists for polling but is currently unused. Introducing WebSocket/SSE/push notifications is a cross-repo change and must be coordinated.

## 10. Operational constraints

- **Render free tier cold start.** The backend may take 30+ seconds to spin up on first request after idle. Clients must not treat the first request's latency as a failure. Loading states must survive cold starts without user-visible errors.
- **ffmpeg is a required binary on the backend.** Render provides it. Any migration off Render must confirm ffmpeg + ffprobe are on PATH.
- **`/tmp` scratch space.** Upload and conversion pipelines use `os.tmpdir()`. The `finally` cleanup is mandatory — never remove it. Render's `/tmp` is ephemeral and size-limited; don't accumulate files.
- **Single-instance lock on desktop is mandatory.** `app.requestSingleInstanceLock()` prevents duplicate watchers racing on the same folder. Removing it will corrupt `uploadedHashes`.
- **The Expo EAS project is `9c681b75-49e0-4076-be67-2f82361701d5`.** OTA updates target `runtimeVersion.policy = 'appVersion'`. Changing the runtime version invalidates the update channel for existing installs.

## 11. Known-but-tolerated divergences

These are listed in `ARCHITECTURE.md §8`. Do not "fix" them as drive-by edits — they represent dormant code paths that users depend on or behaviors with documented reasons. Any cleanup is a deliberate surgery with its own test plan:

- ~~`SyncGroups.jsx` calls non-existent endpoints (silent failure).~~ Resolved by Week 1 Surgery #2 (`soundbridg-frontend` commit `419df75`, dead UI removed).
- `Dashboard.jsx` folder strings are hardcoded (no `/api/folders` usage yet).
- Trash UX is stubbed on web despite server support.
- `/api/auth/signup` and `/api/auth/register` coexist.
- `/api/tracks/grouped` and `/api/sync-groups` return identical data.
- Mobile URL fallback chain includes the legacy `/url` shape.
- Mobile `Track.tags: string[]` type drifts from DB `TEXT`; `Track.sync_group_id` drifts from DB `sync_group`.
- `netlify.toml` exists alongside the active `wrangler.jsonc`.
- `.env.example` advertises `CLOUDFLARE_R2_PUBLIC_URL` and `FFMPEG_PATH` which the server never reads.
- ~~`soundbridg-desktop/package.json` references `build/entitlements.mac.plist`, which is currently missing (checkpoint commit `9a240b3`).~~ Resolved by Week 1 Surgery #1 (`soundbridg-desktop` commit `67291e7`, entitlements restored).

Any remediation of the above is a scoped task with its own verification, not a side effect of other work.

---

*When in doubt: don't break the contract. Add a new endpoint, ship a new field, expand — never rename, never remove, never re-scheme.*
