# SoundBridg — Bridg Icon Spec

The canonical specification for the bridg icon — the five-state sync indicator that serves as SoundBridg's single visual identity across every client. This document is normative: geometry, color, animation, and transition rules are rules, not suggestions.

Companion to `ARCHITECTURE.md` (descriptive), `CONSTRAINTS.md` (non-negotiable rules), and `PHILOSOPHY.md` (product intent). Every client implementation must match this spec pixel-for-pixel on geometry and rule-for-rule on state transitions.

---

## 1. Identity

The bridg mark — two piers joined by a single span — is the sole visual identity of SoundBridg, used as both the brand mark and the global sync-status indicator in every chrome surface on every client.

It replaces, effective this document:
- The waveform-bars tray icon embedded in `soundbridg-desktop/main.js` as `TRAY_ICON_18` / `TRAY_ICON_36`.
- The musical-note glyph (`&#9835;`) used on the desktop login screen.
- Any raster app icons in `soundbridg-desktop/assets/icon.png` or `Built-Apps/soundbridg-mobile/assets/{icon,adaptive-icon,favicon,splash}.png` that predate this spec.
- The three drifting inline SVG copies across `soundbridg-frontend` (`public/favicon.svg`, `src/components/Navbar.jsx`, `src/pages/Home.jsx`).

All of the above must be re-derived from the master SVG below as part of the per-client implementation surgeries that follow this spec.

---

## 2. Master SVG

The canonical geometry. Every client copy must match these values exactly.

```svg
<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none"
     stroke-linecap="round" stroke-linejoin="round">
  <path d="M9 18V6l12-2v12" stroke="var(--accent-gold)" stroke-width="2"/>
  <circle cx="6" cy="18" r="3" stroke="var(--accent-gold)" stroke-width="2"/>
  <circle cx="18" cy="16" r="3" stroke="var(--accent-gold)" stroke-width="2"/>
</svg>
```

**Canonical values (single source of truth — no alternates):**

| Property | Value |
|---|---|
| `viewBox` | `0 0 24 24` |
| Path `d` | `M9 18V6l12-2v12` |
| Left circle | `cx=6, cy=18, r=3` |
| Right circle | `cx=18, cy=16, r=3` |
| Stroke width | `2` |
| Stroke linecap / linejoin | `round` |
| Fill | `none` |
| Default stroke color | `var(--accent-gold)` → `#C9A84C` |

**Rendering notes:**
- The mark is **flat**. No drop shadow, no gradient fill, no stroke gradient, no bevel.
- The 24×24 viewBox is non-negotiable. Every client copy renders from this viewBox and scales via CSS / layout primitives. Do not re-author the path at another viewBox; scaling down for tray PNGs is a rasterization concern, not a geometry concern.
- The existing `soundbridg-frontend/public/favicon.svg` uses viewBox 32×32. It will be re-authored against the 24×24 master during the web implementation surgery.
- The "brand tile" (rounded-rect with gradient) that appears behind the mark in `Navbar.jsx` and `Home.jsx` is a **logo lockup**, not the mark itself. The state-machine bridg icon is always the bare mark — the lockup exists only in marketing contexts and OS-level app icons (desktop `.app`, mobile home-screen icon, browser favicon). See §5.

---

## 3. The five states

The mark has exactly five states. No other states exist, now or later.

Color tokens referenced here (`--gold`, `--blue-presence`, `--red-error`, `--surface-base`) resolve against the Week 2 Deliverable #4 token system. Placeholder hex values from `PHILOSOPHY.md §4` are listed for reference; once the token system lands, only semantic names are used in client code.

