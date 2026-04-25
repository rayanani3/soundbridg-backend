# SoundBridg — Design Tokens

The canonical design-token surface for SoundBridg 2.0. Where `PHILOSOPHY.md` describes *why* the product looks the way it does, this document names the exact values every client must use.

Scope today: **typography** (Week 2 Deliverable #3). A second pass will land **color tokens** here (Week 2 Deliverable #4). Motion, spacing, and radius tokens are deliberately out of scope — those are defined per-surface until a proven need for unification emerges.

Read before any design-language surgery. If a client renders a pixel value not listed here, either the client is drifting or this document is drifting — resolve the conflict before shipping.

---

## 1. Font family

**Product UI (all clients):** Inter, self-hosted. No Google Fonts runtime fetch. No fallbacks that change the shape of glyphs.

```
font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

The system-font fallback exists only for the pre-load frame. Once Inter loads, every glyph in every client is Inter.

**Monospace (timecode, file paths, hashes):** JetBrains Mono, one weight (400), self-hosted.

```
font-family: 'JetBrains Mono', 'SF Mono', 'Menlo', monospace;
```

Monospace exists for three purposes only: timecodes (`m:ss`), file paths, and debug identifiers. It is never used for body text, labels, or headings.

**Forbidden families:** DM Sans (current frontend), Outfit (dead Tailwind reference), Segoe UI Display, system stack as primary (current desktop). The audit found all three — all three are drift.

### Self-hosting rule

Inter and JetBrains Mono ship as static assets inside each client repo. Never `@import url('https://fonts.googleapis.com/...')` at runtime. Rationale:

- Offline-first: desktop watcher and mobile app must render correctly with no network.
- Load determinism: Google Fonts is a third-party dependency that silently fails or slows.
- Privacy: no third-party font request leaks the user's IP on every session.

Each client is responsible for its own font-loading implementation (web: `@font-face` + `font-display: swap`; Electron: bundled WOFF2 in `renderer/`; RN: `expo-font.useFonts`).

---

## 2. Typography scale

Seven product steps. One base. No display outlier.

| Token              | Value  | rem      | Typical usage                                    |
| ------------------ | ------ | -------- | ------------------------------------------------ |
| `--text-xs`        | 11px   | 0.688rem | Metadata, captions, secondary timestamps         |
| `--text-sm`        | 13px   | 0.813rem | Secondary labels, dense list rows, helper text   |
| `--text-md`        | 15px   | 0.938rem | **Body. Default paragraph. Most UI labels.**     |
| `--text-lg`        | 17px   | 1.063rem | Emphasized body, primary list rows, card titles  |
| `--text-xl`        | 20px   | 1.250rem | Section headings                                 |
| `--text-2xl`       | 24px   | 1.500rem | Page headings                                    |
| `--text-3xl`       | 32px   | 2.000rem | Hero on product surfaces (dashboard, empty state)|

Ratios between adjacent steps: ~1.18 at the bottom, widening to ~1.33 at the top. Tight at small sizes to preserve UI density; wider at heading sizes to establish hierarchy. This mirrors the scale SF Pro uses in Apple's own productivity surfaces.

### Why 15px is the base (not 16px)

Most design systems anchor at 16px because most of the web is content — marketing pages, blog posts, documentation. SoundBridg is not content. It is a **dense productivity tool**: a file tray, a waveform list, a sync status. Our nearest visual peers are Linear (14px base), Figma (13px base), and Notion (14–16px variable). We chose 15px as the middle: dense enough that a track list fits the waveforms and metadata comfortably, legible enough that the body copy doesn't feel like fine print.

The rem unit system is non-negotiable specifically because of this choice. When a user raises their OS or browser text size for accessibility, `<html>` scales and every token scales with it — the 15px base becomes 16.5px or 18px in proportion. Anchoring every value in `rem` preserves that contract. Never hard-code px values into the tokens; convert at the usage site only where px is unavoidable (border widths, icon viewBoxes, 1-pixel hairlines).

### Marketing hero sizes — no token

Landing-page and marketing hero sizes (typically 48–80px, often fluid with viewport) are **not tokenized**. Use inline `clamp()` expressions at the usage site, with a local comment explaining the one-off:

```css
/* Marketing hero — intentional one-off; not in the token scale. */
font-size: clamp(2.4rem, 5.5vw, 4.2rem);
```

Rationale: any token named `--text-display` (or similar) will eventually be reached for by product surfaces that want to feel "big." The name itself isn't enforceable — a token exists as a reusable primitive, and reuse is exactly what we want to prevent here. Marketing oversize is an exception; exceptions stay at their call sites where a reviewer can see them.

### Forbidden half-pixels

The frontend currently uses `11.5px`, `12.5px`, and `13.5px` at various call sites. These do not exist in the scale. If a layout needs a size between `--text-sm` (13px) and `--text-md` (15px), the layout is wrong — choose one, not a split.

---

## 3. Weight tokens

Four weights. Nothing else exists in the product.

| Token                 | Value | Usage                                                   |
| --------------------- | ----- | ------------------------------------------------------- |
| `--weight-regular`    | 400   | Body text. Every paragraph, every row, every label.     |
| `--weight-medium`     | 500   | Emphasis inside body. Selected states. Active tabs.     |
| `--weight-semibold`   | 600   | Headings. Section titles. Card titles.                  |
| `--weight-bold`       | 700   | **One per screen.** The single most important label.    |

`--weight-bold` is the enforcement mechanism for PHILOSOPHY §3.5's "700 reserved for the single most important label on a screen." If two elements on a screen are 700, one of them is wrong.

**Forbidden weights:** 100, 200, 300, 800, 900. These do not exist in the product. The frontend currently has four `font-extrabold` (800) call sites — all four are drift and will be killed in the frontend surgery.

---

## 4. Line-height tokens

| Token               | Value | Usage                                                   |
| ------------------- | ----- | ------------------------------------------------------- |
| `--leading-body`    | 1.5   | Default for anything at `--text-xs` through `--text-lg`.|
| `--leading-heading` | 1.2   | Default for `--text-xl` and up.                         |
| `--leading-tight`   | 1.1   | Hero marketing only. Not used on product surfaces.      |
| `--leading-numeric` | 1.0   | Usage-site override for clocks, counters, timecodes.    |

`--leading-numeric` is an override, not a default. It exists because a timecode like `2:43` looks wrong at 1.5 line-height when stacked in a column — it wants to sit tight. Apply at the specific element, never as a screen-level default.

### Documented local exception

The desktop log view uses `line-height: 1.6` for readability across multi-line log entries. This is a single documented exception — it lives in `soundbridg-desktop/renderer/styles.css` on the log container only, with a comment pointing back to this section. If another surface needs 1.6, it justifies itself here or it doesn't exist.

---

## 5. Per-client migration notes

These notes are the delta from current state to this spec. Each client surgery will reference this list and verify end-to-end.

### 5.1 Web (`soundbridg-frontend/`)

- Replace `tailwind.config.js` `fontFamily.sans` from `['DM Sans', ...]` to `['Inter', ...]`.
- Remove `fontFamily.display` from any Tailwind reference. `font-display` is used at 6 sites today but not declared — silent fall-through. Kill the class.
- Remove the `@import url('https://fonts.googleapis.com/css2?family=DM+Sans:...')` line from `src/index.css`. Replace with local `@font-face` declarations pointing at self-hosted Inter WOFF2 files in `public/fonts/`.
- Remove all four `font-extrabold` call sites (Home.jsx:32, Dashboard.jsx inline 38, Dashboard.jsx:1226 inline, SharedTrack.jsx inline 44). Replace with `font-semibold` (600) or `font-bold` (700) per §3.
- Introduce the token scale as Tailwind extend values:
  ```js
  fontSize: {
    xs: ['0.688rem', { lineHeight: '1.5' }],
    sm: ['0.813rem', { lineHeight: '1.5' }],
    md: ['0.938rem', { lineHeight: '1.5' }],
    lg: ['1.063rem', { lineHeight: '1.5' }],
    xl: ['1.250rem', { lineHeight: '1.2' }],
    '2xl': ['1.500rem', { lineHeight: '1.2' }],
    '3xl': ['2.000rem', { lineHeight: '1.2' }],
  }
  ```
- Sweep all 19 distinct px font-size values found in the audit; each must collapse to one of the seven tokens. Half-pixel values (`11.5`, `12.5`, `13.5`) are forbidden.
- Marketing hero `clamp()` at Home.jsx:33 stays as an inline one-off; add the local `/* Marketing hero — not tokenized */` comment.

### 5.2 Desktop (`soundbridg-desktop/`)

- Replace `renderer/styles.css` font stack from system (`-apple-system, BlinkMacSystemFont, 'SF Pro Text', ...`) to `'Inter', -apple-system, ...`. Bundle Inter WOFF2 in `renderer/fonts/` and declare with `@font-face`.
- Sweep the nine distinct px sizes (11, 12, 13, 14, 15, 18, 28, 32, 48) and collapse to tokens: `12`→`--text-xs` adjustment, `14`→`--text-sm`, `18`→`--text-lg`, `28`→`--text-2xl`, `48`→marketing one-off if on the about/welcome splash. Every surviving value must match a token.
- Introduce `--weight-medium` (500) usage. Desktop currently uses only 600 and 700 — this misses the emphasis-inside-body expression and produces a heavier visual than intended.
- The log container keeps `line-height: 1.6` as the documented exception (§4).

### 5.3 Mobile (`Built-Apps/soundbridg-mobile/`)

- Fix the lie in `lib/theme.ts`: the docstring claims "shared with web + desktop" but the file is imported nowhere outside mobile. Either delete the claim or actually share it via a published package (out of scope for this deliverable).
- Update `font.size` to the token scale:
  ```ts
  size: { xs: 11, sm: 13, md: 15, lg: 17, xl: 20, '2xl': 24, '3xl': 32 }
  ```
  Note: RN uses unitless numbers (logical pixels, scaled by `PixelRatio`), not `rem`. The accessibility story here is covered by RN's `allowFontScaling` (default true) + `Dynamic Type` on iOS.
- Add `expo-font.useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold })` at the app root. `expo-font` is already a dep (`~55.0.6`) but never called — the app is currently shipping system font.
- Add `fontFamily: 'Inter_400Regular'` (etc.) to the theme and apply at every `<Text>` usage site. RN does not inherit `fontFamily` from parent — this is tedious but required.
- Weight token values in RN are strings (`'400'`, `'500'`, `'600'`, `'700'`), matching what `theme.ts` already has.

---

## 6. Enforcement

These tokens are normative for SoundBridg 2.0. A PR that introduces a font-size, weight, or line-height value not in this document is drift and must be rejected in review.

Per-client enforcement tooling (lint rule, Tailwind preset, RN theme guard) is a future task, not part of this deliverable. Until tooling lands, enforcement is the reviewer's job.

PHILOSOPHY.md §3.5 is the normative rule; this document is the canonical value table it points at. If the two disagree, PHILOSOPHY wins and this document is updated to match.

---

## 7. Revision rules

This document is a **living spec, not a changelog**. When values change:

- Update the token table in-place. Do not add "deprecated" rows or strikethroughs.
- The git history is the changelog. Commit messages explain *why* a value changed.
- Changes to the scale, weight vocabulary, or line-height rules require a PHILOSOPHY.md §3.5 edit in the same commit. The two files never drift.
- Changes to the font family itself require a philosophy-level discussion, not a token edit. Adding a typeface is a brand decision.

When color tokens land (Week 2 Deliverable #4), they append as §8+ in this file. Do not split into a separate `COLORS.md` — one token surface, one file.

---

## 8. Color system

Twelve semantic tokens. Two-tier naming. Dark is the default; light is fully specified.

Where PHILOSOPHY §4 states the rules ("Neutrals carry the 95%. Blue carries interaction. Gold carries success. Red carries error. Nothing else carries anything."), this section states the exact values and names every client must use.

### 8.1 Naming scheme

Semantic, two-tier, kebab-case on web and desktop, camelCase equivalents on React Native.

**Tier 1 — reach-for names, used on nearly every screen:** `--bg-base`, `--bg-card`, `--bg-elevated`, `--fg-default`, `--fg-muted`, `--accent-gold`, `--accent-ocean`, `--state-error`.

**Tier 2 — resolved once, used rarely:** `--border-default`, `--fg-on-accent`, `--blue-presence`, `--surface-overlay`.

Principle: every name states a **purpose**, not a value. No `--gold-500`, no `--slate-900`. Value-based names invite variants; semantic names force the author to justify a new purpose. A reviewer should know every Tier-1 name by heart.

### 8.2 Token table

| # | Token | Purpose | Dark | Light |
| --- | --- | --- | --- | --- |
| 1 | `--bg-base` | App background, deepest layer | `#0A0A0F` | `#FAFAFC` |
| 2 | `--bg-card` | Cards, sidebar, panels | `#111118` | `#FFFFFF` |
| 3 | `--bg-elevated` | Modals, popovers, hover fills, input chrome | `#1A1A22` | `#F0F0F4` |
| 4 | `--border-default` | Dividers, card outlines, input borders | `#2A2A33` | `#D8D8DE` |
| 5 | `--fg-default` | Primary text, headings | `#E8E8EE` | `#18181C` |
| 6 | `--fg-muted` | Secondary text, metadata, labels, placeholders | `#8A8A95` | `#666670` |
| 7 | `--fg-on-accent` | Text rendered on gold surfaces (CTAs, "Synced ✓") | `#0A0A0F` | `#0A0A0F` |
| 8 | `--accent-gold` | Bridg identity + success moments only (PHILOSOPHY §3.4) | `#C9A84C` | `#C9A84C` |
| 9 | `--accent-ocean` | Interactive state: selected, focused, active, progress fills, pressed | `#1B3A5C` | `#1B3A5C` |
| 10 | `--blue-presence` | Bridg icon Nearby dot only (BRIDG_ICON §3b + §3c escape hatch) | `#1B3A5C` | `#1B3A5C` |
| 11 | `--state-error` | Bridg icon Error dot + destructive confirmation dialogs only | `#EF4444` | `#EF4444` |
| 12 | `--surface-overlay` | Modal scrim behind popovers | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.55)` |

That is the complete list.

### 8.3 Gold contrast on light surfaces — escape hatch

`--accent-gold` resolves to `#C9A84C` in both themes. On `--bg-base` light (`#FAFAFC`), the contrast ratio is **~2.6:1** — below WCAG AA for normal text. This is a known and deliberate constraint, accepted for two reasons:

