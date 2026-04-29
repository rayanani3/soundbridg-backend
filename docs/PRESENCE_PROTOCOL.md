# SoundBridg — Presence Protocol

The canonical specification for **per-user device presence** in SoundBridg 2.0 — the substrate that drives the bridg icon's Nearby state (`BRIDG_ICON.md` §3, state #4) and underwrites future cross-device coordination. This document is normative: channel topology, payload shape, auth model, and lifecycle rules are rules, not suggestions.

Companion to `ARCHITECTURE.md` (descriptive), `CONSTRAINTS.md` (non-negotiable rules), `PHILOSOPHY.md` (product intent), `BRIDG_ICON.md` (the surface this protocol feeds), and `DESIGN_TOKENS.md` (the token names referenced by that surface). Every client that participates in presence must match this spec field-for-field on the payload and rule-for-rule on lifecycle.

---

## 1. What presence means here

Presence in this document is **Meaning A**: a single user's own devices learning that each other are online. A producer is signed in on desktop, mobile, and web — each install advertises itself on a channel scoped to that user, and every other install of the same user sees it.

This is **not** multi-user collaboration. There is no shared room, no co-presence between accounts, no "X and Y are viewing this track." Two different users never share a presence channel. If a future product surface needs multi-user co-presence (for example, a shared session with a collaborator), it is a separate channel topology and a separate document.

Presence here also is **not Meaning C** — Bluetooth / WiFi-Direct proximity discovery for AirDrop-style nearby sharing. Meaning C is mentioned in `PHILOSOPHY.md` §5 as a future mobile capability and is explicitly out of scope for this protocol.

The single consumer of presence today is the bridg icon's Nearby state (§4 of `BRIDG_ICON.md`, state #4 — "Gold + blue dot"). When a user's own peer device is online, every other install of that user shows the dot. That is the entire user-visible behavior in v1.

---

## 2. Scope & non-goals

### In scope (this document)

- Per-user device presence over Supabase Realtime Presence.
- Auth via Path A1 (legacy HS256 JWT secret), additive per `CONSTRAINTS.md` §1.
- RLS-gated private channels on `realtime.messages`.
- Payload v1 — `{ presence_v, device_id, client, app_version, os, joined_at }`.
- Lifecycle behavior across 13 enumerated cases (§8).

### Non-goals (explicitly deferred)

- **Per-client implementations** — Electron, iOS, Android, web. Each client integration is a separate future surgery (referenced by name in §9).
- **Sync-state Broadcast events** — "upload started on desktop", "track converted on mobile", and similar event-bus traffic. Broadcast is a separate primitive on the same Realtime infrastructure; its protocol document lands in Week 3 or later.
- **Multi-user collaboration presence** — co-presence between distinct accounts on a shared resource. Not modeled here.
- **Bluetooth / WiFi-Direct (Meaning C) presence** — local-network proximity discovery. Out of scope; tracked as a Week 3+ mobile concern.
- **Push notifications** — Apple Push, FCM, Expo Push for offline delivery. Orthogonal to presence and out of scope.
- **`last_active_at` granularity** — "user was active 30s ago" semantics. Deferred — see §4.
- **Path A2 (asymmetric JWT keys)** and **Path A3 (Supabase-issued tokens)** — future auth migrations; mentioned once in §5 and §11.

---

## 3. Channel topology

**One channel per user. All of that user's devices share that single channel.**

| Property | Value |
|---|---|
| Primitive | Supabase Realtime **Presence** |
| Channel mode | Private (RLS-gated on `realtime.messages`) |
| Channel name | `presence:user:{user_id}` |
| Identity | `{user_id}` is the JWT `sub` claim — the canonical Postgres `users.id` UUID |
| Cardinality | One channel per user; N peers per channel where N = number of currently-tracked installs |
| Cross-user crossover | None — RLS prohibits subscribing to another user's channel |

A user signed in on desktop, mobile, and web is a single channel with three peer entries. A user with two browsers open and one phone is one channel with three peer entries. The channel is the user; the peers are the installs.

Channel names are not user-visible. Clients construct the topic string from the JWT-decoded `user_id` at subscription time — never from a user-supplied input.

