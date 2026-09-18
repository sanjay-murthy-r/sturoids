# Sturoids

A local-first student hub for Android: tasks, Deep Work, a planner, notes, a journal, a calculator, Desmos, a lecture-video vault and AI links, on one dark neumorphic material. React Native 0.79 (new architecture), Expo SDK 53, expo-router, zustand, Reanimated.

## Build

Double-click **`build-apk.bat`** (about 10 to 20 minutes). It installs over the old app, and saved data migrates on first launch.

Version 1.4 adds native modules (device unlock, secure storage, screen capture protection, keep awake, brightness, navigation bar, image cache, and the installed-apps list now answers off the JS thread). The first build after updating has to be a full native build.

## Checks

```
npx tsc --noEmit
npm run lint:type
npm run test:store
node scripts/build-signature.js --check
node scripts/build-handwriting.js --check
```

`lint:type` fails on `fontWeight`, fractional or sub-11 font sizes, and any size set without a font family.

`test:store` boots the real store in Node over an in-memory storage and checks a fresh install, the upgrade from a v4 blob, malformed data, backup round trips, and every load-failure path (an unreadable blob, an older copy already kept, storage that answers late).

## How it fits together

**Navigation.** The bar always has five places: Today, three slots and More. Settings chooses the tool in each slot. A tool in a slot opens as a tab and keeps the bar; every other tool opens full screen from More, with a back button. `openTool()` in `src/toolNav.ts` goes to wherever a tool lives right now, so links from Today, the planner and quick access never open a second copy. Each tool screen takes `mode: 'tab' | 'stack'`. Only Today is built with the app; once the intro has gone and the screen is still, Today prepares the other tabs one at a time, so a first visit never waits and nothing is built out of sight during the intro. Tabs are never frozen, and a switch is a short shift from the side the new tab sits on. A screen makes its entrance the first time it is really in view, once.

**Data.** One persisted zustand store (`src/store.ts`, version 5). A load that fails or answers late is never silent: the saved data is copied aside before anything can overwrite it, and Settings, under Data, can share or restore that copy. Journal text lives in files with a small index in the store, because Android cannot read a single storage row over about 2 MB. Backups carry everything, journal text included. Because the store is one row, a save waits for a 350 ms pause instead of following every keystroke, and the app going to the background writes whatever is waiting.

**Journal.** Opens on the right page: before the cutoff hour (11:00 by default) the page is about yesterday. Saves run through one queue, so leaving, switching days or deleting never races a save. The archive searches titles, text and tags, filters by month, mood, tags and pins, and shows streaks and On this day. Moving to another day slides the page the way time runs, and the calendar glides between months.

**Locks.** One app PIN of four digits opens everything that locks: the journal, the Notes tool as a whole, and single notes, which lock from inside the note. The journal and Notes can also open with the phone's own screen lock, each only if that is turned on in Settings, under Privacy; a single locked note always asks for the PIN. There is no lock on the whole app. The PIN is kept only as a salted SHA-256 in the keystore, with five tries and then a cooldown that survives restarts, so a forgotten PIN cannot be brought back; a PIN or passcode from before four digits works once more, then a new one is chosen. Locks hide content; they do not encrypt it. While locked content is open, Android keeps it out of screenshots and the recent apps preview, and making a backup while anything is locked asks for the PIN first.

**Deep Work.** A running session survives the app being closed. Its length is a wheel in five minute steps, with the number itself open for typing an exact one, and a running countdown rolls each second over. Ambient mode is a dimmed, always-on clock that drifts a few points each minute; hold anywhere to leave it.

**Intro.** Four unhurried beats, each finishing before the next: the signature is written from a real pen recording, and today's date after it in the owner's own handwritten digits, a little quicker; both shift into place as the logo rises; the wordmark and caption arrive while one slow light crosses the plate and the signature together; then the scene settles back into the material and Home rises in its place, the tab bar last. The date is the phone's own, read again just before it is written, and the app is built in the still moment after it, so building never shows as a stutter.

**Planner.** The day is a wheel: drag it and every day keeps its place in one size gradient, large and bright at the centre and smaller outward, or tap a day beside it. There is one tick per day passed, the blocks arrive from the side the new day came from, and away from today a Today link comes back.