1. Gold is a brand color. Apple gold, Notion black, Linear purple: all hold their brand hex across themes. Theming gold weakens identity.
2. `--fg-on-accent` (`#0A0A0F` in both themes) handles the inverse case — text rendered *on* a gold surface (the first-run "Connect your studio" CTA, the "Copy" confirmation chip) — where contrast is ~15.9:1. That direction is covered in both themes.

The uncovered case is **gold itself rendered on a light base**: thin-stroke icons, small gold text. The most visible instance is the **bridg icon's Solid-Gold state at 2px stroke width on a light-mode base or card surface**. In bright ambient light, the mark may read under-contrast.

**Permitted amendment:** if readability testing during the web implementation surgery (or any later client surgery) confirms this fails, the spec permits **one** documented introduction of a darker gold variant — `--accent-gold-on-light` — scoped strictly to thin-stroke icons and small gold text on light surfaces. The amendment:

- Must keep `--accent-gold` authoritative at `#C9A84C` in both themes. The new variant is additive, not replacing.
- Must be used only for thin-stroke icons and small gold text on light-mode `--bg-base` / `--bg-card` / `--bg-elevated`. Gold-surface CTAs continue using `--accent-gold` unchanged; `--fg-on-accent` already covers that case.
- Requires written justification recorded in this section of this file: test conditions, failing contrast ratio, chosen replacement hex, and date of amendment. No silent client-side shifts.
- Must not introduce a second gold to the product's visual vocabulary. The amendment is a contrast concession, not a brand extension.