| # | Name | Stroke | Opacity | Overlay dot | Animation | Real-world trigger |
|---|------|--------|---------|-------------|-----------|---------------------|
| 1 | **Dim** | `var(--accent-gold)` (`#C9A84C`) | `0.35` | — | None | No uploads in flight, no recent error, no nearby peer. The resting state. |
| 2 | **Solid gold** | `var(--accent-gold)` (`#C9A84C`) | `1.00` | — | None | An upload just completed and the queue is empty — held for 1500ms, then falls back to Dim or Nearby. |
| 3 | **Pulsing gold** | `var(--accent-gold)` (`#C9A84C`) | `1.00` (animated — see below) | — | Pulse, see §3a | At least one upload is in flight (chokidar-queued on desktop, or explicit upload on web). |
| 4 | **Gold + blue dot** | `var(--accent-gold)` (`#C9A84C`) | `1.00` | See §3b — fill `var(--blue-presence)` = `#1B3A5C` | None | Supabase Realtime presence channel reports at least one peer device online for the same user. Only applies when idle. |
| 5 | **Gold + red dot** | `var(--accent-gold)` (`#C9A84C`) | `1.00` | See §3b — fill `var(--state-error)` = `#EF4444` | None | Last sync attempt failed (network loss, 4xx/5xx, R2 error). Held for 5000ms or until the icon is clicked (whichever first). |

### 3a. Pulse specification (Syncing only)

- Property animated: stroke `opacity`.
- Keyframes: `0% → 1.00`, `50% → 0.55`, `100% → 1.00`.
- Duration: `1200ms` per cycle.
- Easing: `ease-in-out`.
- Loop: infinite, until state transitions out of Syncing.
- No scale, no rotation, no translation, no color shift. Opacity only.

Rationale: pulse expresses "something is happening right now." Any motion beyond opacity violates PHILOSOPHY §3.1 (stillness over motion — motion expresses state change, never style).

### 3b. Overlay dot specification (Nearby / Error)

The dot is anchored to the right pylon top, sitting slightly outside the mark's geometry so the colored fill is never obscured by the gold path.

| Property | Value |
|---|---|
| `cx` | `21` |
| `cy` | `3` |
| `r` | `3` |
| Fill | `var(--blue-presence)` or `var(--state-error)` |
| Stroke (knockout ring) | `var(--surface-base)` — the surface color the icon sits on |
| Stroke width | `1.5` |
| Animation | None — the dot appears instantly on state entry and disappears instantly on exit |

The knockout stroke separates the dot from the gold path when they overlap; its color must match whatever surface the icon is rendered on (dark mode: `#0A0A0F`; light mode: `#FAFAFC`). Clients pass a `surface` prop to the icon component to resolve this.

### 3c. Blue-dot readability — escape hatch

Ocean blue (`#1B3A5C`) at the dot scale specified in §3b (r=3 inside a 24×24 viewBox) may read as muted against dark surfaces, particularly on the dark-mode base (`#0A0A0F`) where the contrast ratio is low. The spec ships with ocean because PHILOSOPHY §4 restricts the palette, and introducing a brighter blue would widen the hue set of the product.

**Permitted amendment:** if readability testing during the web implementation surgery (or any later client surgery) confirms the ocean dot fails to read at realistic viewing distances, the spec permits **one** documented introduction of a brighter blue variant, scoped strictly to the Nearby overlay dot. The brighter variant:

- Must keep the semantic name `--blue-presence` in the token system — only the resolved hex changes.
- Must be used only for this dot. It is not a general-purpose blue and does not replace ocean (`#1B3A5C`) anywhere else. Ocean remains the interactive-state color per PHILOSOPHY §4.
- Requires a written justification recorded in this section of this file: the test conditions, the failing contrast ratio, the chosen replacement hex, and the date of amendment. Silent amendment in a client implementation — without updating this file — is forbidden.

Until such an amendment is recorded here, ocean (`#1B3A5C`) is authoritative.

---

## 4. State transition rules

**Priority order (highest wins):** Error > Syncing > Solid-gold (timed latch) > Nearby > Dim.

Solid-gold is a timed latch, not a priority class — it holds for exactly 1500ms after a successful sync and cannot be interrupted except by Error or Syncing.

### 4a. Individual transitions

