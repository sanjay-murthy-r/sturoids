# Sturoids v1.3 — dark soft-UI (dual-shadow neumorphism)

Local-first student hub. React Native + Expo SDK 53 · expo-router · zustand · reanimated.

## Build the APK

Double-click **`build-apk.bat`** (~10–20 min, installs over the old app, data migrates automatically).

## v1.3 — exact Figma-kit implementation

**Extracted, not guessed.** Palette from the kit's grey colour strip: `#F4F5F7 · #DDE3ED · #808B9F · #5B6577 · #39404E · #2C2D30`. Shadow system from the Neumorphism UI Kit (Community) board: dual drop-shadows per surface (dark side `rgb(174,174,192)` @ 0.2/0.4/0.6 tiers, light side white @ 0.7/1.0, blur ≈ 1.4 × offset) — recreated for the dark theme with the strip's own greys. The source SVGs were never checked in — `src/theme.ts` is the surviving record of both.

**Overrides as requested:**
- Shadow distance = **6px** on both sides.
- Light angle = **60°** — one constant; highlight offset = (6·cos60°, −6·sin60°) = (3, −5.2), dark side derived automatically as the exact opposite (240°). Change `NEU_ANGLE` in `src/theme.ts` and everything follows.
- Implemented with true dual `boxShadow`s (new-architecture RN — real light+dark shadows on Android, including `inset` for carved-in wells).

**Toggle boundary rule.** The track has `overflow: hidden`; the knob's highlight/shadow rims exist only within the track's rounded bounds. When the knob sits at the "on" edge, the rim on that side simply runs out of room and vanishes — geometry, not a special-cased style.

**Status bar, properly.** The old opaque strip painted over real content on screens that already have a native header (the visible bug). Now: headered screens rely on their header; only the five tab screens carry the guard zone, matched to the background.

**Accent colour themes.** Settings → Accent colour: 6 swatches (Iris `#8B7CF8`, Aqua `#4FC4B8`, Sky `#5CA8F5`, Rose `#F07E98`, Amber `#EDAE49`, Mint `#66D28F`). Recolours highlights, links, FABs, controls app-wide instantly; background stays the grey material.

**Launcher fix.** The installed-apps picker now returns the *complete* launcher set (`MATCH_ALL` + no display cap) — previously it listed only the first 50.

## Build note

`npx tsc --noEmit` is clean. If `eas build` reports any error, paste the log — one-pass fix.

## Layout

```
src/theme.ts        strip palette · NEU_ANGLE/NEU_DIST · neuRaised()/neuInset() · ACCENT_CHOICES
src/components/UI   soft-UI kit (Card, Inset, Toggle, Field, …)
src/components/Motion  sink-press + soft-rise
src/components/StartScreen  seam-light intro
modules/app-list    native installed-apps module
```