Until such an amendment is recorded here, `--accent-gold` at `#C9A84C` is authoritative in both themes.

### 8.4 Why these tokens and nothing else

Deliberately absent from this table:

- **`--text-tertiary`** (disabled/placeholder) — folded into `--fg-muted`. Dimmer text is expressed at the call site via opacity, not a third tier.
- **`--bg-hover`, `--bg-input`** — collapsed to `--bg-elevated`. Separate tokens invited close-but-different hex values in earlier systems (`#1A1A26` vs `#16161F` in the frontend today).
- **`--primary-mid`** — deleted. Ocean has one value.
- **`--accent-gold` variants** (`-dim`, `-glow`, `-line`, `-hover`) — deleted. Transparent-on-gold overlays are generated at the call site via `color-mix()` (web) or opacity (RN/Electron). Pre-baked alpha tokens do not survive theme inversion cleanly.
- **`--green`, `--orange`** — deleted. Success is gold (§3.4). "Live" status is the bridg icon state or the word "LIVE" in copy, never a second hue.
- **`#fde047` lemon-yellow accent-glow** — deleted from the product. The visual punch it carried returns via motion or layout in a later surgery, not a second yellow.
- **Track-thumbnail gradient palettes** (`Dashboard.jsx` `bgs[]`, `gradientFor()`, legacy `DESIGN.md` art-gradients — 18+ hex values between them) — frozen. PHILOSOPHY §4 forbids category-coded track types. Removal is a product-shape surgery post-Deliverable #4; the gradient palette is not migrated to tokens because it is going away.

