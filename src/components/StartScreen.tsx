import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GestureType } from 'react-native-gesture-handler';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, Extrapolation, cancelAnimation, interpolate, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, F, LX, LY, NEU, bgFor, darkSh, liteSh } from '../theme';
import { useStore } from '../store';
import { SKIP_WAIT_MS, SKIP_WAIT_NO_FONTS_MS, setIntroPhase, useIntro } from '../intro';
import { SIG_SIZE, SIG_SPEED } from '../signature';
import { dateDigits } from '../sigModel';
import { EASE_OUT, useAnimLevel } from './Motion';
import { WIDE_AT } from '../layout';
import { DATE_SPEED, SHINE_SKEW, Signature, SignatureStill, inkExtent, layoutDate, useIntroSignature } from './Signature';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/* ------------------------------------------------------------------ layout */

const PLATE = 160;
const R = 42;
const GAP_WORD = 30;
const WORD_H = 26;
/** the line under the wordmark ("Students on Steroids"): small, close under it */
const GAP_CAPTION = 7;
const CAPTION_H = 14;
const GAP_SIG = 30;
/** hero signature: width as a fraction of the screen width, centre as a fraction of its height */
const HERO_W = 0.78;
const HERO_Y = 0.46;
/**
 * The tallest a signature's slot may be for its width. The creator's (0.82) is well inside it; a recorded signature
 * taller than this is set narrower instead, so the column keeps about the height it was designed for.
 */
const SLOT_MAX_ASPECT = 1;
const CAPTION_OPACITY = 0.8;
/**
 * A wide window lays the intro out on a phone's width and scales the whole of it up, never past this, and never past
 * the height it has: the signature keeps its proportion to the plate on a tablet, and still fits a split screen.
 */
const DESIGN_W = 440;
const K_MAX = 1.33;
/** the share of a wide window's height the settled column may take */
const FIT_H = 0.86;
/** the closest the signature and its date come to the screen's edge, px */
const EDGE = 12;

// The icon's two seam grooves (viewBox = plate), a dark carve over a light lip, as in
// assets/icon.png. They fade and settle in; they are never stroke-drawn.
const GROOVE_TOP = 'M 62 52 C 90 68 124 72 166 62';
const GROOVE_BOT = 'M -6 98 C 40 86 78 90 104 112';

/**
 * The logo's own sheen: one soft band of warm white light across the plate, on the same beat, at the same angle and
 * over the same curve as the signature's accent shine, so a single light passes over both (band px, peak alpha).
 */
const SHEEN_W = 64;
const SHEEN_ALPHA = 0.12;
const SHEEN_SLANT = Math.tan((-SHINE_SKEW * Math.PI) / 180) * PLATE;

/* ------------------------------------------------------------------ plate extrusion tiers */

// NEU.raisedHigh is the kit pair: lite alpha .25 / blur 6, dark alpha .48 / blur 15, offsets LX/LY.
// The plate rises through three static tiers of that pair scaled by extrusion h and crossfades
// between them, so no shadow string is ever animated.
const HIGH = { liteA: 0.25, liteBlur: 6, darkA: 0.48, darkBlur: 15 };
const n2 = (v: number) => +v.toFixed(2);
const n3 = (v: number) => +v.toFixed(3);
function plateShadow(h: number): string {
  return `${n2(LX * h)}px ${n2(LY * h)}px ${n2(HIGH.liteBlur * h)}px ${liteSh(n3(HIGH.liteA * h))}, `
    + `${n2(-LX * h)}px ${n2(-LY * h)}px ${n2(HIGH.darkBlur * h)}px ${darkSh(n3(HIGH.darkA * h))}`;
}
if (__DEV__ && plateShadow(1) !== NEU.raisedHigh.boxShadow) {
  console.warn('StartScreen: the plate tiers no longer match NEU.raisedHigh; update HIGH');
}

/* ------------------------------------------------------------------ timeline */

// Four beats, each finishing before the next begins: the signature is written, and today's date after it; they
// shift into their slot as the logo rises; the wordmark and caption arrive with one slow shine across the plate and
// the signature; the scene settles back and hands over to the app. The pen keeps the recording's timing (the
// signature at SIG_SPEED, the date a little quicker at DATE_SPEED); the beats are real ms.
const SIG_START = 160;
const real = (modelMs: number) => modelMs / SIG_SPEED;
/** the pen lifts from the signature's last mark and starts the date */
const DATE_LIFT = 160;
/** beat 1 ends on the finished signature and date, held still */
const HOLD = 520;
/** the shift into the slot: a touch longer than the old 1060 ms, its last stretch eased out further, so it lands softly */
const SHIFT_DUR = 1140;
const LANDING = Easing.bezier(0.6, 0, 0.12, 1);
/** how long before the shift it checks that the app beneath has drawn, the most it waits for it, and the frames it then lets pass */
const SHIFT_CHECK = 40;
const SHIFT_WAIT_MAX = 1200;
const SHIFT_AFTER_DRAWN = 120;

