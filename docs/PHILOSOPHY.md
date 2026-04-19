# SoundBridg — Philosophy

The design and product intent for SoundBridg 2.0. Where `ARCHITECTURE.md` describes the system and `CONSTRAINTS.md` lists what not to break, this file describes what we're trying to build and the taste that governs every decision.

Read before every session. When a proposed change feels off but doesn't violate a constraint, come back here — most "off" comes from drift against philosophy.

---

## 1. Product thesis

**SoundBridg is the universal AirDrop for music producers.** Cross-platform. Producer-specific. Zero cognitive load.

A producer exports a beat in FL Studio. Before they've closed the export dialog, the file is already on their phone and anyone they've shared it with can listen. They didn't think about sync, didn't open a browser, didn't drag a file anywhere. The work moved because the work exists — nothing else.

We are not Dropbox. Dropbox moves files. We move beats. Every surface, every copy string, every default is tuned for one user: someone making music who does not want to think about where the file is.

## 2. The one-thing test

**If a producer can't articulate what SoundBridg does in one sentence without coaching, we've failed.**

Every feature, every screen, every marketing page passes through this test. Not "can they find it" — can they *say* it, unprompted, after five minutes of use. The mechanic is harsh because the brand is narrow on purpose.

Current one-sentence answer: *"It auto-syncs the beats I export to every device I own and makes them easy to share."*

If a feature requires a second sentence to explain, it belongs in a different product or a later version. Split the brand before you split the sentence.

## 3. The five design opinions

These are not guidelines. They are the opinions the product expresses. A change that violates any of these should be rewritten until it doesn't.

### 3.1 Stillness over motion
Motion only expresses state change. Never style. A spinner means something is loading. A fade-in means something just arrived. A pulse means something needs attention. If an element moves without a state-change cause, the motion is noise and must be removed.

Hover states that scale, gradients that shift, backgrounds that drift — all forbidden. The product is a studio tool; studio tools are still until the user acts.

Corollary: *silence is legitimate*. A screen that doesn't animate is not broken.

### 3.2 Audio-first primitives
Audio is the protagonist, not the payload. Every list of tracks shows waveforms, not file icons. Every track can be played in one tap or click — never two, never "open first, then play." Titles, formats, and sizes are secondary metadata displayed at reduced weight.

Specifically:
- Waveform thumbnails, not generic art.
- Play/pause is always the primary affordance in any track row.
- Scrubbing works by dragging the waveform itself.
- Duration is shown in `m:ss`, never in seconds-only or timecode-flavored formats.

If a screen shows tracks without sound, it's a file manager — and file managers are not what we're building.

### 3.3 Sync status is sacred
The bridg icon is the global state indicator. Its state — idle, syncing, error, offline — is always visible, always trusted, always the first answer to "is my stuff safe?"

Rules:
- The bridg icon appears in every chrome surface across every platform (desktop menubar, mobile nav, web header).
- Its state is derived from real signals (ongoing upload, recent error, network loss). Never decorative. Never optimistic.
- The icon has exactly five states. No other appearances exist:
  1. **Dim** — idle; nothing to sync, no recent activity.
  2. **Solid gold** — all synced; everything is up to date.
  3. **Pulsing gold** — syncing now; an upload is in flight.
  4. **Gold with blue dot** — a nearby device is available.
  5. **Gold with red dot** — error; needs attention.
- Clicking the icon reveals what the state means in plain language. "Syncing 2 of 5" beats "Processing."
- When sync is healthy, the icon is calm. When sync fails, the icon is the one thing that changes color. Everything else stays still.

Sync confidence is the emotional contract of the product. Break it once and the user stops trusting the sync. Break it twice and they leave.

### 3.4 Gold is earned
`#C9A84C` (brand gold) is reserved for **success moments and bridg identity only**. Not buttons by default. Not borders. Not accents on every third card.

Permitted uses:
- The bridg icon itself.
- A successful sync confirmation ("Synced ✓").
- A successful share ("Copied").
- The primary CTA on the first-run "Connect your studio" flow.