### 8.5 Theme resolution

CSS custom properties under `[data-theme]` selectors, seeded by `@media (prefers-color-scheme)`, with user override in `localStorage`.

```css
:root,
[data-theme="dark"] {
  --bg-base: #0A0A0F;
  --bg-card: #111118;
  --bg-elevated: #1A1A22;
  --border-default: #2A2A33;
  --fg-default: #E8E8EE;
  --fg-muted: #8A8A95;
  --fg-on-accent: #0A0A0F;
  --accent-gold: #C9A84C;
  --accent-ocean: #1B3A5C;
  --blue-presence: #1B3A5C;
  --state-error: #EF4444;
  --surface-overlay: rgba(0, 0, 0, 0.6);
}

[data-theme="light"] {
  --bg-base: #FAFAFC;
  --bg-card: #FFFFFF;
  --bg-elevated: #F0F0F4;
  --border-default: #D8D8DE;
  --fg-default: #18181C;
  --fg-muted: #666670;
  --fg-on-accent: #0A0A0F;
  --accent-gold: #C9A84C;
  --accent-ocean: #1B3A5C;
  --blue-presence: #1B3A5C;
  --state-error: #EF4444;
  --surface-overlay: rgba(0, 0, 0, 0.55);
}

@media (prefers-color-scheme: light) {
  :root:not([data-theme]) {
    /* Inherit light values when the user has not set an explicit override. */
    --bg-base: #FAFAFC;
    --bg-card: #FFFFFF;
    --bg-elevated: #F0F0F4;
    --border-default: #D8D8DE;
    --fg-default: #18181C;
    --fg-muted: #666670;
    --surface-overlay: rgba(0, 0, 0, 0.55);
  }
}
```

