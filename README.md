# Sturoids

A local-first student hub for Android phones and tablets: tasks, Deep Work, a planner, notes, a journal, exam scores, a calculator, Desmos, a lecture-video vault and AI links, on one dark neumorphic material. React Native 0.79 (new architecture), Expo SDK 53, expo-router, zustand, Reanimated.

## Build

Double-click **`build-apk.bat`** (about 10 to 20 minutes). It installs over the old app, and saved data migrates on first launch.

Version 1.4 adds native modules (device unlock, secure storage, screen capture protection, keep awake, brightness, navigation bar, image cache, and the installed-apps list now answers off the JS thread). The first build after updating has to be a full native build.

## Checks

```
npx tsc --noEmit
npm run lint:type
npm run test:store
npm run test:backup
npm run test:scores
node scripts/build-signature.js --check
node scripts/build-handwriting.js --check
```

`lint:type` fails on `fontWeight`, fractional or sub-11 font sizes, and any size set without a font family.

`test:store` boots the real store in Node over an in-memory storage and checks a fresh install, the upgrade from a v4 blob, malformed data, backup round trips, and every load-failure path (an unreadable blob, an older copy already kept, storage that answers late).

`test:scores` checks the exam tree: sums, weighted averages and nested results, partial marking, an exam's own marks winning over its parts, negative marks, deltas and what is coming up, duplicating a mock with its number moved on, and repairing orphans and cycles (twice, with no change the second time).

`test:backup` runs the backup writer and reader in Node over a real folder standing in for the phone: base64 at every awkward length, data read back exactly, every attachment restored byte for byte (including files read in short pieces), and a backup cut short keeping what came before the cut.

## How it fits together

**Navigation.** The bar always has five places: Today, three slots and More. Settings chooses the tool in each slot. A tool in a slot opens as a tab and keeps the bar; every other tool opens full screen from More, with a back button. `openTool()` in `src/toolNav.ts` goes to wherever a tool lives right now, so links from Today, the planner and quick access never open a second copy. Each tool screen takes `mode: 'tab' | 'stack'`. Only Today is built with the app; once the intro has gone and the screen is still, Today prepares the other tabs one at a time, so a first visit never waits and nothing is built out of sight during the intro. Tabs are never frozen, and a switch is a short shift from the side the new tab sits on. A screen makes its entrance the first time it is really in view, once. Any tool can be archived from More (hold its row) or Settings; Desmos and AI Quick-Links start archived. An archived tool leaves More, quick access and Today, and its reminders pause until it is restored; a tool in a slot is never archived.

**Windows.** A phone is laid out exactly as it always was, and stays upright. From 600 dp wide (a tablet either way up, or a wide split screen) the tabs stand in a rail on the left and each screen sits in a centred column (`src/layout.ts`): 720 dp for lists and editors, 1040 dp for Today. Sheets stay at most 560 dp wide. A sideways tablet sets Today, Deep Work, the video player and the calculator in two columns. Every rule either applies from 600 dp or is a cap no phone reaches.

**Data.** One persisted zustand store (`src/store.ts`, version 5). A load that fails or answers late is never silent: the saved data is copied aside before anything can overwrite it, and Settings, under Data, can share or restore that copy. Journal text lives in files with a small index in the store, because Android cannot read a single storage row over about 2 MB. Backups carry everything: journal text, and the photos, videos and files attached to notes. The files follow the data in the same JSON file and are streamed in and out in pieces (`src/backup.ts`), so a backup with long videos never has to fit in memory; an older app still reads the data. Because the store is one row, a save waits for a 350 ms pause instead of following every keystroke, and the app going to the background writes whatever is waiting.

**Journal.** Opens on the right page: before the cutoff hour (11:00 by default) the page is about yesterday. Saves run through one queue, so leaving, switching days or deleting never races a save. The mood lives in one small Day button. After 30 words, with the keyboard closed, a quiet card asks how the day went (a mood and one to five stars); Skip means it never asks again for that entry, and it can be turned off. A task button adds a ToDo or a long-term task without leaving the page, prefilled with any selected text. The archive searches titles, text and tags, filters by month, mood, rating, tags and pins, sorts the best days first, and shows streaks, the average day and On this day. Moving to another day slides the page the way time runs, and the calendar glides between months.

**Locks.** One app PIN of four digits opens everything that locks: the journal, the Notes tool as a whole, and single notes, which lock from inside the note. Each locked note opens on its own, so giving the PIN for one leaves the others locked; the PIN given at the Notes tool's own lock opens them all. The journal and Notes can also open with the phone's own screen lock, each only if that is turned on in Settings, under Privacy; a single locked note always asks for the PIN. There is no lock on the whole app. The PIN is kept only as a salted SHA-256 in the keystore, with five tries and then a cooldown that survives restarts, so a forgotten PIN cannot be brought back; a PIN or passcode from before four digits works once more, then a new one is chosen. Locks hide content; they do not encrypt it. While locked content is open, Android keeps it out of screenshots and the recent apps preview, and making a backup while anything is locked asks for the PIN first.