Forbidden uses:
- Link color.
- Hover states.
- Selected-state highlights (use ocean `#1B3A5C` instead).
- Category tags, icons in rows, settings toggles.
- Any decorative "accent" purpose.

When gold appears, something meaningful just happened. If it appears without meaning, it stops meaning anything.

### 3.5 One font, one scale, no exceptions
- **Font:** Inter, full stop. No serif, no display face, no monospace except for timecode and file paths. All weights are Inter.
- **Scale:** The exact modular scale is TBD — it will be finalized in the Week 2 design language surgery and locked here when decided. Until then: consistency matters more than the specific values. Don't introduce one-off values to solve layout problems; wait for the scale to be defined.
- **Weight:** 400 for body, 500 for emphasis, 600 for headings, 700 reserved for the single most important label on a screen. 300 and 800 do not exist in this product.
- **Line-height:** 1.5 for body, 1.2 for headings. No exceptions.

If a mockup contains a third font, it's wrong.

## 4. Color system

Neutrals carry the 95%. Blue carries interaction. Gold carries success. Red carries error. Nothing else carries anything.

### Neutrals (95% of pixels)
Dark mode is the default. Light mode is a supported second. Both share the same information density and hierarchy — only the luminance inverts.

- **Dark:** `#0A0A0F` (base), `#111118` (card), `#1A1A22` (elevated), `#2A2A33` (border), `#8A8A95` (secondary text), `#E8E8EE` (primary text).
- **Light:** `#FAFAFC` (base), `#FFFFFF` (card), `#F0F0F4` (elevated), `#D8D8DE` (border), `#666670` (secondary text), `#18181C` (primary text).

### Ocean blue — `#1B3A5C`
Reserved for **interactive state**. Selected rows, focused inputs, active tabs, progress fills, pressed buttons. If the user can act on it or has acted on it, it's ocean. Never decoration.

### Brand gold — `#C9A84C`
See §3.4. Success and bridg identity only.

### Red — restricted to two surfaces
Red is not a system color. It appears in exactly two places: the bridg icon's error-dot state (see §3.3) and destructive confirmation dialogs (e.g. "Delete forever"). The value `#EF4444` exists only on those two surfaces. Red is never used for text, borders, buttons, links, warnings, or any other UI signal. Warnings are expressed in copy — the word "Warning" is more useful than a color.

No other hues exist in the product. No teal, no purple, no category-coded track types, no charted data with five series of colors. If information requires color-coding beyond this palette, rethink the information.

## 5. Platform roles

Each platform has one job. Feature parity is not a goal. Coherence of role is the goal.

### Desktop = produce
Always running. Watches the user's export folders. Uploads without being asked. Lives in the macOS menubar. The UI shows the current sync state, the list of watched folders, and power controls (interval, history, clear). It is deliberately not a media player. A producer opens the main window only when something is wrong or they're changing what gets watched.

What desktop has that others don't: folder watching, launch-at-login, sync interval, clear-history, retry-backoff, always-on-ness.

What desktop does *not* have: playback, library browsing, sharing, conversion. These are deliberate omissions — the desktop's job is to move the file, not to handle it.

### Mobile = consume + share
A producer opens the phone to *hear their latest beat back in the car*, or to *send one to a collaborator on the couch*. The mobile app is for the listening moment and the sharing moment, nothing else.

What mobile has that others don't (or will have, in order):
1. One-tap playback of the latest upload.
2. Background audio.
3. Push notifications on successful upload from desktop.
4. Nearby-devices share (AirDrop-style).
5. Home-screen widget showing latest track with play/pause.

What mobile does *not* have: file upload, conversion, folder management, account settings beyond sign-out. If a producer is tapping through settings on mobile, the app failed.

### Web = access-anywhere
The fallback, not the flagship. When a producer is on a borrowed laptop or a studio they don't own, they open the browser, log in, and get their library. Web is a **functional subset of desktop**, not a parallel product. It never does something desktop doesn't — it just does it from anywhere.

What web has: library browsing, playback, download, share link generation, account management.