/**
 * Every beat after the pen, from how long the signature (model ms) and today's date (real ms) take to write. The
 * Handwriting Lab places the date in time too: 'signature' writes it straight after the signature, in beat 1; 'outro'
 * (`late`) holds the signature alone and cuts the date into the carve after the shine, just before the hand-over. A
 * signature with no date (`dated` false) simply has no date beat.
 */
function beats(sigTotal: number, dateMs: number, late: boolean, dated: boolean) {
  const signed = real(SIG_START + sigTotal);
  /** the pen's last mark in beat 1: the signature's, or the date's after it */
  const penDone = late || !dated ? signed : signed + DATE_LIFT + dateMs;
  /** beat 2: the signature travels into its slot and sinks into a carve while the plate rises */
  const SHIFT = { at: penDone + HOLD, dur: 1060 };
  const RISE = { at: SHIFT.at + 240, dur: 1020, settle: 250 };
  const SINK = { at: SHIFT.at + 560, dur: 700 };
  const GROOVES = { at: RISE.at + 860, dur: 460 };
  /** beat 3 waits for the plate to settle */
  const TEXT = RISE.at + RISE.dur + RISE.settle + 160;
  const WORD = { at: TEXT, dur: 780 };
  const CAPTION = { at: TEXT + 300, dur: 520 };
  const SHINE = { at: TEXT + 100, dur: 2000 };
  /**
   * Beat 4, the hand-over: after a short rest the scene settles back into the material, the words first, then the
   * plate, then the signature. As it goes, the overlay's material gives way to the app's identical material and the
   * app makes its own entrance in the scene's place (intro phase `leaving`): the day rises, then the tab bar.
   */
  const shineEnd = SHINE.at + SHINE.dur;
  const dateStart = late ? shineEnd + DATE_LIFT : signed + DATE_LIFT;
  const LEAVE = late && dated ? dateStart + dateMs + HOLD : shineEnd + 320;
  const HANDOFF = LEAVE + 300;
  return {
    dateStart,
    /**
     * The app is built under the opaque overlay in the still beat after the pen, while nothing on screen moves,
     * so building it never shows as a stutter in the shift, the rise or the shine.
     */
    REVEAL: penDone + 80,
    SHIFT, RISE, SINK, GROOVES, WORD, CAPTION, SHINE, LEAVE, HANDOFF,
    CLEAR: { at: HANDOFF, dur: 260 },
    DONE: HANDOFF + 560,
  };
}
/**
 * "Logo first" (Settings, Start screen): the plate rises unhurried and settles, the wordmark and caption arrive, and
 * only then does the pen write the signature in the place it ends up in either way, below them. It sinks into the
 * carve, the same slow shine crosses the plate and the signature, and the scene hands over as usual.
 */
/** without the big signature the pen writes 1.55 times as fast: the signature comes last and should not keep Home waiting */
const LOGO_PEN = 1.55;

function logoBeats(sigTotal: number, dateMs: number, late: boolean, dated: boolean) {
  const RISE = { at: 160, dur: 1250, settle: 260 };
  const GROOVES = { at: RISE.at + 950, dur: 520 };
  const TEXT = RISE.at + RISE.dur + RISE.settle + 30;
  const WORD = { at: TEXT, dur: 800 };
  const CAPTION = { at: TEXT + 260, dur: 560 };
  /** the pen sets down as the caption finishes arriving */
  const penAt = TEXT + 680;
  const signed = penAt + real(sigTotal) / LOGO_PEN;
  const dateStart = late ? 0 : signed + DATE_LIFT / LOGO_PEN;
  const penDone = late || !dated ? signed : dateStart + dateMs / LOGO_PEN;
  /** the ink settles into the carve, where it stays */
  const SINK = { at: penDone + 260, dur: 620 };
  const SHINE = { at: SINK.at + 500, dur: 1900 };
  const shineEnd = SHINE.at + SHINE.dur;
  const lateStart = shineEnd + DATE_LIFT;
  const LEAVE = late && dated ? lateStart + dateMs / LOGO_PEN + HOLD : shineEnd + 300;
  const HANDOFF = LEAVE + 300;
  return {
    penAt,
    dateStart: late ? lateStart : dateStart,
    REVEAL: penDone + 80,
    RISE, GROOVES, WORD, CAPTION, SINK, SHINE, LEAVE, HANDOFF,
    CLEAR: { at: HANDOFF, dur: 260 },
    DONE: HANDOFF + 560,
  };
}

/**
 * Beat 4, the hand-over, from the moment the scene begins to settle back: the words, the plate and the signature
 * recede in turn; the material clears for the app and the app makes its entrance (CLEAR); the overlay goes (DONE).
 */