**Deep Work.** A running session survives the app being closed. Its length is a wheel in five minute steps, with the number itself open for typing an exact one. Once started, the session is one raised plate (the Slab, picked in the Focus Lab): the subject, large minutes with small rolling seconds, a carved progress rule with the start and end times, and End, Pause and Ambient in the plate, with five more minutes and the current task below it. A countdown shows its full length at the start and posts an alert when it ends with the phone away. Ambient mode (the Monolith) is a dimmed, always-on clock with the minutes as large as the screen allows, sized from its shorter side; it drifts a little each minute, and holding anywhere leaves it. Seconds and the time of day on it are settings.

**Scores.** Exams nest as deep as they need: groups hold groups and exams, and an exam holds its subjects (none is fine, when one total is the whole story). An exam's own marks win; otherwise its subjects add up, or average by weight. Negative marks, a target, rank, percentile and a grade are all optional. A group shows its average, best and latest with the change from the one before, and what is coming up; "Duplicate without marks" repeats a mock's structure with its number moved on. The tree is repaired on every load (`src/scores.ts`), so a damaged backup can never stop the app opening.

**Tags and learnings.** Exams, subjects and learnings share one set of tags, each with its own colour, managed from the notebook. An exam keeps what it taught you: as many learnings as you like, each tagged, and all of them gather in the Learnings notebook. Picking tags there keeps a learning that carries any of them; "All tags" keeps only the ones carrying every tag picked, whatever else they carry too. A search box looks through what each learning says and the exam it came from. Deleting an exam takes its learnings with it, and Undo brings them both back.

**Undo.** Nothing is lost to one tap: deleting an exam, a learning or a habit, dropping yesterday's leftovers (several in a row share one Undo), copying a day and applying a week template all offer Undo, and an undone item goes back beside its old neighbours even if the list changed meanwhile. Deleting a tag in use, a note folder with notes or a template asks first.

**Intro.** Four unhurried beats, each finishing before the next: the signature is written from a real pen recording, and today's date after it in the owner's own handwritten digits, a little quicker (or, when the Handwriting Lab places the date before the outro, cut into the carve after the shine); both shift into place as the logo rises; the wordmark and caption arrive while one slow light crosses the plate and the signature together; then the scene settles back into the material and Home rises in its place, the tab bar last. Settings, Start screen offers Logo first instead: the plate and the words arrive, then the signature is written in the place it keeps below them. The date is the phone's own, read again just before it is written, and the app is built in the still moment after it, so building never shows as a stutter.

**Planner.** The day is a wheel: drag it and every day keeps its place in one size gradient, large and bright at the centre and smaller outward, or tap a day beside it. There is one tick per day passed, the blocks arrive from the side the new day came from, and away from today a Today link comes back.

## Design system

Everything visual comes from `src/theme.ts`.

- **One light.** `NEU_ANGLE` 60 and `NEU_DIST` 6 drive every raised and carved surface. Surfaces use `NEU`, `neuRaised()` and `neuInset()` only, never literal shadows; tracks under 20 points use the hairline carve.
- **One accent.** Chosen in Settings from seven swatches, Iris by default; Terracotta is Claude's own orange. No glows.
- **Type.** Rubik through the `F` faces and the closed `T` scale (display 30, h1 22, title 17, body 15, label 13, caption 12, kicker 11). Counting numbers are Rubik Light when large and Rubik Medium when small (the `T.num*` tokens); a clock sets each digit in a cell as wide as the widest figure (`NUM_DIGIT_W`, measured from the font), so it never shifts as it counts. Never `fontWeight`.
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

It regenerates `src/handDate.ts` (commit it) and prints each digit's width and length. Placements are in the signature's own units, so re-recording the signature means placing the date again. The generator also checks every day, month and year against the signature's strokes: where a pair would run into them, the pen makes room the way a hand would, tightening the space inside that pair and, only if that is not enough, writing it a little smaller, and the summary lists each pair it fitted. The lab's timing choice carries over: with the signature, the date is written straight after it; before the outro, the signature is held alone and the date is cut into the carve after the shine, just before the hand-over.

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
src/scores.ts         the exam tree: results, summaries, repair
src/layout.ts         window widths, columns and the rail
src/theme.ts          palette, NEU shadows, type scale
src/components/       UI kit, tab bar, sheets, toasts, lock gate, ambient view, intro
scripts/              signature and handwriting builders, type lint, store, backup and scores tests
modules/app-list/     native installed-apps module
supabase/setup.sql    the cloud backup schema, for the project's SQL editor
```
