# Sturoids

A local-first student hub for Android: tasks, Deep Work, a planner, notes, a journal, a calculator, Desmos, a lecture-video vault and AI links, on one dark neumorphic material. React Native 0.79 (new architecture), Expo SDK 53, expo-router, zustand, Reanimated.

## Build

Double-click **`build-apk.bat`** (about 10 to 20 minutes). It installs over the old app, and saved data migrates on first launch.

Version 1.4 adds native modules (device unlock, secure storage, screen capture protection, keep awake, brightness, navigation bar, image cache, and the installed-apps list now answers off the JS thread). The first build after updating has to be a full native build.

## Checks

```
npx tsc --noEmit
npm run lint:type
node scripts/build-signature.js --check
```

`lint:type` fails on `fontWeight`, fractional or sub-11 font sizes, and any size set without a font family.

## How it fits together

**Navigation.** The bar always has five places: Today, three slots and More. Settings chooses the tool in each slot. A tool in a slot opens as a tab and keeps the bar; every other tool opens full screen from More, with a back button. `openTool()` in `src/toolNav.ts` goes to wherever a tool lives right now, so links from Today, the planner and quick access never open a second copy. Each tool screen takes `mode: 'tab' | 'stack'`.

**Data.** One persisted zustand store (`src/store.ts`, version 5). A load that fails or answers late is never silent: the saved data is copied aside before anything can overwrite it, and Settings, under Data, can share or restore that copy. Journal text lives in files with a small index in the store, because Android cannot read a single storage row over about 2 MB. Backups carry everything, journal text included.

**Journal.** Opens on the right page: before the cutoff hour (11:00 by default) the page is about yesterday. Saves run through one queue, so leaving, switching days or deleting never races a save. The archive searches titles, text and tags, filters by month, mood, tags and pins, and shows streaks and On this day.

**Locks.** The journal and single notes can sit behind the phone's fingerprint, face or screen lock, or an app PIN (a salted SHA-256 in the keystore; five tries, then a cooldown that survives restarts). Locks hide content; they do not encrypt it. While locked content is open, Android keeps it out of screenshots and the recent apps preview, and making a backup that carries locked pages asks for the owner first.

**Deep Work.** A running session survives the app being closed. Ambient mode is a dimmed, always-on clock that drifts a few points each minute; hold anywhere to leave it.

**Intro.** The start screen writes the signature from a real pen recording, then settles it under the wordmark.

## Design system

Everything visual comes from `src/theme.ts`.

- **One light.** `NEU_ANGLE` 60 and `NEU_DIST` 6 drive every raised and carved surface. Surfaces use `NEU`, `neuRaised()` and `neuInset()` only, never literal shadows; tracks under 20 points use the hairline carve.
- **One accent.** Chosen in Settings from six swatches, Iris by default. No glows.
- **Type.** Rubik through the `F` faces and the closed `T` scale (display 30, h1 22, title 17, body 15, label 13, caption 12, kicker 11), IBM Plex Mono for timers. Never `fontWeight`.
- **Copy.** Sentence case, no emoji, no em dashes.
- **Palette.** Three warm materials (Bark, Clay, Umber) are proposed in the Palette Lab; the app keeps its grey until one is picked.

## Re-recording the signature

Record a new signature in the Intro Lab, press **Copy my data**, and paste the copied text into `scripts/signature.raw.json` (a bare `{"strokes":[...]}` recording works too; a lab copy also carries its size and speed picks). Then run:

```
node scripts/build-signature.js
```

It regenerates `src/signature.ts` (commit it) and prints a summary of the model.

## Layout

```
app/                  routes: (tabs) with slot1..3 stacks, full-screen tool pages, settings
src/screens/          one body per tool, shared by its tab and full-screen routes
src/tools.ts          the tool registry
src/toolNav.ts        openTool, tab fling, slot context
src/store.ts          persisted state, migrations, backups, load safety
src/journal.ts        journal files, days, prompts, search, stats
src/lock.ts           lock session, device unlock, app PIN
src/deepWork.ts       session timing shared by Focus and ambient
src/theme.ts          palette, NEU shadows, type scale
src/components/       UI kit, tab bar, sheets, toasts, lock gate, ambient view, intro
scripts/              signature builder, type lint
modules/app-list/     native installed-apps module
```