const RECEDE = { words: 0, plate: 70, sig: 140, dur: 460 };
const HAND = { clear: 300, clearDur: 260, done: 860 };

// 'some': the composed end state fades in, the app is built beneath it, the scene settles back and hands over
const SOME = { fade: 320, reveal: 360, leave: 900, handoff: 1080, done: 1440 };

/**
 * Tap to skip: every value still on its way is retargeted to where the composed scene has it, in one short ease out (the
 * pens finish their strokes in the same time); then, once the app beneath has drawn, the overlay clears in one motion
 * while the column lifts a touch. About 550 ms from the tap to Today.
 */
const SKIP_SETTLE = 220;
const SKIP_EXIT = 320;

/** Today as the phone keeps it: day, month and two-digit year, read at the moment it is needed. */
const todayDigits = () => dateDigits(new Date());

/** The logo's sheen, driven by the same value as the signature's shine. */
function PlateSheen({ glint }: { glint: SharedValue<number> }) {
  const bandProps = useAnimatedProps(() => ({
    x: -SHEEN_W + glint.value * (PLATE + SHEEN_W + SHEEN_SLANT),
  }));
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(glint.value, [0, 0.1, 0.85, 1], [0, 1, 1, 0], Extrapolation.CLAMP),
  }));
  return (
    <Animated.View pointerEvents="none" style={[st.plateFace, st.clip, style]}>
      <Svg width={PLATE} height={PLATE}>
        <Defs>
          <LinearGradient id="plateSheen" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.text} stopOpacity={0} />
            <Stop offset="0.5" stopColor={C.text} stopOpacity={SHEEN_ALPHA} />
            <Stop offset="1" stopColor={C.text} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <AnimatedRect
          y={0} width={SHEEN_W} height={PLATE} fill="url(#plateSheen)" skewX={SHINE_SKEW} animatedProps={bandProps}
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * "Signed first" intro. The user's signature is written large in ink with the recorded pen
 * timing, then today's date in their own digits, and held; then both travel under the wordmark and
 * sink from ink into a carve while the logo plate rises out of the material and its grooves settle;
 * then the wordmark and caption arrive while one slow, faint shine crosses the plate and the carved
 * signature together; then the scene settles back into the material and the app rises in its place.
 *
 * The date is the phone's own, read at launch and again just before it is written, so an intro that
 * runs over midnight still writes the new day.
 *
 * The signature is the one chosen in Settings (useIntroSignature): the creator's, or one recorded on
 * this phone, with its own digits and placement or with no date at all, which skips the date beat. A
 * recorded one writes only the parts of the date chosen for it (layoutDate leaves the others out).
 *
 * Contract with app/_layout.tsx: onReveal() builds the app beneath the opaque overlay; onDone()
 * unmounts the overlay. The app's own entrance follows the intro phase (src/intro.ts). Real ms at
 * SIG_SPEED 1.2 and DATE_SPEED 1.45 (18 09 26): full = reveal ~5500 / hand-over ~10300 / done ~10900;
 * some = reveal 360 / done 1440; none = no overlay, both callbacks in the first effect. The minimal
 * theme keeps its own background; the plate keeps the default material (brand exception).
 *
 * The overlay takes every touch until the hand-over, so nothing in the app built beneath it can be
 * pressed unseen. With "Tap to skip" on, a tap ends the intro early: whatever is still moving
 * settles into the composed scene in 220 ms (the pens finish their strokes), the app is built
 * beneath it, and once the app has drawn the overlay clears in 320 ms as the column lifts.
 */
