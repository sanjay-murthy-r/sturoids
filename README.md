# Student Hub — All-in-One Student App

Local-first student productivity hub built from `StudentApp_Spec_v2.md`.
React Native + Expo (SDK 53) · expo-router · zustand + AsyncStorage · Quiet Glass design.

Verified: TypeScript clean + full Metro/Hermes production bundle exports successfully.

---

## A. Get it on your phone as a real installed app (recommended)

One-time setup on your PC (needs Node.js LTS from nodejs.org):

```
cd "E:\CLAUDE code projects\All in One Student App"
npm install
npm install -g eas-cli
eas login                      # free account at expo.dev — sign up first
eas build:configure            # answer: Android
eas build -p android --profile preview
```

- The build runs on Expo's servers (free tier) and takes ~10–20 min.
- When done, the terminal (and expo.dev dashboard) gives an APK download link — open it on your phone, download, and install (allow "install from unknown sources" once).
- If `--profile preview` errors because `eas.json` lacks it, add:

```json
{
  "build": {
    "preview": { "android": { "buildType": "apk" } }
  }
}
```

The APK unlocks everything, including habit reminders; voice notes & share-to-Vault are wired for a later native pass.

## B. Quick live preview instead (Expo Go)

```
cd "E:\CLAUDE code projects\All in One Student App"
npm install
npx expo start --tunnel
```

Scan the QR shown in the terminal with the Expo Go app (Play Store), or paste the `exp://` URL into Expo Go → "Enter URL manually". `--tunnel` works across different networks (accept the ngrok install prompt on first run).

---

## Distribution to others (spec §1)

1. Push this folder to a GitHub repo; create a release tagged `v1.0.0`; attach the APK.
2. In-app: Settings → Updates → enter `owner/repo`. "Check for updates" compares the latest release tag against the installed version and links the download.
3. For each update: bump `version` in `app.json` + `package.json`, rebuild, tag a new release.

---

## What's inside

| Screen | Highlights |
|---|---|
| **Today** | Clock orb (tap: digital⇄analogue), next-block-up card (after 9pm → tomorrow's first), unified glance strip, quick grid, inline today list with progress count, habit chips, weekly focus chart |
| **Tasks** | Daily to-dos + per-item yesterday's-leftovers triage; Missions with deadline pills (D-n / TODAY / overdue) and subtasks |
| **Deep Work** | Countdown (25/50/90/120/custom) + stopwatch, attach tasks (custom or from Tasks), ambient mode, post-session review (done/pending/drop), honest net-time session log |
| **Planner** | Weekly blocks with colours, copy-day, week templates, block → pre-loaded Deep Work session |
| **Streaks** | Habits with current + best streak, editable daily reminder times |
| **Notes** | Folders, search, pin, timestamps, line → task promotion |
| **Calculator** | mathjs BigNumber engine (0.1+0.2 = 0.3 exactly), DEG/RAD, SCI notation, scientific keys, Ans, tappable history |
| **Desmos** | Full graphing calculator (WebView, remembers session state) |
| **Vault** | Paste-link capture → Inbox, folders, YouTube player with timed notes + bookmarks (tap to jump), export → revision sheet in Notes |
| **AI Quick-Links** | Configurable grid (add/remove/reorder), opens native app when installed |
| **Settings** | Glass intensity Off/Subtle/Full, clock prefs, reminders, JSON backup export/import, GitHub update check |

Everything persists locally (AsyncStorage via zustand). No accounts, no cloud — the JSON backup in Settings is your safety net when changing phones.

## Design system ("Quiet Glass")

- 4pt spacing rhythm: screens 20 / cards 16 / gaps 12 / sections 28.
- Type scale ≈1.25: display 30/800 (−0.7 tracking) → h1 24 → title 17 → body 15 → label 13 → caption 12 → uppercase kickers 11/+2.2 tracking. Tabular numerals on the clock and all stats.
- One refractive hero per screen (the clock orb); every other card is quiet glass.
- Glass intensity is a setting (Off/Subtle/Full) — the low-end-phone escape hatch.

## Project layout

```
app/            screens (expo-router file routing)
  (tabs)/       Today · Tasks · Deep Work · Planner · More
  notes/        list + editor
  vault/        library + player
  calculator, desmos, ai-links, settings
src/
  store.ts      all data + persistence + backup snapshot
  theme.ts      colours, spacing rhythm, type scale
  utils.ts      dates, streaks, YouTube parsing, versions
  notifications.ts
  components/   UI kit (GlassCard, Sheet, …) + ClockOrb
```