| From | To | Trigger | Minimum hold |
|------|----|---------|--------------|
| Dim | Syncing | Upload queued (client-initiated or watcher-detected) | — |
| Syncing | Solid gold | Upload completes AND queue is empty | Syncing must have been visible ≥300ms |
| Solid gold | Dim | 1500ms elapsed since entering Solid gold, no nearby peer | 1500ms latch is mandatory |
| Solid gold | Nearby | 1500ms elapsed, presence channel reports a peer | 1500ms latch is mandatory |
| Solid gold | Syncing | New upload queued before the 1500ms latch expires | — |
| Dim | Nearby | Presence channel `peer_online` event, stable for ≥2000ms | — |
| Nearby | Dim | Presence channel `peer_offline` for all peers, stable for ≥2000ms | — |
| Any | Error | Upload failure (network loss, 4xx/5xx, R2 error) OR unretryable sync error | — |
| Error | Dim / Nearby / Syncing | 5000ms elapsed OR user clicks the icon (dismiss). Destination state is whatever the current conditions warrant. | 5000ms or click |

### 4b. Cooldown / anti-thrash rules

These exist because real signals flap (network blips, watcher echoes, presence heartbeat timing). The icon must not visually flicker in response to noise.

1. **Syncing minimum hold: 300ms.** Once Syncing is entered, it cannot transition out for 300ms — even if the upload completes in 50ms. Prevents strobe on very fast uploads.
2. **Presence debounce: 2000ms.** Dim ↔ Nearby transitions require the presence signal (online/offline) to be stable for 2000ms before the icon changes. Single-event flaps are ignored.
3. **Error re-entry lockout: 1000ms.** After Error is dismissed or expires, the icon cannot re-enter Error within 1000ms. Prevents retry-loop strobe when the backend is down and every 500ms retry fails.
4. **Identical-signal debounce: 100ms.** Any signal that would transition to the current state is ignored if it arrives within 100ms of the last transition.
5. **Solid-gold is atomic.** The 1500ms latch cannot be shortened by any signal except a new upload (Syncing) or a failure (Error). Presence changes are queued until the latch expires.

### 4c. Presence channel dependency

Nearby state depends on the Supabase Realtime presence protocol, which lands in **Week 2 Deliverable #2**. Until that protocol ships, clients implement the Nearby state's rendering path but wire its trigger to a stub that never fires — so all five states are visually testable from day one without blocking on Deliverable #2.

This spec assumes the presence protocol will deliver events of the shape `{ peer_id, status: "online" | "offline", last_seen }` on a user-scoped channel keyed to `user.id`. The exact channel name, event names, and payload shape are finalized in Deliverable #2's spec document; when that lands, §4a's presence triggers will be updated to reference it by name.

---

## 5. Per-client rendering notes

Each client implements the mark idiomatically for its platform. What must not differ: geometry (§2), colors (§3 token names), state names, transition rules (§4). What is allowed to differ: the animation mechanism (CSS vs `Animated.Value` vs PNG-swap), the consumption layer (React component vs inline string), and the build pipeline (source SVG vs rasterized PNG).

### 5a. Web (`soundbridg-frontend/`)

- **Component:** `src/components/BridgIcon.jsx`, signature `<BridgIcon state="dim|solid|syncing|nearby|error" surface="dark|light" size={24} />`.
- **Rendering:** inline SVG, path and circles emitted from React. Stroke color via CSS variables (`var(--accent-gold)`).
- **Pulse:** CSS `@keyframes bridg-pulse` on the stroke's opacity, applied only when `state === "syncing"`. Matches §3a values exactly (1200ms, ease-in-out, infinite).
- **Overlay dot:** conditionally rendered `<circle>` with fill `var(--blue-presence)` or `var(--state-error)`; knockout stroke resolves via the `surface` prop.
- **Consumption sites (to be updated in web surgery):**
  - `src/components/Navbar.jsx:29-33` — replace inline SVG with `<BridgIcon state={syncState} surface="dark" size={16} />`.
  - `src/pages/Home.jsx:20-24` — replace inline SVG with `<BridgIcon state="solid" surface="dark" size={20} />` (hero is a marketing surface; always Solid).
  - `public/favicon.svg` + rasterized favicons — a logo lockup (brand tile + bridg mark, state=Solid) authored from the same 24×24 master geometry. The mark's `viewBox` is `0 0 24 24`, fixed — it does not change based on output size. Raster exports for favicon use ship at the standard sizes (16 px, 32 px, 192 px, 512 px), all generated from the same SVG source. **Output pixel size and source viewBox are independent properties**: a 16×16 PNG and a 512×512 PNG are both derived from the 24×24 viewBox, not from different-viewBox re-authorings.
