// A drag, a swipe or a hold that did something (picked a tile up, moved a widget) ends with the finger lifting over
// whatever it started on, which would otherwise read as a tap on it. The gesture marks the moment; a press that comes
// within a beat of it is not a tap. Bouncy (every card, row and chip) checks it; so does anything pressed under a drag.

let until = 0;
/** A gesture did something just now: presses for the next beat are not taps. */
export function markGesture(ms = 400) {
  until = Math.max(until, Date.now() + ms);
}
/** Whether a press now is the end of a gesture rather than a tap. */
export function justGestured(): boolean {
  return Date.now() < until;
}