---

## 4. Payload v1

The presence payload — what each device publishes via `channel.track()` on join.

```json
{
  "presence_v": 1,
  "device_id": "<stable per-install identifier>",
  "client": "desktop | ios | android | web",
  "app_version": "<semver, e.g. 2.0.3>",
  "os": "<platform string, e.g. macOS 14.4, iOS 17.5, Windows 11>",
  "joined_at": "<ISO 8601 timestamp set once on track()>"
}
```

### Field semantics

| Field | Required | Source | Notes |
|---|---|---|---|
| `presence_v` | yes | constant `1` | Schema version. Increment for breaking payload changes. |
| `device_id` | yes | client-generated, persisted | Stable per install. Survives logout/login. Re-rolls on uninstall/reinstall. |
| `client` | yes | constant per build | One of the four enumerated strings. New clients (iPad, watch) require updating this enum and a coordinated client release. |
| `app_version` | yes | build-time injection | `package.json` for desktop/web, `app.json` for mobile. |
| `os` | yes | runtime detection | `os.platform()/version` on Electron/Node, `Device.osVersion` on Expo, `navigator.userAgent`-derived on web. |
| `joined_at` | yes | client clock at `track()` | ISO 8601 with timezone (`2026-04-26T18:32:11.000Z`). Set once and never updated mid-session. |

### Versioning rationale

`presence_v: 1` is load-bearing. Future migrations (adding `last_active_at`, splitting `os` into `os_name`/`os_version`, etc.) bump the version and ship a coordinated client/server expectation update. Consumers tolerate unknown fields in the same major version but treat a `presence_v` mismatch as a payload they cannot interpret — they ignore the entry rather than crash.

This is the same additive principle as `CONSTRAINTS.md` §5 ("API contract — additive only") applied to a non-HTTP surface.

### Future payload fields (deferred)

- **`last_active_at`** — "this device was active in the foreground less than N seconds ago." Deferred from v1 because (a) the bridg icon's Nearby state only cares about online vs offline, not activity granularity, and (b) updating presence on every interaction creates write traffic that the Realtime infrastructure does not need to absorb yet. When a product surface requires activity granularity, it lands as `presence_v: 2` with a documented update cadence (likely throttled to 30s minimum).
- **`capabilities`** — a flag set indicating what this device can do (play, record, share-mint, etc.). Deferred until a product surface needs it; today, `client` is sufficient because capabilities are a function of client per `PHILOSOPHY.md` §5.
- **`network`** — `"wifi" | "cellular" | "ethernet"` for transfer-cost decisions. Deferred until a feature uses it.

Adding a field is additive; renaming or removing one is a `presence_v` bump.

---

## 5. Auth — Path A2 (asymmetric ES256 via JWKS)

Presence rides the same custom JWT the rest of SoundBridg uses. No second auth system, no Supabase Auth, no second token store. The signing algorithm is ES256 (P-256) and the public key is published in the Supabase project's JWKS — Supabase Realtime verifies our tokens against JWKS without ever holding our private key.

### Mechanism

- **Backend signs with ES256.** A P-256 keypair is generated locally, the public half imported into Supabase as a **standby signing key** (so it appears in JWKS but Supabase Auth does not issue with it), the private half stored in Render env as `JWT_PRIVATE_KEY` (PEM). Every issued token carries a `kid` header (`JWT_KID`) that matches the standby key's id, so Realtime knows which JWKS entry to verify against.
- **`jsonwebtoken` derives the public key from the PKCS#8 private internally for verify** — no separate `JWT_PUBLIC_KEY` env is needed. The auth middleware passes `JWT_PRIVATE_KEY` to `jwt.verify` with `algorithms: ['ES256']`; the lib handles the derivation.
- **JWT payload retains the two additive claims** required by Supabase Realtime auth (already shipped in commit `b545ac3`):
  - `sub` — the user ID (UUID). Same value as the existing `id` claim. Both ship.
  - `role` — the literal string `"authenticated"`.