- **State source:** for now, web has no sync signal (see ARCHITECTURE §8 — `/api/tracks/latest-timestamp` is unused). Until Deliverable #2 lands, web passes `state="dim"` as a constant. Wiring real state is a Week 3+ concern.

### 5b. Mobile (`Built-Apps/soundbridg-mobile/`)

- **Component:** `components/BridgIcon.tsx`, same signature as web.
- **Rendering:** `react-native-svg` primitives (`Svg`, `Path`, `Circle`). Already installed (`react-native-svg@15.15.3`).
- **Pulse:** `Animated.Value` driving stroke opacity via `Animated.loop(Animated.sequence([timing(0.55, 600ms, ease-in-out), timing(1.0, 600ms, ease-in-out)]))`. Total cycle 1200ms matches web.
- **Overlay dot:** conditionally rendered `<Circle>`.
- **Consumption sites:** mobile currently has `headerShown: false` in `app/(tabs)/_layout.tsx`. The icon's landing position in mobile chrome is a product decision for Week 3+ (the widget surgery) — not this spec. For now, the component ships in `components/` and is exercised only by a Storybook-style test screen.

### 5c. Desktop tray (`soundbridg-desktop/main.js`)

The Electron `Tray` on macOS requires `nativeImage` PNGs, not SVG. This path is fundamentally rasterized.

- **Asset layout:** `assets/states/<state>-template.png` and `assets/states/<state>-template@2x.png` (18×18 and 36×36) for monochrome states (Dim, Solid, Syncing). For Nearby and Error, colored composites ship as `assets/states/<state>.png` + `@2x` (non-template, since template images cannot carry color).
- **Build step:** `scripts/build-tray-icons.js` reads the master SVG and per-state overlay spec, emits all PNGs via `sharp` or `@resvg/resvg-js`. Runs in `postinstall` or explicitly before `npm run dist`. The PNGs are committed so packaged builds do not require the build tool at runtime.
- **Template-image flag:** Dim / Solid / Syncing use `trayIcon.setTemplateImage(true)` so macOS auto-tints them for dark/light menubars. Nearby / Error use `setTemplateImage(false)` because the colored dot must render as its own color.
- **Pulse on tray:** macOS template images cannot animate smoothly. Approximate the pulse by swapping between Solid and a Dim-equivalent frame every 600ms via a `setInterval` that calls `tray.setImage(...)`. The timer is started on entry to Syncing and cleared on exit. No per-pixel opacity animation — this is the single permitted platform divergence from §3a, because the underlying API does not support anything more granular.
- **Existing `TRAY_ICON_18` / `TRAY_ICON_36` base64 strings** in `main.js:149-150` are deleted during the desktop surgery; the embedded-base64 pattern is replaced by `nativeImage.createFromPath()` pointing at the generated PNGs.

### 5d. Desktop renderer (in-window HTML)

The desktop renderer (`soundbridg-desktop/renderer/index.html` + `renderer.js`) is vanilla HTML/JS under a CSP of `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.

- **Rendering:** inline SVG element in `index.html`, identical markup to the web component's output. CSP permits inline SVG (it's markup, not script).
- **Pulse:** CSS `@keyframes` in `styles.css`, matching web's values exactly. The existing `.status-dot.syncing` animation in `styles.css:240-243` is retired — state is now expressed on the bridg mark itself.
- **State wiring:** `main.js` sends the current `syncState` to the renderer via IPC (already present — `sendStateUpdate()` at `main.js:558`). The renderer toggles a class on the SVG root that switches stroke opacity and shows/hides the overlay dot.
- **Login-screen musical-note glyph** (`&#9835;` at `renderer/index.html:14`) is replaced with the inline bridg SVG during the desktop surgery.