export const StartScreen = React.memo(function StartScreen({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const liveTheme = useStore((s) => s.settings.theme);
  const liveLevel = useAnimLevel();
  // _layout mounts the intro only after hydration, so these are the user's settings; the intro
  // commits to them for its whole run, the signature included
  const liveIntro = useStore((s) => s.settings.introStyle);
  const liveSkip = useStore((s) => s.settings.introTapSkip);
  const liveSig = useIntroSignature();
  const [{ level, theme, style, tapSkip, sig }] = useState(() => ({
    level: liveLevel, theme: liveTheme, style: liveIntro, tapSkip: liveSkip === true, sig: liveSig,
  }));
  const { model, hand } = sig;
  const dated = hand != null;
  const late = dated && hand.place.when === 'outro';
  const logoFirst = style === 'logo';
  const { width: W, height: H } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  const [date, setDate] = useState(todayDigits);
  const dateRef = useRef(date);
  const dateMs = useMemo(() => (hand ? layoutDate(date, hand).total / DATE_SPEED : 0), []);
  const B = useMemo(() => beats(model.total, dateMs, late, dated), []);
  const L = useMemo(() => logoBeats(model.total, dateMs, late, dated), []);
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };
  /**
   * What a skip does on the JS side once the tap has started it on the UI thread: set by the timeline when it runs (tap to
   * skip on). `start` drops the timeline and builds the app; `settled` says the retarget has finished.
   */
  const skipJs = useRef<{ start: () => void; settled: () => void }>({ start: () => {}, settled: () => {} });
  const skipStart = useCallback(() => { skipJs.current.start(); }, []);
  const skipSettled = useCallback(() => { skipJs.current.settled(); }, []);

  const full = level === 'full';
  const overlay = useSharedValue(1);
  const content = useSharedValue(full ? 1 : 0);
  const tau = useSharedValue(0);
  const dateTau = useSharedValue(0);
  const travel = useSharedValue(0);
  const ink = useSharedValue(1);
  const carve = useSharedValue(0);
  const glint = useSharedValue(0);
  const rise = useSharedValue(full ? 0 : 1);
  const grooves = useSharedValue(full ? 0 : 1);
  const word = useSharedValue(full ? 0 : 1);
  // the line under the wordmark is gone (it named the app by its old name); its beat still runs, drawing nothing, so the
  // timeline and the skip keep their shape
  const caption = useSharedValue(full ? 0 : CAPTION_OPACITY);
  const leaveWords = useSharedValue(0);
  const leavePlate = useSharedValue(0);
  const leaveSig = useSharedValue(0);
  /** the skip's own exit: the column lifts as the overlay clears */
  const lift = useSharedValue(0);
  /** 1 while a tap may skip, 2 once one has, 0 when it may not (off, or the hand-over has begun) */
  const armed = useSharedValue(0);
  /** the date's pen's end, kept current when the date is read again, so the UI thread can finish it */
  const dateEnd = useSharedValue(hand ? layoutDate(date, hand).total : 0);
  /** times the retarget, so its end is told back to JS */
  const skipClock = useSharedValue(0);

  useEffect(() => {
    if (level === 'none') {
      callbacks.current.onReveal();
      setIntroPhase('done');
      callbacks.current.onDone();
      return undefined;
    }
    const animated = [
      overlay, content, tau, dateTau, travel, ink, carve, glint, rise, grooves, word, caption,
      leaveWords, leavePlate, leaveSig,
    ];
    const timers: ReturnType<typeof setTimeout>[] = [];
    const frames: number[] = [];
    /** the shift waiting for the app beneath to draw (see `rest`) */
    let waitUnsub: (() => void) | null = null;
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      callbacks.current.onReveal();
    };
    /** the scene has begun to settle back: from here on a tap changes nothing */
    let leaving = false;
    const finish = () => {
      setGone(true);
      setIntroPhase('done');
      callbacks.current.onDone();
    };
    const cubicOut = Easing.out(Easing.cubic);

    /** Beat 4 from `start` ms on: the scene settles back, one layer after another, and the material clears for the app. */
    const handOver = (start: number) => {
      at(start, () => { leaving = true; armed.value = 0; });
      const settle = { duration: RECEDE.dur, easing: cubicOut };
      leaveWords.value = withDelay(start + RECEDE.words, withTiming(1, settle));
      leavePlate.value = withDelay(start + RECEDE.plate, withTiming(1, settle));
      leaveSig.value = withDelay(start + RECEDE.sig, withTiming(1, settle));
      overlay.value = withDelay(start + HAND.clear, withTiming(0, { duration: HAND.clearDur, easing: Easing.inOut(Easing.quad) }));
      at(start + HAND.clear, () => setIntroPhase('leaving'));
      at(start + HAND.done, finish);
    };
    /** The same at some motion: quicker, and closer together. */
    const handOverSome = (start: number) => {
      at(start, () => { leaving = true; armed.value = 0; });
      const quick = { duration: 280, easing: cubicOut };
      leaveWords.value = withDelay(start, withTiming(1, quick));
      leavePlate.value = withDelay(start + 40, withTiming(1, quick));
      leaveSig.value = withDelay(start + 80, withTiming(1, quick));
      const handoff = start + SOME.handoff - SOME.leave;
      overlay.value = withDelay(handoff, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));
      at(handoff, () => setIntroPhase('leaving'));
      at(start + SOME.done - SOME.leave, finish);
    };

    /** The date's pen, `delay` ms from now, at the date's speed (`pace` times quicker again when the logo comes first). */
    const writeDate = (delay: number, digits: string, pace: number) => {
      if (!hand) return;
      const total = layoutDate(digits, hand).total;
      dateTau.value = withDelay(delay, withTiming(total, { duration: total / DATE_SPEED / pace, easing: Easing.linear }));
    };
    /** The phone's date is read again just before the pen starts on it, so the day written is always today's. */
    const rereadDate = (start: number, pace: number) => {
      if (!hand) return;
      at(start - 150, () => {
        const now = todayDigits();
        if (now === dateRef.current) return;
        dateRef.current = now;
        dateEnd.value = layoutDate(now, hand).total;
        setDate(now);
        cancelAnimation(dateTau);
        dateTau.value = 0;
        writeDate(150, now, pace);
      });
    };

    if (level === 'some') {
      content.value = withTiming(1, { duration: SOME.fade, easing: cubicOut });
      handOverSome(SOME.leave);
      at(SOME.reveal, reveal);
    } else if (logoFirst) {
      const cubicInOut = Easing.inOut(Easing.cubic);
      // beat 1: the plate rises out of the material and its grooves settle, unhurried; the signature is already in
      // its place, waiting for the pen, so nothing travels later
      travel.value = 1;
      rise.value = withDelay(L.RISE.at, withSequence(
        withTiming(0.99, { duration: L.RISE.dur, easing: cubicOut }),
        withTiming(1, { duration: L.RISE.settle, easing: Easing.inOut(Easing.quad) }),
      ));
      grooves.value = withDelay(L.GROOVES.at, withTiming(1, { duration: L.GROOVES.dur, easing: cubicOut }));
      // beat 2: the wordmark and the caption
      word.value = withDelay(L.WORD.at, withTiming(1, { duration: L.WORD.dur, easing: cubicOut }));
      caption.value = withDelay(L.CAPTION.at, withTiming(CAPTION_OPACITY, {
        duration: L.CAPTION.dur, easing: Easing.linear,
      }));
      // beat 3: the pen writes below them, in the place the signature keeps, and today's date after it
      tau.value = withDelay(L.penAt, withTiming(model.total, { duration: real(model.total) / LOGO_PEN, easing: Easing.linear }));
      writeDate(L.dateStart, dateRef.current, LOGO_PEN);
      rereadDate(L.dateStart, LOGO_PEN);
      // the ink settles into the carve, then one shine crosses the plate and the signature together
      ink.value = withDelay(L.SINK.at, withTiming(0, { duration: L.SINK.dur, easing: cubicInOut }));
      carve.value = withDelay(L.SINK.at, withTiming(1, { duration: L.SINK.dur, easing: cubicInOut }));
      glint.value = withDelay(L.SHINE.at, withTiming(1, { duration: L.SHINE.dur, easing: Easing.inOut(Easing.sin) }));
      // beat 4: the hand-over, as it always is
      handOver(L.LEAVE);
      at(L.REVEAL, reveal);
    } else {
      const cubicInOut = Easing.inOut(Easing.cubic);
      // beat 1: the pen, then today's date a little quicker
      tau.value = withDelay(real(SIG_START), withTiming(model.total, {
        duration: real(model.total), easing: Easing.linear,
      }));
      if (!late) {
        writeDate(B.dateStart, dateRef.current, 1);
        rereadDate(B.dateStart, 1);
      }
      at(B.REVEAL, reveal);
      /**
       * Beats 2 to 4, from `lead` ms from now, when the shift begins. Each keeps its place in the timeline relative to
       * the shift, so the scene plays exactly as composed, only starting once the app beneath has been built.
       */
      const rest = (lead: number) => {
        if (leaving) return;
        const d = (abs: number) => Math.max(0, lead + abs - B.SHIFT.at);
        // beat 2: the shift, landing softly in its slot, the sink into a carve, the rise
        travel.value = withDelay(d(B.SHIFT.at), withTiming(1, { duration: SHIFT_DUR, easing: LANDING }));
        ink.value = withDelay(d(B.SINK.at), withTiming(0, { duration: B.SINK.dur, easing: cubicInOut }));
        carve.value = withDelay(d(B.SINK.at), withTiming(1, { duration: B.SINK.dur, easing: cubicInOut }));
        // two-stage extrusion: the bulk of the rise, then the last 1% settles
        rise.value = withDelay(d(B.RISE.at), withSequence(
          withTiming(0.99, { duration: B.RISE.dur, easing: cubicOut }),
          withTiming(1, { duration: B.RISE.settle, easing: Easing.inOut(Easing.quad) }),
        ));
        grooves.value = withDelay(d(B.GROOVES.at), withTiming(1, { duration: B.GROOVES.dur, easing: cubicOut }));
        // beat 3: the words, and one shine across the plate and the signature at an even, unhurried pace
        word.value = withDelay(d(B.WORD.at), withTiming(1, { duration: B.WORD.dur, easing: cubicOut }));
        caption.value = withDelay(d(B.CAPTION.at), withTiming(CAPTION_OPACITY, {
          duration: B.CAPTION.dur, easing: Easing.linear,
        }));
        glint.value = withDelay(d(B.SHINE.at), withTiming(1, { duration: B.SHINE.dur, easing: Easing.inOut(Easing.sin) }));
        if (late) {
          writeDate(d(B.dateStart), dateRef.current, 1);
          rereadDate(d(B.dateStart), 1);
        }
        // beat 4: the scene settles back, one layer after another, and the material clears for the app
        handOver(d(B.LEAVE));
      };
      // The shift waits for a still moment: the app is built under the overlay after the pen, and on a slower phone
      // that can run past the held beat. Mounting it lands on the UI thread, so a shift moving meanwhile would stutter.
      // Once the app has drawn (at once, almost always), the shift begins as composed; at most it waits a little more.
      at(B.SHIFT.at - SHIFT_CHECK, () => {
        if (leaving) return;
        if (useIntro.getState().appDrawn) {
          rest(SHIFT_CHECK);
          return;
        }
        let started = false;
        const go = (lead: number) => {
          if (started) return;
          started = true;
          waitUnsub?.();
          waitUnsub = null;
          rest(lead);
        };
        waitUnsub = useIntro.subscribe((now) => { if (now.appDrawn) go(SHIFT_AFTER_DRAWN); });
        at(SHIFT_CHECK + SHIFT_WAIT_MAX, () => go(0));
      });
    }

    // Tap to skip. The tap itself retargets the scene on the UI thread (see `skipGesture` below), with no freeze: every
    // value on its way finishes in one short ease out. Here, on JS: the timeline's timers go, the app is built beneath
    // the still-opaque overlay, and once both the retarget is over and the app has drawn (or a cap has passed), the
    // overlay clears in one UI-thread motion. The phase and the end come from that motion's callbacks, not timers.
    let unsubDrawn: (() => void) | null = null;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    if (tapSkip) {
      let settled = false;
      let capped = false;
      let exiting = false;
      const exit = () => {
        if (exiting) return;
        exiting = true;
        unsubDrawn?.();
        unsubDrawn = null;
        if (capTimer) clearTimeout(capTimer);
        capTimer = null;
        setIntroPhase('leaving');
        const ease = { duration: SKIP_EXIT, easing: EASE_OUT };
        if (full) lift.value = withTiming(1, ease);
        overlay.value = withTiming(0, ease, (fin) => { if (fin) runOnJS(finish)(); });
      };
      const tryExit = () => {
        if (settled && (capped || useIntro.getState().appDrawn)) exit();
      };
      skipJs.current = {
        start: () => {
          if (exiting || capTimer) return;
          leaving = true;
          timers.forEach(clearTimeout);
          timers.length = 0;
          frames.forEach(cancelAnimationFrame);
          frames.length = 0;
          reveal();
          // the app cannot draw before its faces are in: only then may the scene hold a little longer for it
          capTimer = setTimeout(() => { capped = true; tryExit(); },
            useIntro.getState().appFonts ? SKIP_WAIT_MS : SKIP_WAIT_NO_FONTS_MS);
          unsubDrawn = useIntro.subscribe((now) => { if (now.appDrawn) tryExit(); });
          tryExit();
        },
        settled: () => { settled = true; tryExit(); },
      };
      armed.value = 1;
    }

    return () => {
      armed.value = 0;
      skipJs.current = { start: () => {}, settled: () => {} };
      waitUnsub?.();
      unsubDrawn?.();
      if (capTimer) clearTimeout(capTimer);
      timers.forEach(clearTimeout);
      frames.forEach(cancelAnimationFrame);
      animated.forEach(cancelAnimation);
    };
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const columnStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    // the whole column lifts a touch as it settles back, so the day below seems to take its place
    transform: [{ translateY: -10 * (leaveSig.value + lift.value) }],
  }));
  const plateStyle = useAnimatedStyle(() => ({
    opacity: 1 - leavePlate.value,
    transform: [{
      scale: interpolate(rise.value, [0, 1], [0.985, 1], Extrapolation.CLAMP) * (1 - 0.05 * leavePlate.value),
    }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rise.value, [0, 0.35], [0, 1], Extrapolation.CLAMP),
  }));
  const tierLowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rise.value, [0, 0.35, 0.7], [0, 1, 0], Extrapolation.CLAMP),
  }));
  const tierMidStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rise.value, [0.35, 0.7, 1], [0, 1, 0], Extrapolation.CLAMP),
  }));
  const tierHighStyle = useAnimatedStyle(() => ({
    opacity: interpolate(rise.value, [0.7, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const grooveStyle = useAnimatedStyle(() => ({
    opacity: grooves.value,
    transform: [{ translateY: 3 * (1 - grooves.value) }],
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value * (1 - leaveWords.value),
    transform: [{ translateY: 8 * (1 - word.value) - 6 * leaveWords.value }],
  }));
  // the caption comes up just after the word, a few points below its place, and leaves with it
  const captionStyle = useAnimatedStyle(() => ({
    opacity: caption.value * (1 - leaveWords.value),
    transform: [{ translateY: 5 * (1 - caption.value / CAPTION_OPACITY) - 6 * leaveWords.value }],
  }));
  const sigStyle = useAnimatedStyle(() => ({
    opacity: 1 - leaveSig.value,
    transform: [{ scale: 1 - 0.03 * leaveSig.value }],
  }));

  // The skip, started on the UI thread by the tap: nothing freezes; what is still moving is retargeted to the composed
  // end in one ease out, and the delayed hand-over that was waiting is dropped (the skip makes its own exit). A tap once
  // the hand-over has begun changes nothing; only the first tap counts.
  const modelTotal = model.total;
  const skipGesture = useMemo(() => Gesture.Tap().onEnd((_e, success) => {
    'worklet';
    if (!success || armed.value !== 1) return;
    if (overlay.value < 1 || leaveWords.value > 0 || leavePlate.value > 0 || leaveSig.value > 0) {
      armed.value = 0;
      return;
    }
    armed.value = 2;
    cancelAnimation(overlay);
    cancelAnimation(leaveWords);
    cancelAnimation(leavePlate);
    cancelAnimation(leaveSig);
    const q = { duration: SKIP_SETTLE, easing: EASE_OUT };
    content.value = withTiming(1, q);
    if (full) {
      tau.value = withTiming(modelTotal, q);
      // a date still to come at the end is left unwritten; one on its way finishes with the signature
      if (dated && (!late || dateTau.value > 0)) dateTau.value = withTiming(dateEnd.value, q);
      else cancelAnimation(dateTau);
      travel.value = withTiming(1, q);
      ink.value = withTiming(0, q);
      carve.value = withTiming(1, q);
      rise.value = withTiming(1, q);
      grooves.value = withTiming(1, q);
      word.value = withTiming(1, q);
      caption.value = withTiming(CAPTION_OPACITY, q);
      // a shine already crossing finishes its pass; one not begun never starts
      if (glint.value > 0) glint.value = withTiming(1, q);
      else cancelAnimation(glint);
    }
    skipClock.value = 0;
    skipClock.value = withTiming(1, { duration: SKIP_SETTLE }, (fin) => { if (fin) runOnJS(skipSettled)(); });
    runOnJS(skipStart)();
  }), []);

  if (level === 'none' || gone) return null;

  // a phone lays the intro out on its own width, as it always has; a wide window on a phone's, then scales it by k
  const wide = W >= WIDE_AT;
  // a date placed beside or below the signature hangs out of its slot: how far the ink reaches from the slot's centre,
  // signature units, so the slot narrows when the date would run off the screen's side at rest
  const ext = inkExtent(model, hand);
  const reachX = Math.max(model.vw / 2 - ext[0], ext[2] - model.vw / 2);
  const sigW = Math.min(
    SIG_SIZE * (wide ? DESIGN_W : W) * Math.min(1, model.vw / (SLOT_MAX_ASPECT * model.vh)),
    (((wide ? DESIGN_W : W) / 2 - EDGE) * model.vw) / reachX,
  );
  const sigH = (sigW * model.vh) / model.vw;
  const columnH = PLATE + GAP_WORD + WORD_H + GAP_CAPTION + CAPTION_H + GAP_SIG + sigH;
  const k = wide ? Math.min(K_MAX, (FIT_H * H) / columnH) : 1;
  // the column is centred and scaled about its centre, so the slot's centre sits k * (columnH - sigH) / 2 below the
  // screen's, and an offset inside it moves k times as far on screen
  const heroY = (HERO_Y * H - H / 2) / k - (columnH - sigH) / 2;
  // on a short window the hero never grows past 70% of the height, and the signature and its date written large stay
  // on the screen. Logo first never writes large, so its ink is laid out at its own size instead of the hero's.
  const unit = (k * sigW) / model.vw;
  const heroScale = logoFirst ? 1 : Math.max(1, Math.min(
    HERO_W / SIG_SIZE,
    (0.7 * H) / (k * sigH),
    (W / 2 - EDGE) / (reachX * unit),
    (HERO_Y * H - EDGE) / ((model.vh / 2 - ext[1]) * unit),
    ((1 - HERO_Y) * H - EDGE) / ((ext[3] - model.vh / 2) * unit),
  ));

  return (
    <Animated.View
      pointerEvents="box-none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, st.overlay, { backgroundColor: bgFor(theme) }, overlayStyle]}
    >
      <View pointerEvents="none" style={[st.scaler, k !== 1 && { transform: [{ scale: k }] }]}>
        <Animated.View style={[st.column, { height: columnH }, columnStyle]}>
          <Animated.View style={[st.plate, plateStyle]}>
            <Animated.View style={[st.plateFace, st.tierLow, tierLowStyle]} />
            <Animated.View style={[st.plateFace, st.tierMid, tierMidStyle]} />
            <Animated.View style={[st.plateFace, NEU.raisedHigh, tierHighStyle]} />
            <Animated.View style={[st.plateFace, st.plateBody, bodyStyle]} />
            <Animated.View style={[st.plateFace, st.clip, grooveStyle]}>
              <Svg width={PLATE} height={PLATE} viewBox={`0 0 ${PLATE} ${PLATE}`}>
                <Path d={GROOVE_TOP} stroke={liteSh(0.55)} strokeWidth={1.6} strokeLinecap="round" fill="none" translateX={1.2} translateY={2} />
                <Path d={GROOVE_BOT} stroke={liteSh(0.55)} strokeWidth={1.6} strokeLinecap="round" fill="none" translateX={1.2} translateY={2} />
                <Path d={GROOVE_TOP} stroke={darkSh(0.85)} strokeWidth={3} strokeLinecap="round" fill="none" />
                <Path d={GROOVE_BOT} stroke={darkSh(0.85)} strokeWidth={3} strokeLinecap="round" fill="none" />
              </Svg>
            </Animated.View>
            {full ? <PlateSheen glint={glint} /> : null}
          </Animated.View>

          <Animated.View style={[st.wordRow, wordStyle]}>
            {WORD.map((ch, i) => <WordLetter key={i} ch={ch} index={i} word={word} />)}
          </Animated.View>
          <Animated.Text style={[st.caption, captionStyle]} allowFontScaling={false}>Students on Steroids</Animated.Text>

          <Animated.View style={[{ width: sigW, height: sigH, marginTop: GAP_SIG }, sigStyle]}>
            {full ? (
              <Signature
                width={sigW}
                model={model}
                hand={hand}
                heroScale={heroScale}
                heroX={0}
                heroY={heroY}
                tau={tau}
                date={date}
                dateTau={dateTau}
                dateLate={late}
                travel={travel}
                ink={ink}
                carve={carve}
                glint={glint}
              />
            ) : (
              <SignatureStill width={sigW} model={model} hand={hand} date={date} />
            )}
          </Animated.View>
        </Animated.View>
      </View>
      <TouchShield gesture={skipGesture} />
    </Animated.View>
  );
});

const WORD = 'STUROIDS'.split('');

/**
 * One letter of the wordmark. The word arrives with its letters a little apart and draws them together as it comes
 * in; each letter is set at the word's final spacing and moves by transform alone, so no frame re-lays out the text.
 */
function WordLetter({ ch, index, word }: { ch: string; index: number; word: SharedValue<number> }) {
  const spread = (index - (WORD.length - 1) / 2) * 3;
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: spread * (1 - word.value) }] }));
  return <Animated.Text style={[st.word, style]} allowFontScaling={false}>{ch}</Animated.Text>;
}