What web does *not* have: folder watching, auto-sync, upload-heavy producer flows (web upload exists for one-offs; real producers are on desktop). The web UI should not grow to match the desktop feature-for-feature — that's the trap §8 names explicitly.

Public share links (`/shared/<token>`) are part of web's role: they're the only surface that works without authentication, and they're the on-ramp for collaborators who may eventually become users.

## 6. Execution discipline

How we build. These rules come from the observation that SoundBridg has accumulated drift from exactly the opposite of each of them.

- **One surgery per session.** A session has one scope. If a second scope appears mid-session, it becomes the next session, not a second commit in this one.
- **Read `ARCHITECTURE.md`, `CONSTRAINTS.md`, `PHILOSOPHY.md` before every session.** Not skim. Read. They are short on purpose. Drift begins when the reader skips the preamble.
- **Full verification after every surgery.** Run the affected platform(s) end-to-end — not just "it compiles." A frontend change is verified in a browser. A desktop change is verified by installing the built DMG. A backend change is verified against a live client.
- **Staged rollout.** Backend changes ship first and bake for at least a day before any client calls the new surface. Electron updates lag web by a release. Mobile OTA updates lag backend by a release. No simultaneous multi-repo deploys unless a rollback path is documented in advance.
- **If the change violates a constraint, stop.** Reopen `CONSTRAINTS.md`, decide if the constraint needs to change, document that decision, then proceed. Don't route around it.
- **If the change violates philosophy, rewrite the change.** Constraints are negotiable by deliberate update. Philosophy is the product — negotiating it means making a different product.
- **Checkpoint early, push often.** Every session that edits files ends with a commit. A session that can't produce a commit-worthy diff didn't accomplish anything worth keeping.

## 7. Forbidden patterns

These exist because they have all actually happened. Do not let them happen again.

- **Engineer-language in UI.** Never show a user: `sync_group`, `r2_key`, `deleted_at`, `user_id`, `shareable_token`, HTTP status codes, stack traces, `undefined`, `[object Object]`, or the literal string `null`. If the code has nothing useful to say, the UI says nothing useful. An empty state is better than a diagnostic.
- **Feature parity for its own sake across platforms.** "Mobile should have folder management because desktop has folder management" is the wrong sentence. The right sentence is "mobile should have folder management because a producer in context X on mobile needs to do Y." Without the latter, parity is noise.
- **Motion without meaning.** No entrance animations on page load. No micro-interactions that don't reflect state change. No parallax. No scroll-jacking. No "delightful" flourishes. The product has taste by being quiet.
- **Gold as decoration.** See §3.4. If a design reviewer can't explain why a given gold pixel is gold, it's wrong.
- **Dashboard syndrome.** Avoid the fate of every cloud storage product: a dashboard with storage gauges, recent activity feeds, upload counts, social-proof numbers, collaborator avatars, and "getting started" checklists. The home screen on every platform answers one question: *where's my last beat*.
- **Dialogs as load-bearing structure.** Modals are for destructive confirmations and one-off capture (share URL, rename). Do not chain modals. Do not use a modal for navigation. Do not use a modal because the flow didn't fit on a page.
- **Apologizing for the product in copy.** No "Oops!", no "We're still working on this," no "Sorry about that." Error copy is direct: what happened, what to do. If the bug is ours to fix, fix it — don't write copy that begs for patience.
- **Cross-platform copy divergence.** "Sync Now" on desktop, "Refresh" on web, "Pull updates" on mobile for the same action is a sign nobody owns the language. One verb per action across every platform.
- **Treating the web client as the design reference.** The web app accumulated features fastest; it is not the source of truth for shape. Desktop's menubar tray is the shape. Mobile's one-tap-play is the shape. Web should feel like those products, flattened into a browser tab.

---

## Closing

Every decision, when in doubt, resolves to one question: *does this make the next beat the producer exports feel closer to them than the last one did?* If yes, ship it. If no — or if you have to squint to see yes — it doesn't belong in SoundBridg 2.0.