---

## 6. PHILOSOPHY enforcement

These rules live in PHILOSOPHY.md but are restated here because client implementers look at this file when drawing pixels.

### Stillness (PHILOSOPHY §3.1)

- Solid gold must not shimmer. It is a static, full-opacity stroke.
- Dim must not fade in or out. It is a static, 35%-opacity stroke.
- Overlay dots (blue, red) must not bounce in, fade in, scale in, or pulse. They appear instantly on state entry and disappear instantly on state exit.
- The pulse animation is permitted on exactly one state (Syncing), on exactly one property (stroke opacity), with exactly the values in §3a. No other animation on the icon is permitted — now or later.
- Hover states on the icon do not scale, rotate, brighten, or animate. Hover may expose a tooltip (see PHILOSOPHY §3.3 — "Clicking the icon reveals what the state means in plain language"); the tooltip is plain typography, not a visual flourish on the mark.

### Gold is earned (PHILOSOPHY §3.4)

- The gold hex (`#C9A84C` / `var(--accent-gold)`) appears on the bridg mark, on success-confirmation copy, on "Synced ✓" / "Copied" micro-feedback, and on the first-run "Connect your studio" CTA. That is the complete list.
- Gold on the bridg mark is the identity — it is permitted to be visible even at Dim (at 35% opacity) because the gold *is* the mark. This does not contradict §3.4: the gold here carries identity, not decoration.
- Do not introduce gold anywhere else in the UI when wiring this component. Button borders, hover states, link underlines, focus rings — none of these become gold because the bridg icon uses gold.

### No skeuomorphism

- No drop shadows on the mark. (The current `soundbridg-frontend/src/components/Navbar.jsx:27` shadow `0 4px 14px rgba(201,168,76,0.15)` is on the brand-tile lockup, not the mark itself — it stays if the lockup stays, but must not be added to the bare icon.)
- No bevels, no inner glow, no simulated metal / glass / paper textures.
- No gradient strokes implying light direction. The stroke is a single solid color.
- The brand-tile gradient (Navbar, Home hero) is a marketing treatment, not part of the mark. The state-machine icon is always rendered bare.

---

## 7. Revision rules

Changes to this spec are governed the same way ARCHITECTURE.md and CONSTRAINTS.md are: deliberately, in sequence, and documented.

1. **Update this document first.** Do not implement a bridg-icon change in any client before the spec reflects the intended end state. If the spec and a client disagree, the spec is right and the client is broken.
2. **Schedule a per-client surgery for each affected client.** A geometry change needs three surgeries (web, mobile, desktop). A state-machine tweak may need one or two. Each surgery has its own session, its own verification, and its own commit, per PHILOSOPHY §6.1 ("one surgery per session").
3. **Staged rollout preserved.** Web ships first. Mobile OTA lags web by at least one release. Desktop DMG lags mobile by at least one release. A simultaneous cross-client icon change requires a documented rollback plan before merge.
4. **If the change breaks a cross-client assumption, add a note to CONSTRAINTS.md §11.** Example: renaming a state, removing a state, altering a transition-trigger semantic (e.g., changing what "nearby" depends on) — these affect client code that has already shipped to users.
5. **Color-token changes are scoped to Deliverable #4.** When the dark/light token system lands, the semantic names in this document (`--gold`, `--blue-presence`, `--red-error`, `--surface-base`) stay the same — only their resolution changes. No client code should need to change for a palette adjustment.
6. **Never introduce a sixth state.** The five-state rule is load-bearing on PHILOSOPHY §3.3. A sixth state is a philosophy change, not a spec change; it requires reopening PHILOSOPHY.md first.

---

*End of bridg-icon spec. The next surgeries in Week 2 are: Deliverable #2 (presence protocol), Deliverable #3 (typography lock), Deliverable #4 (design tokens), and per-client implementations of this spec.*
