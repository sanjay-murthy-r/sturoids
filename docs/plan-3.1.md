# Sturoids 3.1: the repair and polish plan

Written after going through the code behind every complaint. Each item states the cause found, what changes, and how it gets checked. Nothing is removed except the companion's chat card, which you asked to drop. Everything else only gets fixed, restyled or added.

---

## 0. Root causes found

| What you saw | Cause in the code |
|---|---|
| Gray slabs over the screen in Cheerful | Cheerful frosts the header, the status-bar band and the tab ground with `expo-blur`'s **experimental Android blur** (`dimezisBlurView`). On Android with the new architecture it does not blur. It paints a flat gray rectangle, and inside an animated-opacity parent it stays gray. |
| Crashes in Cheerful | The same experimental blur is mounted and unmounted by every header in Cheerful, and by Sift's rising blur in both moods. That component is known to crash Android apps on the new architecture when it unmounts during navigation. Cheerful mounts many of them; Elite mounts none, except in Sift. |
| Sift "entirely bugged" | Three problems. (1) The same blur is mounted full-screen under Sift on every open, so Sift on Android is gray or crashes. (2) Every result row has enter, exit and layout animations inside a list with sticky section headers, and the list rebuilds on every keystroke. Rows that are leaving linger and overlap the new rows, and sticky headers jump. (3) Each row has a wrapper with a ref for the PC arrow keys, rebuilt on every key press. |
| Header stopping halfway | The compact header's fade is tied to the scroll position, so a scroll that stops inside the 40-point band leaves it half-drawn. |
| Accessories carried from Sprout to Pip | A single `mascotGear` list is shared by both companions. |
| Glasses look wrong | The lens frame is drawn around a one-square eye, so the eye fills the whole lens. |

---

## 1. Stability first (both platforms)

1. **No experimental blur on Android, anywhere.**
   - `Ground` gets a solid ground on Android, and a real CSS backdrop blur on the PC and web, where it works.
   - Sift's backdrop becomes a dimming plus a scale on Android. The PC keeps the blur.
2. **Sift's list.**
   - Rows only fade in, with no exit or layout animations. A new search replaces the list in one crossfade, so rows never overlap.
   - Sticky headers stay, without layout animations around them.
   - The PC highlight is drawn by the row itself, not by a wrapper rebuilt on every key.
3. **Sift's open and close.** Opening, typing, filters, "+N more", tapping a result from every tab and tool, Back, pull to close, and the anchored open from More and Settings are each checked in a browser at phone and PC sizes with a large seeded library.
4. **Header swap.** The compact title and the ground switch on a threshold, with a short eased timing (on at 72 % of the band, off at 40 %). They are never half-drawn, and a stop mid-scroll still ends in one clean state.
5. **Crash audit of what only Cheerful runs.** This covers the backdrop glows, sparks, confetti, the makeover screen, the companion's gestures and timers, and its sounds. Every timer is cleared on unmount, nothing touches state after unmount, and no web-only styles reach Android.

## 2. The companion, rebuilt

**Where it lives.**
- Every screen's header publishes where its free room is: between the title and its buttons, on the header's own row.
- The companion's home on that screen is that gap, standing on the header's baseline. It never covers content, buttons or a title.
- The room is measured, not guessed. On a screen whose header has no room (a long title, many buttons), its home is a side ledge just under the header.
- On full-screen tools (Calculator, Desmos, Signature) and on the ambient screen it steps out by its door.

**Moving with you.**
- Switching tabs: it stays on the header row and takes a few quick steps to the new screen's gap, following the tab's direction.
- Opening a page: it does the same on the page's header.
- It never wanders into content and never teleports. Doors are used only to leave and come back.

**Doors.**
- The left and right screen edges are walls. A door is drawn in perspective, flat on the wall: a narrow upright shape whose far edge is shorter, hinged at the wall.
- It swings open into the room, the companion steps through from behind the wall, and the door swings shut and fades into the wall.
- Doors appear only on the side nearest to where it is going.

**Hold to send it off.**
- It waves goodbye, walks to the nearest wall, and goes through its door.
- A very small door sits flush with the right wall near the bottom, clear of the add buttons.
- Tapping that door plays a soft double knock and a gentle two-note doorbell, and the companion comes back through its door.
- Sending it off lasts until you knock, so there is no "until tomorrow" timer.

**The chat card is removed.** A tap instead gives a reaction and, sometimes, a short line about something real: the next ToDo, an exam's countdown, today's focus.

**Art.**
- **Glasses:** round, two-square-wide lenses with a light lens tint and a glint. The eyes are small inside them, so the lenses read as glass.
- **Book:** a smaller open book with a spine, page lines and a cover edge, held low. A page lifts as it turns.
- Pip's arms and Sprout's leaves hold the book's sides.

**Customisation.**
- Colours and what it keeps are saved per companion, so Sprout's ladybug never lands on Pip.
- Accessories are picture tiles showing the companion wearing each one. Tap to add or remove; no toggles.
- The page has its own Cheerful look.

**Words.**
- A new set of short lines: quirky, funny and kind, mostly built from your day. Examples:
  - "27 ToDos. I counted twice. Still 27."
  - "Chemistry test in 3 days. Ionic bonds won't bond themselves."
  - "It's 1 am. Even the Wi-Fi is asleep."
- Lines keep resting for weeks once said, and the daily budget stays.

**Behaviour.**
- It mostly lives in place: breathing, blinking, looking around, thinking, stretching, ruffling its leaves or squishing. It takes a few steps along its row now and then.
- During Deep Work it reads at its home and stays silent until the end.

## 3. Cheerful's own look (Elite's structure, its own skin)

Cheerful keeps Elite's layout, spacing and controls but gets its own surfaces, set once in the shared kit so every screen follows.

- **Surfaces:** cards in a warm charcoal with a soft drop shadow and a faint warm rim, in place of Elite's double neumorphic shadows. Those shadows are what read as gray smudges over the coloured backdrop.
- **Wells and fields:** a soft tinted fill, with no inner shadow.
- **Headers:** titles in the round face (Nunito), with a solid ground that fades softly into the page. No blur slab and no hairline.
- **Section titles, chips and toggles:** warm-tinted pills, with the accent used sparingly.
- **Backdrop:** the glows stay, a little softer, and drift only on the screen in front.
- **Features:** anything added that helps in both moods goes into both.

## 4. Checks before it ships

- The type check, every test suite, and new tests for the header threshold, per-companion gear and the dialogue engine.
- A browser pass at phone, tablet and PC sizes, in both moods, with a large seeded library: every route, Sift flows, the companion's doors, send-off and knock.
- Code review of the Android-only paths that cannot be run here (no Android device in this environment). The plan avoids anything experimental there.
