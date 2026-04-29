# SoundBridg — Roadmap

The 12-week plan for SoundBridg 2.0. This document defines **what we're building, in what order, and why**. It is the canonical reference every per-week session opens with.

Companion to `ARCHITECTURE.md` (descriptive), `CONSTRAINTS.md` (non-negotiable rules), `PHILOSOPHY.md` (product intent), `BRIDG_ICON.md` (icon spec), `DESIGN_TOKENS.md` (typography + color), and the forthcoming `PRESENCE_PROTOCOL.md` (real-time channel design).

This is a **living spec**, not a contract. Dates are deliberately absent — weeks are work-units, not calendar weeks. Re-scoping is expected. The git history is the changelog.

---

## 0. The product thesis (one sentence)

SoundBridg is the universal AirDrop for music producers — a cross-platform, producer-specific, zero-cognitive-load way for a beat to travel from export dialog to every device (and every collaborator) the producer owns, without them ever thinking about sync.

That sentence is the lens every roadmap decision passes through. If a proposed deliverable doesn't move the product toward that thesis, it gets cut or deferred.

---

## 1. The four phases

| Phase | Weeks | Theme | What ships |
|---|---|---|---|
| 1 | 1–2 | Foundation | Codebase rescue, canonical docs, design language locked |
| 2 | 3–5 | Universal Bridg | Widget + share-sheet + mobile polish — internet-presence demo |
| 3 | 6–8 | Surface refinement | Desktop UX overhaul + website rebuild per Adam's feedback |
| 4 | 9–12 | Proximity + project bundling | True nearby-device discovery + FL Studio project-file sync |

**Phase 1 ships the foundation no user sees but every later week depends on.** Phase 2 ships the first thing users will *notice* (the AirDrop-killer widget). Phase 3 polishes what already works. Phase 4 ships the genuinely-novel feature that no other producer tool has — physical proximity sync.

---

## 2. Phase 1 — Foundation (Weeks 1–2) ✅ COMPLETE

The phase that paid down everything we built in haste before the refinement.

### Week 1 — P0 surgeries

Goal: get the existing codebase from "shipped but fragile" to "shipped and verified."

- ✅ Migrate codebase out of iCloud Desktop sync (file-corruption risk eliminated)
- ✅ Rotate leaked GitHub PAT, migrate all 5 repos from HTTPS → SSH
- ✅ Write `ARCHITECTURE.md` (descriptive system map) and `CONSTRAINTS.md` (normative rules)
- ✅ Write `PHILOSOPHY.md` (product intent, design opinions, forbidden patterns)
- ✅ Surgery #1: restore `entitlements.mac.plist` (commit `67291e7`)
- ✅ Surgery #2: remove dead SyncGroups UI (commit `419df75`)
- ✅ Surgery #3: 10 GiB upload quota enforcement + admin storage stats endpoint (commit `59a745a`)

### Week 2 — Design language + sync primitives

Goal: define the visual + protocol foundation Phase 2 builds on. Specs only — no client code yet.

- ✅ #1 — `BRIDG_ICON.md` 5-state machine spec (commit `79b1fdc`)
- ✅ #3 — `DESIGN_TOKENS.md` typography lock + `PHILOSOPHY.md §3.5` (commit `40d8388`)
- ✅ #4 — `DESIGN_TOKENS.md §8` color tokens + dual-theme + `BRIDG_ICON` reconciliation (commit `225ed74`)
- ⬜ #2 — `PRESENCE_PROTOCOL.md` real-time channel design (in progress)

**At Phase 1 close**, the codebase has six canonical docs, three production-verified backend surgeries, and zero client-code changes from the design-language work. Phase 2 turns the specs into shipping product.

---

## 3. Phase 2 — Universal Bridg (Weeks 3–5)

Goal: ship the AirDrop-killer. By end of Phase 2, a producer who renders in FL Studio sees the result on their phone within seconds, accessible from a single tap on the iOS Control Center widget.

### Why this is the load-bearing phase

Phase 2 is what turns SoundBridg from "a sync tool that exists" into "a thing producers tell their friends about." The widget is the demo moment. Everything in Phase 1 was infrastructure; Phase 2 is the first user-facing leap.

**Demoable target by end Week 5**: a producer renders in FL Studio on Mac → their iPhone Control Center widget shows the new file → one tap plays it. The latency goal is sub-10 seconds end-to-end. This is the Fellows Program demo.

### Week 3 — Mobile foundation + presence implementation

Goal: stand up the per-client real-time + design-token implementations on the most underbuilt client (mobile).