/**
 * Takes every touch while the intro plays, so nothing in the app built beneath it can be pressed unseen, and lets
 * them through from the hand-over on. It holds a gesture of its own (the skip's tap, which does nothing while tap to
 * skip is off), which is what keeps the gesture handlers of the screens beneath from claiming a touch too.
 */
function TouchShield({ gesture }: { gesture: GestureType }) {
  const playing = useIntro((s) => s.phase === 'playing');
  return (
    <GestureDetector gesture={gesture}>
      <View style={StyleSheet.absoluteFill} pointerEvents={playing ? 'auto' : 'none'} collapsable={false} />
    </GestureDetector>
  );
}

const st = StyleSheet.create({
  overlay: { zIndex: 100, alignItems: 'center', justifyContent: 'center' },
  /** as wide as the screen, so the column inside is laid out as it always was; on a wide window it scales */
  scaler: { alignSelf: 'stretch' },
  column: { alignSelf: 'stretch', alignItems: 'center' },
  plate: { width: PLATE, height: PLATE, marginBottom: GAP_WORD },
  plateFace: {
    position: 'absolute', top: 0, left: 0, width: PLATE, height: PLATE, borderRadius: R,
  },
  // shadow-only tiers: an outset box shadow never paints under its own box, so these stay clear
  tierLow: { boxShadow: plateShadow(0.35) },
  tierMid: { boxShadow: plateShadow(0.7) },
  plateBody: { backgroundColor: C.card },
  clip: { overflow: 'hidden' },
  // letter spacing trails each glyph, so the left padding keeps the word optically centred
  wordRow: { flexDirection: 'row', justifyContent: 'center', height: WORD_H, paddingLeft: 3 },
  word: {
    height: WORD_H, lineHeight: WORD_H, textAlign: 'center',
    color: C.text, fontFamily: F.brand, fontSize: 22, letterSpacing: 3,
  },
  caption: {
    marginTop: GAP_CAPTION, height: CAPTION_H, lineHeight: CAPTION_H, textAlign: 'center',
    color: C.textDim, fontFamily: F.brand, fontSize: 10.5, letterSpacing: 1.6, paddingLeft: 1.6,
  },
});