## Design system

Everything visual comes from `src/theme.ts`.

- **One light.** `NEU_ANGLE` 60 and `NEU_DIST` 6 drive every raised and carved surface. Surfaces use `NEU`, `neuRaised()` and `neuInset()` only, never literal shadows; tracks under 20 points use the hairline carve.
- **One accent.** Chosen in Settings from seven swatches, Iris by default; Terracotta is Claude's own orange. No glows.
- **Type.** Rubik through the `F` faces and the closed `T` scale (display 30, h1 22, title 17, body 15, label 13, caption 12, kicker 11), IBM Plex Mono for timers. Never `fontWeight`.
- **Copy.** Sentence case, no emoji, no em dashes.
- **Palette.** Claude's dark greys. The material is Claude's raised surface `#30302E`, carved floors sit a step below it at `#2B2B29`, and text uses `#FAF9F5`, `#C2C0B6` and `#9C9A92`. The minimal theme is Claude's own flat layering: canvas `#262624` ground, surface cards, sidebar `#1F1E1D` wells.
- **Spacing.** Generous by default: `S.section` 34 between sections, `S.gap` 14 between cards, and controls never sit flush against the card below them.
- **Tab bar.** A quiet rail on the material under one hairline: outline icons, and only the current tab takes the accent, with its name and a small dot beneath. Every tool's glyph comes from `src/tools.ts`, so the bar, More, Settings and quick access always agree.
- **Raised inside carved is clipped.** A raised part sitting in a carved well (a toggle knob, a segmented thumb, a radio dot) is clipped by that well, so neither its light nor its shadow crosses the rim.
- **Depth where it counts.** Cards, buttons, keys, toggles, fields and segmented controls are neumorphic. The tab bar and rows of small choices are flat: chips, colour swatches, calendar days, moods, and the planner's day wheel.
- **One card per list.** A list is one raised card with hairlines between its rows. A long list that scrolls a row at a time draws the same card in slices, each clipped where it meets the next, so the list still reads as one object with no seams. Rows fold in and out, and a ticked task has its strike-through drawn across it.
- **Fields are lines.** A text field is a label above a line, and an accent line grows across that line while you type.
- **Quick access is a bento.** A shortcut with something useful to say takes a wide tile and says it, the rest stay small, and no row of four ends with a hole. The tiles are neutral, with the colour left in the icon.

## Re-recording the signature

Record a new signature in the Intro Lab, press **Copy my data**, and paste the copied text into `scripts/signature.raw.json` (a bare `{"strokes":[...]}` recording works too; a lab copy also carries its size and speed picks). Then run:

```
node scripts/build-signature.js
```

It regenerates `src/signature.ts` (commit it) and prints a summary of the model.

## Re-recording the handwritten date

Write the ten digits and place the day, month and year on the signature in the Handwriting Lab, press **Copy my data**, and paste the copied text into `scripts/handwriting.raw.json`. Then run:

```
node scripts/build-handwriting.js
```

It regenerates `src/handDate.ts` (commit it) and prints each digit's width and length. Placements are in the signature's own units, so re-recording the signature means placing the date again.

## Layout

```
app/                  routes: (tabs) with slot1..3 stacks, full-screen tool pages, settings
src/screens/          one body per tool, shared by its tab and full-screen routes
src/tools.ts          the tool registry
src/toolNav.ts        openTool, tab fling, slot context
src/store.ts          persisted state, migrations, backups, load safety
src/journal.ts        journal files, days, prompts, search, stats
src/lock.ts           lock sessions, the app PIN, the optional screen lock
src/intro.ts          the intro's phase, which the app's own entrance follows
src/handDate.ts       generated: the handwritten digits and where the date sits
src/deepWork.ts       session timing shared by Focus and ambient
src/theme.ts          palette, NEU shadows, type scale
src/components/       UI kit, tab bar, sheets, toasts, lock gate, ambient view, intro
scripts/              signature and handwriting builders, type lint, store tests
modules/app-list/     native installed-apps module
```