**Light-mode overlay rationale.** `--surface-overlay` at `rgba(0,0,0,0.55)` in light mode follows the Notion / Linear / Radix convention (roughly 50–60% black scrim on light surfaces). 40% black over white reads as "dirty" rather than "dimmed" — the eye interprets the half-transparent black as grey dirt, not an intentional overlay. 55% gives clean modal focus without clipping into the "this screen is disabled" pitch-black range. Dark mode stays at 60% because it has to darken a surface already near-black; any less and the scrim is invisible.

**Per-client toggle wiring** — each client implements its own theme switcher, not part of this deliverable:

- **Web:** above CSS pattern. Toggle is a settings-screen control that writes `localStorage.theme` and sets `document.documentElement.dataset.theme`.
- **Electron renderer:** same CSS pattern. `main.js` sends macOS `nativeTheme.shouldUseDarkColors` via IPC on startup and on `nativeTheme.on('updated')`; the renderer sets `[data-theme]` accordingly.
- **Mobile (RN):** no CSS. `Appearance.getColorScheme()` + `useColorScheme()` hook drives a theme object that switches between `darkTokens` and `lightTokens` exported from `lib/theme.ts`. Values applied per `StyleSheet`.

Until each client ships its toggle, all three force `[data-theme="dark"]`. Light mode is fully specified in this document but not yet user-visible.

### 8.6 Bridg icon token resolution

Under these token names, the mark (BRIDG_ICON.md §2/§3/§3b) resolves:

| BRIDG_ICON reference | Token used | Resolves to |
| --- | --- | --- |
| Stroke, all five states | `--accent-gold` | `#C9A84C` (both themes) |
| Nearby dot fill | `--blue-presence` | `#1B3A5C` (both themes) — with BRIDG_ICON §3c readability escape hatch |
| Error dot fill | `--state-error` | `#EF4444` (both themes) |
| Dot knockout ring | `--bg-base`, `--bg-card`, or `--bg-elevated` | resolved by the `surface="base"\|"card"\|"elevated"` prop |

The `surface` prop enumeration replaces the prior `surface="dark"\|"light"` semantics: theme inversion is handled automatically by `[data-theme]` CSS custom-property lookup, so the prop only needs to say which surface-level the icon sits on. Free-form hex pass-through is not supported.

