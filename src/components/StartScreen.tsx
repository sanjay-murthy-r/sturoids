import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, Extrapolation, cancelAnimation, interpolate, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { C, F, LX, LY, NEU, bgFor, darkSh, liteSh } from '../theme';
import { useStore } from '../store';
import { setIntroPhase } from '../intro';
import { SIG, SIG_SIZE, SIG_SPEED } from '../signature';
import { useAnimLevel } from './Motion';
import { DATE_SPEED, SHINE_SKEW, Signature, SignatureStill, layoutDate } from './Signature';

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/* ------------------------------------------------------------------ layout */

const PLATE = 160;
const R = 42;
const GAP_WORD = 30;
const WORD_H = 26;
const GAP_CAPTION = 10;
const CAPTION_H = 12;
const GAP_SIG = 34;
/** hero signature: width as a fraction of the screen width, centre as a fraction of its height */
const HERO_W = 0.78;
const HERO_Y = 0.46;
const CAPTION_OPACITY = 0.8;

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
const SIGNED = real(SIG_START + SIG.total);
/** the pen lifts from the signature's last mark and starts the date */
const DATE_LIFT = 160;
/** beat 1 ends on the finished signature and date, held still */
const HOLD = 520;

/** Every beat after the pen, from how long today's date takes to write (real ms). */
function beats(dateMs: number) {
  const dateStart = SIGNED + DATE_LIFT;
  const written = dateStart + dateMs;
  /** beat 2: the signature travels into its slot and sinks into a carve while the plate rises */
  const SHIFT = { at: written + HOLD, dur: 1060 };
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
  const LEAVE = SHINE.at + SHINE.dur + 320;
  const HANDOFF = LEAVE + 300;
  return {
    dateStart,
    /**
     * The app is built under the opaque overlay in the still beat after the date, while nothing on screen moves,
     * so building it never shows as a stutter in the shift, the rise or the shine.
     */
    REVEAL: written + 80,
    SHIFT, RISE, SINK, GROOVES, WORD, CAPTION, SHINE, LEAVE, HANDOFF,
    CLEAR: { at: HANDOFF, dur: 260 },
    DONE: HANDOFF + 560,
  };
}
const RECEDE = { words: 0, plate: 70, sig: 140, dur: 460 };

// 'some': the composed end state fades in, the app is built beneath it, the scene settles back and hands over
const SOME = { fade: 320, reveal: 360, leave: 900, handoff: 1080, done: 1440 };

/** Today as the phone keeps it: day, month and two-digit year, read at the moment it is needed. */
function todayDigits(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, '0');
  return two(d.getDate()) + two(d.getMonth() + 1) + two(d.getFullYear() % 100);
}

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
 * Contract with app/_layout.tsx: onReveal() builds the app beneath the opaque overlay; onDone()
 * unmounts the overlay. The app's own entrance follows the intro phase (src/intro.ts). Real ms at
 * SIG_SPEED 1.2 and DATE_SPEED 1.45 (18 09 26): full = reveal ~5500 / hand-over ~10300 / done ~10900;
 * some = reveal 360 / done 1440; none = no overlay, both callbacks in the first effect. The minimal
 * theme keeps its own background; the plate keeps the default material (brand exception).
 */