- The existing claims (`id`, `email`, `username`, `iat`, `exp`) are unchanged. Every `req.user.id` reader in `server.js`, every client storing the token, every endpoint validating it — sees no semantic difference. The wire format changes (alg, kid header, signature) but the verified payload shape is stable.
- This remains additive per `CONSTRAINTS.md` §1: algorithm changed, claims preserved.

### Connection flow

1. Client authenticates against the SoundBridg API as today (`POST /api/auth/login` → `{ token, user }`). Token is now ES256-signed with our `kid` header.
2. Client constructs a Supabase client with the project URL and the **anon key**. The anon key is permitted in client bundles (see `CONSTRAINTS.md` §2 — anon is designed to be public, RLS-gated).
3. Client calls `supabase.realtime.setAuth(jwt)` with the SoundBridg JWT. Realtime fetches JWKS, finds the public key matching the `kid`, validates the signature. From this point, the connection is `authenticated` with `auth.uid()` resolving to the JWT's `sub` claim.
4. Client subscribes to `presence:user:{user_id}` (private channel) and `track()`s the payload from §4.

The backend is **not** in this path. The backend mints no Realtime-specific token, brokers no Realtime traffic, and does not see presence events. Its only Realtime touchpoint is at deploy time: registering the public key with the project as a standby signing key.

### Why Path A2 and not A1/A3

- **Path A1 (legacy HS256 = `JWT_SECRET`)** — unreachable. The Supabase project has been migrated to ECC signing keys; its legacy HS256 secret is verify-only and not editable, and the migrated project will not export its secret value. There is no way to make Supabase's legacy HS256 secret equal our `JWT_SECRET`. Even if reached, the legacy secret is on a deprecation track — building presence on it is building on a tombstone.
- **Path A3 (Supabase-issued tokens)** — replace the SoundBridg JWT entirely with Supabase Auth tokens. Violates `CONSTRAINTS.md` §1 ("Do not introduce Supabase Auth") without a coordinated cross-repo migration plan, and Supabase does not list a generic custom-issuer slot in third-party auth (only Clerk/Firebase/Auth0/Cognito/WorkOS). Not for v1.

A2 is the smallest viable delta on the current platform — one Supabase signing-key import, one backend deploy that swaps mint+verify to ES256, no runtime backend involvement in Realtime — that gets RLS-gated presence working without reopening `CONSTRAINTS.md` §1's no-Supabase-Auth rule. The cost is a one-time forced re-login (existing HS256 tokens fail verification post-cutover); `CONSTRAINTS.md` §1 already documents key-rotation as session-invalidating.

---

## 6. RLS policies

Presence reads and writes flow through `realtime.messages`. Two RLS policies are required, both gated identically. Apply them via Supabase migration (recommended) or the SQL editor.

```sql
-- Allow a user to read presence events on their own user-scoped channel.
create policy "presence read own channel"
on "realtime"."messages"
for select
to authenticated
using (
  realtime.topic() = 'presence:user:' || (auth.uid())::text
  and extension = 'presence'
);

-- Allow a user to track presence on their own user-scoped channel.
create policy "presence write own channel"
on "realtime"."messages"
for insert
to authenticated
with check (
  realtime.topic() = 'presence:user:' || (auth.uid())::text
  and extension = 'presence'
);
```

### Policy semantics

- `realtime.topic()` returns the topic string of the channel the operation targets. The equality clause restricts every operation to the channel namespaced to the JWT's `auth.uid()` — a user can never see or write another user's presence.
- `extension = 'presence'` scopes both policies to Presence-channel traffic specifically. Broadcast and database-change traffic on `realtime.messages` use different `extension` values (`'broadcast'`, `'postgres_changes'`); restricting to `'presence'` here prevents these policies from accidentally covering future Broadcast features that will need their own gating.[^1]
- `to authenticated` matches the `role` claim added in §5. An unauthenticated socket cannot even attempt these operations.

### Apply order

1. Land the Supabase project's legacy JWT secret = `JWT_SECRET` setting.
2. Apply the migration containing the two policies above.
3. Backend release adds `sub` + `role` to the JWT (additive; existing consumers unaffected).
4. Clients can begin opting into presence.