### 8.7 Per-client color migration notes

These are the deltas from current state to the token surface above. Each is a future surgery, not part of this deliverable.

#### 8.7.1 Web (`soundbridg-frontend/`)

- Replace every `:root` custom property in `src/index.css` lines 7–35 with the twelve tokens above under `[data-theme="dark"]` + `[data-theme="light"]` selectors.
- Delete `--primary-mid`, `--text-tertiary`, `--bg-hover`, `--bg-input`, `--accent-dim`, `--accent-glow`, `--accent-line`, `--green`, `--green-dim`, `--red-dim`, `--primary-glow`, `--border-mid`, `--border-accent` — thirteen dead tokens.
- Kill the five `#fde047` call sites (Home.jsx:36, Dashboard.jsx:1158, Dashboard.jsx:1615, Player.jsx:255, Waveform.jsx:30). Waveform accent-glow becomes `--accent-gold` at full opacity or is removed.
- Kill the `#d4b560` hover-gold at Dashboard.jsx:703. Hover state becomes `--accent-ocean` (PHILOSOPHY §3.4 forbids gold for hover).
- Kill the `Dashboard.jsx:470-479` 16-color gradient palette. Track thumbnails become `--bg-elevated` tiles with initial + waveform overlay, pending the product-shape surgery.
- Rewrite `src/components/Waveform.jsx` `accent` / `accentGlow` props to resolve from tokens, not hard-coded hex defaults.
- Replace `public/favicon.svg` non-palette navy `#0a0e27` with ocean `#1B3A5C` + gold mark (BRIDG_ICON §5a).
- Retire `DESIGN.md` as a redirect stub pointing at `DESIGN_TOKENS.md` + `PHILOSOPHY.md`.
- Tailwind `colors` extend replaces category-named entries (`bg.card`, `brand.ocean`, `brand.gold`) with semantic-token references (`bg.base`, `fg.default`, `accent.gold`, `accent.ocean`, `state.error`).
- Add `[data-theme]` toggle wiring in a follow-up surgery (not this one).

#### 8.7.2 Desktop (`soundbridg-desktop/renderer/`)

- Replace every `:root` custom property in `renderer/styles.css` lines 7–20 with the twelve tokens above.
- Delete `--gold-dim`, `--green`, `--orange`, `--blue-light`. Rename `--text` → `--fg-default`, `--text-dim` → `--fg-muted`, `--border` → `--border-default`, `--red` → `--state-error`, `--gold` → `--accent-gold`, `--blue` → `--accent-ocean`.
- Kill inline `renderer.js:213` (`#4CAF50`) and `:216` (`#9ca3af`) — FL status dot no longer uses green; status color comes from the bridg icon state-machine.
- The sync-badge CSS (`styles.css:277-283`) referencing orange / green / red badge hues is retired along with those colors; sync state is expressed by the bridg icon (BRIDG_ICON.md), not a separate badge.
- Desktop-renderer theme follows `nativeTheme.shouldUseDarkColors` via IPC from `main.js`; toggle wiring is a follow-up surgery.

#### 8.7.3 Mobile (`Built-Apps/soundbridg-mobile/`)

- Rewrite `lib/theme.ts` `colors` export as two objects — `darkTokens` and `lightTokens` — each carrying the twelve tokens. Remove GitHub-dark values (`#0D1117`, `#161B22`, `#1C232E`, `#22272E`, `#F0F6FC`, `#8B949E`, `#6E7681`, `#F85149`, `#3FB950`) and ad-hoc brand variants (`#2A5580`, `#E0C26B`).
- Retire `gradientFor()` — the 8-pair thumbnail gradient palette goes away with the product-shape surgery. Until then, leave it in place but do not migrate its hex values to tokens.
- Fix the docstring lie ("shared with web + desktop apps"): the file is not shared. Either delete the claim or publish it as a package in a future session.
- Fix `scripts/make-icons.py` gold from `#C8A555` back to `#C9A84C`. Regenerate the icon rasters.
- Fix `app.json` `backgroundColor` from `#0D1117` to `#0A0A0F` (both entries, lines 14 and 37).
- Add `useColorScheme()` + theme-switching scaffolding, but ship with dark forced on until the toggle UI lands.
- Every `<Text>` usage site continues applying `fontFamily` + color explicitly (RN does not inherit); color now comes from the active theme's `fg.default` / `fg.muted`.
