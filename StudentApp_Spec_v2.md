# All-in-One Student App — Build Spec v2 (expanded)

*Supersedes v1. Adds: full glass design language, deeper per-feature detail, Claude's added ideas (marked ✦), and the revised distribution plan (GitHub installer, no store).*

---

## 1. What this app is

A single, focused **student productivity hub**: dashboard, tasks, focus timer, weekly planner + habits, notes (with English voice), calculator, Desmos, a YouTube study module, and AI quick-links. One user profile, no accounts, everything local-first.

**Distribution (revised):** no app store. Build a signed **Android APK** and host it on a **GitHub Releases** page — anyone (you, Sachithaa, friends) downloads and sideloads it. This is fully feasible and free:
- Expo's **EAS Build** produces a signed APK.
- GitHub Releases hosts it with version tags (v1.0, v1.1…), changelogs, and a stable download link.
- Users enable "Install from unknown sources" once — standard for sideloading.
- **Trade-offs to know:** no auto-updates (users re-download new APKs — though ✦ see §4.11 for an in-app "update available" check), Android-only this way (iOS sideloading isn't practical without a Mac + paid Apple account), and Android may show a "harmless app?" scan prompt on install (normal for non-store APKs).

---

## 2. Design language — "Quiet Glass"

The look you chose from bubbbly.com, adapted honestly for mobile GPUs:

- **Canvas:** deep navy-ink (#0A0F1E) with 2–3 soft radial colour glows (blue / violet / teal) and blurred ambient light blobs — this is what the glass visibly refracts against. Glass on a flat background reads as grey mush; glass needs light behind it.
- **Frosted glass cards** everywhere: translucent white gradient + blur(18px) + saturate + 1px light border + inner top highlight. Cheap enough to run on every card.
- **One refractive hero per screen** — on the dashboard it's the **clock orb** (heavier blur, curved highlight arc, inner glow). One hero, everything else quiet. This is the discipline that keeps it premium instead of gaudy.
- **Type:** Inter (or similar); gradient-tinted display text for the user's name only; tabular numerals for the clock and stats.
- **Colour roles:** accent blue #8FB4FF (focus/primary), green #5EE6A8 (done/habits), amber #FFB46B (deadlines), soft red-pink (Vault/video).
- **Glass intensity is a theme setting** (Off / Subtle / Full) — doubles as the low-end-phone escape hatch. ✦
- Dark glass is the primary theme; a light "morning glass" variant can come later.
- **Build order still holds:** features plain first, glass layered in Phase 4. The prototype defines the target so nothing is designed twice.

---

## 3. Screen map

```
App
├── Today (Dashboard)               ← home
├── Tasks
│     ├── Daily
│     └── Missions (time-bound / long-term)
├── Deep Work (Focus timer/stopwatch)
├── Planner (weekly blocks) + Streaks (habits)
├── Notes (text + voice)
├── Calculator
├── Desmos
├── Vault (YouTube study module)
│     ├── Library (folders + tags)
│     └── Player (timed notes, bookmarks)
├── AI Quick-Links
└── Settings
```

---

## 4. Feature specifications (expanded)

### 4.1 Today (Dashboard)
- Greeting + name, date, and the **clock orb** (digital ⇄ analogue on tap; style also settable in Settings).
- **Glance strip:** tasks left today · habits done.
- **Quick access grid** (3×2): Tasks, Deep Work, Planner, Notes, Calc, Vault.
- Inline "Today" task list (check off without leaving home) + habit chips.
- No dead space; everything tappable.
- ✦ **Next block up:** a slim card showing the current/next Planner block ("Physics · 4:00–5:30") so the timetable is felt daily, not buried in the Planner tab.
- ✦ **Contextual greeting details:** after 9pm, quietly surface tomorrow's first block instead of today's.

### 4.2 Tasks
- **Daily to-dos:** recur each day; unchecked ones roll into a gentle "yesterday's leftovers" prompt next morning ✦ (accept / move to today / drop — 5-second triage, prevents silent pile-up).
- **Missions (time-bound):** deadline date, differentiated visually (amber pill), sorted by proximity.
- ✦ **Subtasks on Missions only** (a mock test mission might hold "attempt / analyse / re-attempt errors") — keep daily tasks flat and fast.
- ✦ **Quick-add from anywhere:** a floating add that parses "physics set by sun" into a Sunday-due mission. (Nice-to-have; plain add ships first.)

### 4.3 Deep Work (Focus timer)
- Stopwatch + countdown modes.
- Attach tasks **before or after** starting: on-the-spot custom task, or pull from Tasks (missions differentiated).
- Check off during; **post-session review** asks status of unchecked items (done / still pending / drop).
- ✦ **Session log:** store each session (duration, tasks touched) → a simple weekly focus-minutes bar on the dashboard. Cheap to build, hugely motivating.
- ✦ **Ambient mode:** during a session the screen dims to just the clock orb + current task — glass at its best, distraction at its least.
- ✦ **No pause-shaming, but honest logging:** pauses are allowed; the log records net focused time, not wall time.

### 4.4 Planner + Streaks
- **Weekly timetable:** blocks per day (subject, start–end, colour); copy a day to another day ✦ (Mon→Tue in one tap — huge quality-of-life).
- **Streaks (habit checklist):** daily habits, check off, per-habit streak counter ✦ (current + best). Optional **timely reminders** per habit.
- ✦ **Week templates:** save the whole week as a template ("Exam week", "Normal week") and switch between them.
- ✦ Planner blocks can deep-link to Deep Work: tap a block → timer pre-loaded with that subject.

### 4.5 Notes
- Text notes: title, body, timestamps, edit history-lite (created/modified).
- **Folders + tags** (same organisational model as the Vault — one mental model everywhere ✦).
- **English voice input:** on-device speech-to-text, tap-mic-and-talk, inserts at cursor. Expect imperfect words; it's a draft tool.
- Search across titles + bodies; pin/favourite.
- ✦ **Note → Task:** select a line in a note, promote it to a task. Notes are where tasks are usually born.
- ✦ **Auto-link:** a note created during a Deep Work session tags itself with that session's subject.

### 4.6 Calculator
- **Built in-app** on a precise math-expression engine (exact/decimal arithmetic — no 0.1+0.2 nonsense). Your margin note ("most accurate and reliable") is the spec.
- Standard + scientific; expression history (tap an old result to reuse ✦).
- ✦ **Physics-friendly:** degree/radian toggle prominent, scientific-notation display toggle, last-answer (Ans) key.

### 4.7 Desmos
- Official Desmos embeddable calculator widget in a dedicated tab.
- ✦ Opens with a blank graph but remembers your last state per session where the widget allows.

### 4.8 Vault (YouTube study module)
- **Share-to-app:** app registers as an Android share target; sharing a YouTube link lands it in the Vault (choose folder on arrival ✦).
- **Player:** embedded official YouTube player; app-side seek/play/pause.
- **Timed notes** ("note @ 12:34") and **bookmarks** (moment or clip-range); tap → jump.
- **Library:** folders (nested ok) as primary structure + tags as the flexible layer; per-video notes/bookmarks list; search, filter, sort; move between folders.
- Optional: **screenshot-detected bookmark suggestion** ("Screenshot near 12:34 — save a bookmark?").
- ✦ **Watch-later inbox:** shared videos land in an Inbox by default if you skip folder-choice — zero-friction capture, organise later.
- ✦ **Bookmark export:** export a video's notes/bookmarks as plain text/markdown into Notes — revision sheets from lectures, basically free.
- Honest limits (unchanged): no frame capture, no programmatic screenshots, YouTube controls some player chrome.

### 4.9 AI Quick-Links
- Grid of AI tools; each tries the **native app first**, falls back to website. Configurable list in Settings ✦ (add/remove/reorder).

### 4.10 Settings
- **Theme:** dark glass (default) / light later; **glass intensity Off–Subtle–Full**; accent colour.
- **Clock:** digital/analogue, 12/24h.
- **Reminders:** master toggle + per-habit; notification permission flow.
- ✦ **Data export/backup:** one-tap export of all app data (tasks, notes, vault metadata) to a JSON file — you own your data, and it survives phone changes. Import on the other side. This matters extra since there's no cloud account.
- ✦ **App-open PIN (optional):** trivial to add, some students share devices.

### 4.11 ✦ In-app update check (new, because of GitHub distribution)
- On launch (or manual tap), the app checks the GitHub Releases feed for a newer version tag; if found, shows "v1.2 available → download". Solves the no-auto-update problem of sideloading with ~30 lines of code.

---

## 5. Claude's cross-cutting little ideas (✦ summary)

| Idea | Where | Why it earns its place |
|---|---|---|
| Next-block-up card | Dashboard | Makes the Planner felt daily |
| Yesterday's-leftovers triage | Tasks | Prevents silent to-do rot |
| Subtasks on Missions only | Tasks | Depth where needed, speed elsewhere |
| Session log + weekly focus bar | Deep Work | Cheap, honest motivation |
| Ambient focus mode | Deep Work | The glass aesthetic doing real work |
| Copy-day + week templates | Planner | Timetables change weekly; make that painless |
| Block → pre-loaded timer | Planner/Deep Work | Connects plan to action |
| Note → Task promotion | Notes/Tasks | Tasks are born inside notes |
| Vault Inbox (organise later) | Vault | Zero-friction capture |
| Bookmark → Notes export | Vault/Notes | Lecture → revision sheet pipeline |
| Expression history + Ans key | Calculator | How students actually calculate |
| Glass intensity setting | Theme | Premium look AND low-end phones |
| JSON export/import backup | Settings | No cloud = backup is on us |
| GitHub update check | Settings | Fixes sideloading's one real gap |
| Optional PIN | Settings | Shared-device reality |

None of these are Phase-1 blockers; they slot into their feature's phase.

---

## 6. Explicitly dropped / limited (unchanged)

| Idea | Status | Why |
|---|---|---|
| Free AI without API | Dropped | No compliant path; quick-links instead |
| Programmatic screenshot | Dropped | OS security boundary |
| Clean-frame screenshot flow | Dropped | Detection fires after capture |
| Video frame pixel capture | Dropped | YouTube embed is a locked box |
| Screenshot-detect bookmark | Optional | After-the-fact suggestion is fine |
| Refractive glass everywhere | Limited | GPU cost; one hero per screen |
| Play Store publishing | **Dropped by choice** | GitHub APK route instead (§1) |

---

## 7. Build order (phased)

**Phase 1 — Core:** Today dashboard (from the glass prototype's layout, plain-styled) → Tasks → Deep Work → Calculator.
**Phase 2 — Study tools:** Planner + Streaks → Notes (+voice) → theme system skeleton → Desmos.
**Phase 3 — Vault:** share-in → player → timed notes/bookmarks → library (folders/tags) → inbox.
**Phase 4 — Polish & ship:** Quiet Glass theme layer → clock styles → reminders → settings hub → JSON backup → **EAS APK build → GitHub Release v1.0 → update-check**.

Rule that governs everything: **one feature fully working before the next.**

---

## 8. Stack

- **React Native + Expo** (Android APK via EAS Build; live preview via Expo Go during dev).
- **Local storage** (SQLite or equivalent) — local-first, no accounts; JSON export as the backup story.
- **mathjs or a decimal-precise engine** for the calculator.
- **YouTube iframe player** component; Android **share-intent** config.
- **expo-speech-recognition** (or equivalent on-device STT) for voice notes.
- **expo-notifications** for habit reminders.
- **GitHub Releases** for distribution + a tiny version-check against its API.

---

## 9. Names (locked candidates)

Today · Tasks & **Missions** · **Deep Work** · Planner & **Streaks** · Notes · Calculator · Desmos · **Vault** · Settings.

---

*End of Spec v2. Next step: first Claude Code scaffold prompt for Phase 1.*