Steps 1 and 2 are server-only and reversible. Step 3 is an additive backend release. Step 4 is per-client, gated on each client's surgery.

[^1]: Supabase, "Realtime Authorization." For Presence operations, `realtime.messages.extension` is the literal string `'presence'`. <https://supabase.com/docs/guides/realtime/authorization>

---

## 7. Backend role

**The Render backend is not in the data path for presence.**

This is the most common misunderstanding readers will arrive with — given that `CONSTRAINTS.md` §2 frames the backend as the single gatekeeper, the natural assumption is that presence flows through it as well. It does not.

| Concern | Where it lives |
|---|---|
| User auth (login, password, JWT mint) | Backend (unchanged). |
| Tracks, folders, R2 storage | Backend (unchanged). |
| Postgres persistence for everything other than presence | Backend (unchanged). |
| Presence-channel subscription | Client ↔ Supabase Realtime, direct. |
| Presence event publication (`track()`) | Client ↔ Supabase Realtime, direct. |
| Presence event delivery (`sync` / `join` / `leave`) | Supabase Realtime ↔ peer clients, direct. |
| RLS enforcement | Supabase, on `realtime.messages`. |

Under Path A1, the only backend touchpoint with Realtime is **at deploy time**: setting the project's legacy JWT secret to match `JWT_SECRET` and shipping the two additive claims. After that, the backend mints nothing for Realtime, signs nothing extra for Realtime, and proxies no Realtime traffic. Clients connect directly using their existing JWT and the public anon key.

This is a deliberate scope-narrowing — it keeps the backend out of a hot path it does not need to be in, and it lets presence scale on Supabase's infrastructure rather than Render's. `CONSTRAINTS.md` §2's "single gatekeeper" framing applies to **persistent user data** (Postgres, R2). Presence is not persistent user data; it is ephemeral connection state.

If a future feature needs the backend to *read* presence (for example, "which devices does this user have online right now?" served as an HTTP endpoint), the backend would subscribe to the channel as a service-role consumer — but that is a Week 3+ concern and out of scope for v1.

---

## 8. Lifecycle & edge cases

Thirteen cases. Each must be handled correctly for the bridg icon Nearby state to reflect reality without flicker. The 2000ms presence debounce in `BRIDG_ICON.md` §4b absorbs short-lived flaps but is not a license to publish noisy events.

### 1. Clean leave on logout