export function StartScreen({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const liveTheme = useStore((s) => s.settings.theme);
  const liveLevel = useAnimLevel();
  // _layout mounts the intro only after hydration, so these are the user's settings; the intro
  // commits to them for its whole run
  const [{ level, theme }] = useState(() => ({ level: liveLevel, theme: liveTheme }));
  const { width: W, height: H } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  const [date, setDate] = useState(todayDigits);
  const dateRef = useRef(date);
  const B = useMemo(() => beats(layoutDate(date).total / DATE_SPEED), []);
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };

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
  const caption = useSharedValue(full ? 0 : CAPTION_OPACITY);
  const leaveWords = useSharedValue(0);
  const leavePlate = useSharedValue(0);
  const leaveSig = useSharedValue(0);

  useEffect(() => {
    if (level === 'none') {
      callbacks.current.onReveal();
      setIntroPhase('done');
      callbacks.current.onDone();
      return undefined;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
    const finish = () => {
      setGone(true);
      setIntroPhase('done');
      callbacks.current.onDone();
    };
    const cubicOut = Easing.out(Easing.cubic);

    if (level === 'some') {
      content.value = withTiming(1, { duration: SOME.fade, easing: cubicOut });
      const quick = { duration: 280, easing: cubicOut };
      leaveWords.value = withDelay(SOME.leave, withTiming(1, quick));
      leavePlate.value = withDelay(SOME.leave + 40, withTiming(1, quick));
      leaveSig.value = withDelay(SOME.leave + 80, withTiming(1, quick));
      overlay.value = withDelay(SOME.handoff, withTiming(0, { duration: 220, easing: Easing.inOut(Easing.quad) }));
      at(SOME.reveal, () => callbacks.current.onReveal());
      at(SOME.handoff, () => setIntroPhase('leaving'));
      at(SOME.done, finish);
    } else {
      const cubicInOut = Easing.inOut(Easing.cubic);
      // beat 1: the pen, then today's date a little quicker
      tau.value = withDelay(real(SIG_START), withTiming(SIG.total, {
        duration: real(SIG.total), easing: Easing.linear,
      }));
      const writeDate = (delay: number, digits: string) => {
        const total = layoutDate(digits).total;
        dateTau.value = withDelay(delay, withTiming(total, { duration: total / DATE_SPEED, easing: Easing.linear }));
      };
      writeDate(B.dateStart, dateRef.current);
      // the phone's date is read again just before the pen starts on it, so the day written is always today's
      at(B.dateStart - 150, () => {
        const now = todayDigits();
        if (now === dateRef.current) return;
        dateRef.current = now;
        setDate(now);
        cancelAnimation(dateTau);
        dateTau.value = 0;
        writeDate(150, now);
      });
      // beat 2: the shift, the sink into a carve, the rise
      travel.value = withDelay(B.SHIFT.at, withTiming(1, { duration: B.SHIFT.dur, easing: cubicInOut }));
      ink.value = withDelay(B.SINK.at, withTiming(0, { duration: B.SINK.dur, easing: cubicInOut }));
      carve.value = withDelay(B.SINK.at, withTiming(1, { duration: B.SINK.dur, easing: cubicInOut }));
      // two-stage extrusion: the bulk of the rise, then the last 1% settles
      rise.value = withDelay(B.RISE.at, withSequence(
        withTiming(0.99, { duration: B.RISE.dur, easing: cubicOut }),
        withTiming(1, { duration: B.RISE.settle, easing: Easing.inOut(Easing.quad) }),
      ));
      grooves.value = withDelay(B.GROOVES.at, withTiming(1, { duration: B.GROOVES.dur, easing: cubicOut }));
      // beat 3: the words, and one shine across the plate and the signature at an even, unhurried pace
      word.value = withDelay(B.WORD.at, withTiming(1, { duration: B.WORD.dur, easing: cubicOut }));
      caption.value = withDelay(B.CAPTION.at, withTiming(CAPTION_OPACITY, {
        duration: B.CAPTION.dur, easing: Easing.linear,
      }));
      glint.value = withDelay(B.SHINE.at, withTiming(1, { duration: B.SHINE.dur, easing: Easing.inOut(Easing.sin) }));
      // beat 4: the scene settles back, one layer after another, and the material clears for the app
      const settle = { duration: RECEDE.dur, easing: cubicOut };
      leaveWords.value = withDelay(B.LEAVE + RECEDE.words, withTiming(1, settle));
      leavePlate.value = withDelay(B.LEAVE + RECEDE.plate, withTiming(1, settle));
      leaveSig.value = withDelay(B.LEAVE + RECEDE.sig, withTiming(1, settle));
      overlay.value = withDelay(B.CLEAR.at, withTiming(0, { duration: B.CLEAR.dur, easing: Easing.inOut(Easing.quad) }));
      at(B.REVEAL, () => callbacks.current.onReveal());
      at(B.HANDOFF, () => setIntroPhase('leaving'));
      at(B.DONE, finish);
    }

    const animated = [
      overlay, content, tau, dateTau, travel, ink, carve, glint, rise, grooves, word, caption,
      leaveWords, leavePlate, leaveSig,
    ];
    return () => {
      timers.forEach(clearTimeout);
      animated.forEach(cancelAnimation);
    };
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const columnStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    // the whole column lifts a touch as it settles back, so the day below seems to take its place
    transform: [{ translateY: -10 * leaveSig.value }],
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
    // letter spacing trails each glyph, so the left padding keeps the word optically centred
    letterSpacing: 6 - 3 * word.value,
    paddingLeft: 6 - 3 * word.value,
  }));
  const captionStyle = useAnimatedStyle(() => ({
    opacity: caption.value * (1 - leaveWords.value),
    transform: [{ translateY: -6 * leaveWords.value }],
  }));
  const sigStyle = useAnimatedStyle(() => ({
    opacity: 1 - leaveSig.value,
    transform: [{ scale: 1 - 0.03 * leaveSig.value }],
  }));

  if (level === 'none' || gone) return null;

  const sigW = SIG_SIZE * W;
  const sigH = (sigW * SIG.vh) / SIG.vw;
  const columnH = PLATE + GAP_WORD + WORD_H + GAP_CAPTION + CAPTION_H + GAP_SIG + sigH;
  // the column is centred, so the slot's centre sits (columnH - sigH) / 2 below the screen's
  const heroY = HERO_Y * H - (H / 2 + (columnH - sigH) / 2);
  // on a short window the hero never grows past 70% of the height
  const heroScale = Math.max(1, Math.min(HERO_W / SIG_SIZE, (0.7 * H) / sigH));

  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[StyleSheet.absoluteFill, st.overlay, { backgroundColor: bgFor(theme) }, overlayStyle]}
    >
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

        <Animated.Text style={[st.word, wordStyle]}>STUROIDS</Animated.Text>
        <Animated.Text style={[st.caption, captionStyle]}>ALL-IN-ONE STUDENT APP</Animated.Text>

        <Animated.View style={[{ width: sigW, height: sigH, marginTop: GAP_SIG }, sigStyle]}>
          {full ? (
            <Signature
              width={sigW}
              heroScale={heroScale}
              heroX={0}
              heroY={heroY}
              tau={tau}
              date={date}
              dateTau={dateTau}
              travel={travel}
              ink={ink}
              carve={carve}
              glint={glint}
            />
          ) : (
            <SignatureStill width={sigW} date={date} />
          )}
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  overlay: { zIndex: 100, alignItems: 'center', justifyContent: 'center' },
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
  word: {
    height: WORD_H, lineHeight: WORD_H, textAlign: 'center',
    color: C.text, fontFamily: F.semi, fontSize: 22,
  },
  caption: {
    height: CAPTION_H, lineHeight: CAPTION_H, marginTop: GAP_CAPTION, textAlign: 'center',
    color: C.textFaint, fontFamily: F.med, fontSize: 11, letterSpacing: 2.2, paddingLeft: 2.2,
  },
});