- **Mobile design-token migration** — implement `DESIGN_TOKENS.md §1-7` (typography) + §8 (color). Inter via `expo-font`, dark/light theme objects, hex → token swap across `lib/theme.ts` and every `<Text>` site. Fix the icon-rasterizer gold drift (`#C8A555` → `#C9A84C`) and `app.json` background drift.
- **Mobile presence subscription** — implement `PRESENCE_PROTOCOL.md` on RN: subscribe to `presence:user:{user_id}`, track on app foreground, untrack on background, render bridg icon Nearby state.
- **Mobile bridg icon component** — implement the 5-state component per `BRIDG_ICON.md §5b`, wired to presence channel.
- **Backend JWT payload addition** — small surgery to add `sub` and `role: "authenticated"` claims to all token-issuing endpoints (login/signup), enabling Path A1 Realtime auth.
- **Backend JWT algorithm migration HS256 → ES256** — generate P-256 keypair, import public half to Supabase as a standby signing key, store private half in Render env (`JWT_PRIVATE_KEY` + `JWT_KID`), switch backend mint+verify from HS256/`JWT_SECRET` to ES256/`JWT_PRIVATE_KEY`. One-time forced re-login for all active sessions. Required to unblock mobile presence wiring (Path A1 was rendered unreachable by Supabase's ECC signing-key migration); see `docs/migrations/2026-04-jwt-hs256-to-es256.md`.

**Why mobile first**: it's the client with the most drift (GitHub-Dark palette, no Inter, no presence wiring at all) and also the client where the widget will live. Building the foundation on mobile means the widget has somewhere to plug in.

### Week 4 — iOS widget + share sheet integration

Goal: ship the iOS Control Center widget and share-sheet target. This is the AirDrop-killer.

- **iOS widget** — Control Center / Lock Screen widget that shows the most recent N synced tracks, last-sync timestamp, and the bridg icon state. Tap-through opens the file in the SoundBridg app for instant playback.
- **iOS share sheet target** — accept audio files from any app (Files, Voice Memos, third-party DAWs), upload via the existing `/api/tracks/upload` endpoint with the user's stored token. This makes SoundBridg appear in the system share sheet wherever audio lives on iOS.
- **Background upload reliability** — iOS aggressively suspends apps; the widget data refresh and any pending uploads must use `URLSession` background sessions to survive suspension.

**Why this matters**: the widget is the moment producers stop opening Dropbox or AirDrop. It's the surface where SoundBridg's "zero cognitive load" promise becomes concrete.

### Week 5 — Android tile + cross-client polish + Fellows demo prep

Goal: feature parity on Android, polish the demo flow, ship the Phase 2 milestone.

- **Android Quick Settings Tile** — Android equivalent of the iOS widget. Shows latest synced tracks, last-sync timestamp, bridg icon state. Tap-through opens app.
- **Android share sheet (intent filter)** — accept audio files from any Android app, upload via existing API.
- **Web bridg icon component + presence** — implement `<BridgIcon />` per `BRIDG_ICON.md §5a`, wire to presence channel, replace 3 inline SVG copies in `Navbar.jsx`/`Home.jsx` with the component. Web design-token migration (Inter self-hosted, hex → token sweep).
- **Fellows Program demo flow** — end-to-end rehearsal: FL Studio render on desktop → file appears on iPhone widget within 10s. Polish edge cases (network loss, app cold start, peer-online indicator timing).
- **Audio player refinement** — remove redundant linear seek slider on mobile now-playing screen; scrubbing happens on the waveform itself per PHILOSOPHY §3.2. Waveform peaks reflect actual audio amplitude (loud beats render tall bars, quiet sections short bars) — backend surgery to extract peaks at upload time and serve via additive endpoint or expanded track metadata; mobile renders from served peak data.

**At Phase 2 close**, SoundBridg has a credible "show, don't tell" demo. The thesis ("the universal AirDrop for music producers") has a 30-second proof.

---

## 4. Phase 3 — Surface refinement (Weeks 6–8)

Goal: bring the existing surfaces (desktop tray app, marketing website) up to the same quality bar as the new mobile widget. This is the phase that addresses Adam's PDF feedback.

### Why this comes after Phase 2, not before

Polishing surfaces nobody sees yet is wasted effort. Phase 2 produces the surfaces users will actually arrive on. Phase 3 polishes them with knowledge of what users do once they're inside.

### Week 6 — Desktop tray rewrite

Goal: rebuild the Electron tray app with the design-token system, the bridg icon state machine, and the presence layer.

- **Desktop design-token migration** — `renderer/styles.css` and `renderer/main.js` swept for hex → token, Inter bundled and self-hosted, `--green`/`--orange` deletions per `DESIGN_TOKENS.md §8.7.2`.
- **Desktop tray icon = pre-rasterized PNG-per-state** — implement `BRIDG_ICON.md §5c`'s template-image approach: 5 PNGs (18×18 + @2x), `tray.setImage()` swap on state change.
- **Desktop renderer presence subscription** — implement `PRESENCE_PROTOCOL.md` on Electron renderer: subscribe to user channel, render in-window bridg icon component (inline SVG string per CSP).
- **Desktop UX cleanup** — apply Adam's PDF feedback to the tray-window content surfaces (sync log readability, status copy, settings layout). Specifics depend on what's in Adam's PDF; flag for review at start of Week 6.

### Week 7 — Website rebuild

Goal: rebuild the soundbridg.com marketing surface to match the product's visual identity and explain the AirDrop-killer thesis clearly.

- **Marketing site IA + copy** — landing page, product page (widget showcase), download page (mac/iOS/Android), pricing page, footer. Copy explicitly leans on the thesis sentence.
- **Marketing site design-token migration** — same pattern as web app: Inter self-hosted, color tokens, dark default + light support.
- **Hero animation** — single keyframe of the widget moment ("file appears on phone, tap, plays") as the hero. No video; pure CSS/SVG/HTML animation per `PHILOSOPHY §3.1` (stillness over motion).
- **Adam's PDF feedback applied** — specifics depend on PDF; flag for review.

### Week 8 — Connect tissue + cleanup

Goal: smooth the seams between mobile, desktop, and web. Pay down the to-do list accumulated through Phases 1-2.

- **Cross-client copy consistency** — every "synced," "syncing," "uploading" string sourced from a single i18n / strings file. No client invents its own copy.
- **Onboarding flow polish** — first-run experience on each client. Producer downloads desktop app → installs → signs in → sees bridg icon → renders in FL Studio → file appears. Every step examined for friction.
- **Accumulated to-dos paid down** — Cloudflare R2 billing alert, JWT rotation hygiene doc, Image-Line iCloud migration documentation, `CONSTRAINTS.md §11` resolved-items strikethrough, any deferred web-surgery items.
- **Light-mode toggle UI** — first surface (web) ships the actual `[data-theme]` toggle. Spec'd in Phase 1 but not user-visible until here. Per the Option A decision, this is launching dark-only across surfaces; web is the test bed for the eventual mobile/desktop rollout.

**At Phase 3 close**, every surface SoundBridg owns is at the same quality bar. The product feels coherent.

---

## 5. Phase 4 — Proximity + project bundling (Weeks 9–12)

Goal: ship the genuinely-novel features that distinguish SoundBridg from "yet another sync tool." This is where SoundBridg becomes a *producer* tool, not just a *file* tool.

### Two big rocks

1. **Meaning C presence (true proximity)** — beyond "is my other device online?", to "is my collaborator's phone within 30 feet of my laptop?" Uses Bluetooth LE / WiFi Direct via Google's Nearby Connections SDK on Android, equivalent native APIs on iOS, BLE on macOS.
2. **FL Studio project bundling** — sync the `.flp` file plus all sample/preset dependencies as a single bundle. Solves the "I sent you the project but you don't have my samples" problem that every producer has lived through.

### Week 9 — Meaning C presence — protocol design

Goal: design the proximity protocol the same way Phase 1 designed the internet-presence protocol. Spec only, no implementation.

- **`PROXIMITY_PROTOCOL.md`** — canonical doc alongside `PRESENCE_PROTOCOL.md`. Covers: discovery primitives per platform (Nearby Connections on Android, MultipeerConnectivity on iOS, BLE on macOS), advertisement payload, encryption / pairing, opt-in UX, fallback to internet-presence when proximity unavailable.
- **Bridg icon state extension** — proximity is a *stronger* signal than internet-presence. The icon spec needs a new state (or stronger blue-dot variant) for "peer is *physically nearby*." Edit `BRIDG_ICON.md §3` to add the state with a color decision.
- **Cross-platform discovery feasibility audit** — confirm what's possible across the {macOS, iOS, Android} matrix. iOS-Android proximity is the historical pain point; document constraints honestly.

### Week 10 — Meaning C presence — implementation

Goal: ship the proximity discovery on at least one platform pair (likely macOS↔iOS) end-to-end.

- **iOS proximity implementation** — MultipeerConnectivity advertise + browse, paired with the user's account (auth-coupled discovery prevents seeing every random SoundBridg user nearby).
- **macOS proximity implementation** — Core Bluetooth advertise + scan, same auth-coupled pairing.
- **Cross-device proximity handshake** — when iOS sees macOS (or vice versa) belonging to the same user, presence escalates from internet-presence to proximity-presence. Bridg icon state updates accordingly.
- **Android proximity** — if time permits in Week 10, otherwise pushed to Week 11.

### Week 11 — FL Studio project bundling

Goal: solve the "I sent you the project but it's missing 47 samples" problem.

- **`.flp` file walker** — desktop reads the FL Studio project file, extracts all sample/preset references, locates them on disk.
- **Bundle format** — define `.sbproject` (or similar) — a zip containing the `.flp` + a sidecar `manifest.json` + every referenced sample/preset relative-pathed. Single file, portable, opens cleanly on a recipient's machine if they have FL Studio.
- **Upload + share flow** — bundle uploads through the existing `/api/tracks/upload` pipeline (treat as opaque blob), with content-type marking it as a project bundle. Recipient downloads + auto-extracts on open.
- **Reference resolver** — handles missing references gracefully (some samples may be DRMed/licensed and can't legally bundle). Recipient sees a list of missing items at open time.

### Week 12 — Phase 4 polish + 2.0 launch readiness

Goal: round off Phase 4, prepare for the actual public launch.

- **Proximity + bundling integration** — when a proximity peer is detected, tap-to-share project bundles directly. This is the "AirDrop, but for FL Studio projects, including samples" moment.
- **Launch checklist** — App Store / Play Store listings, marketing-site final pass, Twitter/Instagram launch assets, Fellows Program graduation demo (if applicable), pricing/billing live, support docs.
- **Operational readiness** — Cloudflare R2 billing alerts (deferred from Phase 1's to-do), Sentry / error monitoring on backend, basic analytics on widget engagement.
- **Light mode rollout to mobile and desktop** — per the Option A decision in Phase 1, light mode landed in web first (Week 8). If web's light-mode QA went smoothly, mobile and desktop ship their toggles here.

**At Phase 4 close**, SoundBridg 2.0 is ready to launch publicly: the universal AirDrop for music producers, with widget + share-sheet on mobile, polished tray app on desktop, marketing site that explains it cleanly, and proximity + project-bundling features no competitor has.

---

## 6. What's deliberately NOT in the 12-week plan

Cataloged here to prevent scope creep:

- **Multi-user collaboration / shared sessions / real-time co-listening.** Multiplayer is a Phase-5+ concern. The Phase-4 proximity peer is your *own* device, not someone else's.
- **Cloud DAW / browser-based audio editor.** Producers use FL Studio, Ableton, Logic. SoundBridg moves files between them; it doesn't try to *be* them.
- **Stems / multi-track project formats beyond FL Studio.** Phase 4's bundling is FL-only because that's Rayan's primary tool. Ableton / Logic bundling is post-2.0.
- **Public sharing / fan-facing distribution / "release" features.** SoundBridg is a producer-to-producer tool. Fan-facing distribution is SoundCloud's job.
- **Storage tiers / paid plans beyond the existing free tier.** Pricing exists (the 10 GiB quota implies it), but tier-design is a post-launch business decision, not a build phase.
- **Stem separation / mastering / AI features.** Out of scope for 2.0. Maybe ever — they're a different product.

---

## 7. Re-scoping rules

This document is a living spec. Re-scoping is expected when reality intrudes. The rules:

- **A week's scope can be moved into the next week** without ceremony. Just update this doc in the same commit as the work that confirms the move.
- **A week can be split or replaced** by a more specific sub-plan. Update this doc, commit, move on.
- **A whole phase cannot be re-ordered without deliberate review.** Phase order encodes load-bearing dependencies (e.g. Phase 2's widget depends on Phase 1's design tokens; Phase 4's proximity depends on Phase 2's mobile foundation).
- **Anything that violates `PHILOSOPHY.md` is rejected**, regardless of which phase it falls in. The thesis is the lens.
- **The 12-week count is a planning device, not a deadline.** If Phase 2 takes four weeks, Phase 4 starts later. The order matters; the calendar doesn't.

---

## 8. How a session opens

Every Claude session — fresh chat, fresh Claude Code instance — opens by reading the canonical docs in this order:

1. `ARCHITECTURE.md` — what exists today
2. `CONSTRAINTS.md` — what cannot change
3. `PHILOSOPHY.md` — what we're trying to build and why
4. `ROADMAP.md` (this doc) — where we are in the plan
5. The phase-specific spec docs that apply to the current week (`BRIDG_ICON.md`, `DESIGN_TOKENS.md`, `PRESENCE_PROTOCOL.md`, eventually `PROXIMITY_PROTOCOL.md`)

That sequence loads the full context any session needs. The roadmap closes the loop: it's the answer to "what are we doing, and what comes next?"