When a user logs out, the client calls `channel.untrack()` then `channel.unsubscribe()` before clearing the JWT from local storage. Peers receive a `leave` event immediately. The order matters — clearing the JWT first invalidates the connection mid-untrack and may leave a stale entry until the server-side timeout (case #3) evicts it.

### 2. Clean leave on app quit (graceful)

On a graceful quit (user closes the window, OS asks the app to terminate), the client calls `channel.untrack()` and `channel.unsubscribe()` in the appropriate platform shutdown hook (Electron: `before-quit`; web: `beforeunload`/`pagehide`; mobile: app lifecycle delegate / `AppState` change to `background` is **not** considered a quit — see case #6). Peers see a `leave` within the WebSocket close round-trip.

### 3. Force-quit timeout (server-side eviction)

When a client is killed without running its shutdown path (force-quit, `kill -9`, OS power loss), the WebSocket times out and Supabase Realtime evicts the presence entry. Empirically observed in our testing as **~45–60 seconds**; this is **not contractually guaranteed by Supabase** and may shift with infrastructure changes.

> TODO(verify): re-measure on the production Supabase tier we end up using, and capture the result here. Treat any value <30s or >120s as a signal that infrastructure has shifted.

Until eviction completes, peers will continue to see the dead entry. The bridg icon's Nearby debounce (§4b of `BRIDG_ICON.md`) is shorter than this timeout, so there is a window where the icon shows Nearby for a peer that no longer exists. This is acceptable — false positives on Nearby are recoverable; false negatives on Error are not.

### 4. Network loss timeout (same mechanism)

A network partition is functionally identical to case #3 from the server's perspective: the WebSocket drops, the entry is evicted on the same observed ~45–60s timeline. The client's local view differs — it knows it lost the network and can reflect that in its own UI immediately — but peers cannot distinguish network loss from force-quit.

### 5. 2000ms presence debounce on UI

Per `BRIDG_ICON.md` §4b cooldown rule #2: Dim ↔ Nearby transitions on the bridg icon require the underlying presence signal (online or offline for the user's peer set) to be stable for 2000ms. Flap-induced single-event bounces never reach the icon. This rule lives in the icon spec and is restated here so client implementers know not to bypass it for "snappier" feedback.

### 6. Mobile: leave channel on app backgrounding

When the mobile app backgrounds (`AppState` → `background` on iOS/Android), the client calls `channel.untrack()` and `channel.unsubscribe()`. iOS aggressively suspends backgrounded apps and the WebSocket will be terminated by the OS within seconds; pre-emptively leaving produces a clean `leave` event rather than waiting for the timeout in case #3. On foreground (`AppState` → `active`), the client re-subscribes and re-`track()`s with the same `device_id` (case #11).

### 7. Web: stay subscribed when tab backgrounds

Browsers throttle background tabs but typically do not terminate WebSocket connections. The web client **stays subscribed** when its tab is hidden — `visibilitychange` to `hidden` is ignored by the presence layer. The user is still online from the perspective of their other devices; throttling affects the rate of message processing, not the presence entry. Tab close (case #2 via `pagehide`) is the leave signal, not tab hide.

### 8. Desktop sleep/wake

On macOS sleep, Electron's main process is suspended along with the OS. The WebSocket is dropped; from the server's perspective this is case #4 (network loss). On wake, Electron's main process resumes, detects the dropped connection, and re-subscribes / re-`track()`s with the same `device_id` (case #11). The wake-side path is the same as any other reconnect; no special-case logic.

### 9. Token expiry mid-session

Custom HS256 JWTs have a 30-day expiry per `CONSTRAINTS.md` §1. A long-lived desktop install can cross that boundary while the Realtime connection is open. When the app obtains a refreshed JWT (or, in v1, prompts the user to re-authenticate — there is no refresh token today), it calls `supabase.realtime.setAuth(newJwt)`. The new token applies to active channels automatically; no re-subscribe is required.[^2]

In v1, since there is no refresh token, "token expiry mid-session" actually means "the user re-logged in and we got a fresh token." The flow is the same — `setAuth(newJwt)` after re-login.

[^2]: Supabase, "supabase-js Realtime — `setAuth`." The token is preserved across channel operations including resubscribe. <https://supabase.com/docs/reference/javascript/realtime-setauth>

### 10. Reconnect after transient disconnect

Supabase Realtime auto-reconnects on transient drops. On re-establishment, the client re-`track()`s with the **same payload** as the original join — same `device_id`, same `joined_at`. Peers see this as a `leave` followed by a `join` with the same `device_id`; UI consumers (the bridg icon) treat consecutive same-`device_id` events as continuation, not as two separate sessions.

`joined_at` is intentionally stable across reconnects — it represents the start of the user's intent to be present, not the start of the current TCP connection.

### 11. Multiple tabs / multiple installs of same client type

`device_id` is per-install. Two browser tabs of the same web build are two installs from this protocol's perspective — each generates and persists its own `device_id` (web stores it in `localStorage` alongside `sb_token`). The channel handles N>1 entries with the same `client` value naturally; consumers see `[{client: "web", device_id: "a"}, {client: "web", device_id: "b"}]` and either de-duplicate by `client` (if the UI cares about kinds) or by `device_id` (if it cares about installs).

The bridg icon does not de-duplicate — any peer entry counts as Nearby.

### 12. Peers list excludes self

When computing "is there another device online for this user," the local install **excludes itself** from the peer list before deciding. The Realtime `presenceState()` includes the local entry; a naive consumer that does not filter will always see at least one entry and incorrectly conclude Nearby. The filter is by `device_id` equality — every client must remember the `device_id` it tracked with and exclude that key from the peer set.

### 13. Channel teardown on user deletion / account switch

Account switch (logout-then-login, including switching to a different account on the same install) is logout (case #1) followed by a fresh subscribe to the new user's channel. Hard user deletion is currently not a flow SoundBridg supports (`CONSTRAINTS.md` §3 — soft-delete only for tracks; no user-delete endpoint exists). When it lands, deletion must trigger `untrack()` + `unsubscribe()` before the JWT is invalidated, otherwise the presence entry leaks until the server-side timeout.

---

## 9. Client integration shape

This section is high-level only — per-client implementations are separate future surgeries with their own session, verification, and commit per `PHILOSOPHY.md` §6.1 ("one surgery per session"). What follows is the contract every client implementation must satisfy.

### Common shape

Every client implementation owns:

1. **A persistent `device_id`.** Generated once per install (UUID v4 acceptable). Persisted in the same store as the JWT — `localStorage` on web, `electron-store` on desktop, `expo-secure-store` on mobile. Never regenerated unless the install is wiped.
2. **A presence module.** Single-purpose: subscribe, `track()`, expose `peers` to UI consumers, expose lifecycle hooks (login, logout, foreground, background, network change), unsubscribe.
3. **Self-exclusion from the peer list.** Per case #12. The bridg icon component should not need to know about `device_id` — the presence module returns peers-minus-self.
4. **2000ms debounce on UI consumers.** Per case #5 / `BRIDG_ICON.md` §4b. The presence module should expose either a debounced peer-count signal or raw events for consumers to debounce; either is valid as long as the icon never receives un-debounced flaps.

### Per-client surgeries (future)

These surgeries are tracked separately and not designed in this document.

- **`soundbridg-frontend/` web** — first to ship presence wiring, since it is the simplest deploy and the canonical reference. Adds `@supabase/supabase-js` (already absent today; `package.json` lists only `react` + `react-dom` per `ARCHITECTURE.md` §6).
- **`soundbridg-desktop/` Electron renderer** — second. Renderer process subscribes; main process is uninvolved. The renderer's CSP (`PHILOSOPHY.md`-adjacent constraint, `BRIDG_ICON.md` §5d) permits the Supabase WebSocket since `connect-src` is not currently restrictive.
- **`Built-Apps/soundbridg-mobile/` Expo / React Native** — third. Uses `@supabase/supabase-js` with a React Native polyfill for WebSocket; `AppState` integration handles cases #6 and #11.

Each surgery: install client lib, wire presence module, hook the bridg icon's Nearby trigger (replacing the stub described in `BRIDG_ICON.md` §4c), verify end-to-end against another peer.

---

## 10. Observability & failure modes

Presence is ephemeral, so it cannot be debugged by reading a database. Observability is event-driven and short-lived.

### What is loggable

- **Subscribe / unsubscribe events** — log on entry and exit with `{user_id, device_id, client, app_version}`. Useful for "did this client even join the channel?"
- **`track()` payload** — log on call. Useful for "what payload did this device advertise?"
- **`sync` / `join` / `leave` event counts** — log at WARN if events arrive at >10/s for a single user (a legitimate user has 1–5 devices; high event rates indicate a thrash bug).
- **RLS denials** — Supabase logs these on the project's Realtime log surface. A denial here is almost always either a missing `role: "authenticated"` claim or a bad channel name.
- **WebSocket close codes** — log on disconnect. `1000` is graceful, `1006` is abnormal, `4xxx` are Supabase-specific (auth failure, RLS denial).

### What is not loggable

Per `CONSTRAINTS.md` §6 ("No server-side logging of tokens, passwords, R2 credentials"):

- **Never log the JWT.** Not on subscribe, not on `setAuth()`, not in error paths.
- **Never log the anon key in a way that suggests it is sensitive** — it is not, but normalizing the pattern of logging keys leads to leaks of the service-role key elsewhere.
- **Do not log `device_id` to a third-party analytics surface without user consent.** It is a stable per-install identifier; treat it like a fingerprint.

### Debugging "user shows offline but is online"

Common-case triage path:

1. **Is the JWT valid?** Decode the JWT the client is using; check `exp` is in the future, `sub` matches the user, `role: "authenticated"` is present. A missing `role` is the single most common cause.
2. **Is the channel name right?** It is `presence:user:{user_id}` where `{user_id}` is the JWT `sub`. A mismatch (using `email`, using a stale ID) silently RLS-denies.
3. **Did `track()` actually run?** If the client subscribed but never tracked, peers see no entry. Check the per-client log for the `track()` call.
4. **Is the local install excluding itself by mistake?** Per case #12, self-exclusion is required — but if it filters by `client` instead of `device_id`, two web tabs of the same user will hide each other. Check the filter predicate.
5. **Is it a debounce artifact?** Per case #5, the icon waits 2000ms before transitioning. If the user expects an instant green dot, that is a misunderstanding of the spec, not a bug.
6. **Is it the eviction timeout?** Per cases #3 and #4, a force-quit or network-loss peer takes ~45–60s to disappear from peer lists. If the user expects an instant `leave` for a peer that crashed, that is the timeout, not a bug.

### Debugging "user shows online but is offline"

The Nearby state is a false positive risk during the eviction window (cases #3, #4). False-positive triage:

1. Check `joined_at` of the stale entry against current time — entries older than ~60s past their device's last-known activity are likely awaiting eviction.
2. Force a `leave` from the affected device when possible (logout, restart). Eviction is server-driven; there is no client-side flush of another peer.

A persistent false positive (>5 minutes) is a bug — escalate to Supabase.

---

## 11. Open items / future work

Tracked separately; not designed here.

- ~~**Path A2 / A3 auth migration.**~~ A2 shipped Week 3 (see `docs/migrations/2026-04-jwt-hs256-to-es256.md`); A3 (Supabase-issued tokens) remains out of scope and would reopen `CONSTRAINTS.md` §1.
- **Sync-state Broadcast events.** Cross-device upload notifications, conversion notifications, share-mint notifications. Same Realtime infrastructure, different primitive (`broadcast` extension, different RLS policies, different payload shape). Separate document, Week 3+.
- **`last_active_at` payload field.** Activity granularity for surfaces that need "30s ago" semantics. `presence_v: 2`.
- **Backend service-role presence consumer.** Server-side subscription so HTTP endpoints can answer "is this user online?" without proxying Realtime to every API caller. Coordinated with whatever feature first needs it.
- **Meaning C presence (Bluetooth / WiFi-Direct).** AirDrop-style nearby-device discovery for the mobile-to-mobile share case in `PHILOSOPHY.md` §5. Mobile-only, not Realtime-based.
- **Production tier eviction-timeout re-measurement.** Outstanding TODO from §8 case #3.

---

## 12. Glossary

- **Meaning A presence** — a single user's own devices learning that each other are online. The model used in this document.
- **Meaning C presence** — Bluetooth / WiFi-Direct local-network proximity discovery between physical devices. Out of scope here; mentioned only to disambiguate.
- **`device_id`** — a stable per-install identifier generated by the client, persisted alongside the JWT, and included in every presence payload. Survives logout/login. Re-rolls on uninstall/reinstall.
- **`presence_v`** — the schema version of the presence payload. Increments only on breaking changes; additive fields do not require a bump.
- **Path A1** — the auth model used for presence v1: SoundBridg's existing custom HS256 JWT, signed with `JWT_SECRET`, validated by Supabase using the project's legacy JWT secret set to the same value.
- **Path A2** — future auth model: asymmetric JWT keys.
- **Path A3** — future auth model: Supabase-issued tokens.
- **Anon key** — Supabase's public client key. Designed to be exposed in client bundles; access is gated by RLS, not by the key itself. See `CONSTRAINTS.md` §2.
- **Service-role key** — Supabase's privileged backend key. Bypasses RLS. Backend-only, never shipped to clients.
- **Private channel** — a Realtime channel whose access is gated by RLS policies on `realtime.messages`. The opposite of a public channel.

---

*End of presence protocol. Per-client implementations land as separate Week 3+ surgeries; cross-spec dependencies are tracked in `BRIDG_ICON.md` §4c (Nearby state's presence trigger) and `CONSTRAINTS.md` §1 + §2 (auth and key boundaries).*
