import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing, Extrapolation, cancelAnimation, interpolate, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { C, F, LX, LY, NEU, bgFor, darkSh, liteSh } from '../theme';
import { useStore } from '../store';
import { SIG, SIG_SIZE, SIG_SPEED } from '../signature';
import { useAnimLevel } from './Motion';
import { Signature, SignatureStill } from './Signature';

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

// Four beats, each finishing before the next begins: the signature is written; it shifts into its slot
// as the logo rises; the wordmark and caption arrive with a slow accent shine along the signature; the
// scene rests and dissolves. The pen keeps the recording's timing at SIG_SPEED; the beats are real ms.
const SIG_START = 160;
const real = (modelMs: number) => modelMs / SIG_SPEED;
const SIGNED = real(SIG_START + SIG.total);
/** beat 1 ends on the finished signature, held still */
const HOLD = 500;
/** beat 2: the signature travels into its slot and sinks into a carve while the plate rises */
const SHIFT = { at: SIGNED + HOLD, dur: 920 };
const RISE = { at: SHIFT.at + 200, dur: 900, settle: 220 };
const SINK = { at: SHIFT.at + 480, dur: 600 };
const GROOVES = { at: RISE.at + 760, dur: 400 };
/** beat 3 waits for the plate to settle */
const TEXT = RISE.at + RISE.dur + RISE.settle + 100;
const WORD = { at: TEXT, dur: 680 };
const CAPTION = { at: TEXT + 260, dur: 440 };
const SHINE = { at: TEXT + 40, dur: 1600 };
/** the app mounts under the opaque overlay once the wordmark has landed, well before the dissolve */
const REVEAL = WORD.at + WORD.dur;
/** beat 4: a short rest on the finished scene, then the dissolve */
const EXIT = { at: SHINE.at + SHINE.dur + 280, dur: 480 };
const DONE = EXIT.at + EXIT.dur;

// 'some': the composed end state fades in, the app mounts beneath it, then it dissolves (real ms)
const SOME = { fade: 320, reveal: 700, dissolve: 760, done: 1000 };

/**
 * "Signed first" intro. The user's signature is written large in ink with the recorded pen
 * timing and held; then it travels under the wordmark and sinks from ink into a carve while the
 * logo plate rises out of the material and its grooves settle; then the wordmark and caption
 * arrive while one slow, faint accent shine runs along the carved signature; then the scene
 * rests and dissolves into the app.
 *
 * Contract with app/_layout.tsx: onReveal() mounts the app beneath the opaque overlay; onDone()
 * unmounts the overlay. Real ms at SIG_SPEED 1.2: full = reveal ~5430 / done ~7150;
 * some = reveal 700 / done 1000; none = no overlay, both callbacks in the first effect.
 * The minimal theme keeps its own background; the plate keeps the default material (brand exception).
 */
export function StartScreen({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const liveTheme = useStore((s) => s.settings.theme);
  const liveLevel = useAnimLevel();
  // _layout mounts the intro only after hydration, so these are the user's settings; the intro
  // commits to them for its whole run
  const [{ level, theme }] = useState(() => ({ level: liveLevel, theme: liveTheme }));
  const { width: W, height: H } = useWindowDimensions();
  const [gone, setGone] = useState(false);
  const callbacks = useRef({ onReveal, onDone });
  callbacks.current = { onReveal, onDone };

  const full = level === 'full';
  const overlay = useSharedValue(1);
  const content = useSharedValue(full ? 1 : 0);
  const exitScale = useSharedValue(1);
  const tau = useSharedValue(0);
  const travel = useSharedValue(0);
  const ink = useSharedValue(1);
  const carve = useSharedValue(0);
  const glint = useSharedValue(0);
  const rise = useSharedValue(full ? 0 : 1);
  const grooves = useSharedValue(full ? 0 : 1);
  const word = useSharedValue(full ? 0 : 1);
  const caption = useSharedValue(full ? 0 : CAPTION_OPACITY);

  useEffect(() => {
    if (level === 'none') {
      callbacks.current.onReveal();
      callbacks.current.onDone();
      return undefined;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };
    const finish = () => {
      setGone(true);
      callbacks.current.onDone();
    };

    if (level === 'some') {
      content.value = withTiming(1, { duration: SOME.fade, easing: Easing.out(Easing.cubic) });
      overlay.value = withDelay(SOME.dissolve, withTiming(0, {
        duration: SOME.done - SOME.dissolve, easing: Easing.inOut(Easing.quad),
      }));
      at(SOME.reveal, () => callbacks.current.onReveal());
      at(SOME.done, finish);
    } else {
      const cubicInOut = Easing.inOut(Easing.cubic);
      const cubicOut = Easing.out(Easing.cubic);
      // beat 1: the pen
      tau.value = withDelay(real(SIG_START), withTiming(SIG.total, {
        duration: real(SIG.total), easing: Easing.linear,
      }));
      // beat 2: the shift, the sink into a carve, the rise
      travel.value = withDelay(SHIFT.at, withTiming(1, { duration: SHIFT.dur, easing: cubicInOut }));
      ink.value = withDelay(SINK.at, withTiming(0, { duration: SINK.dur, easing: cubicInOut }));
      carve.value = withDelay(SINK.at, withTiming(1, { duration: SINK.dur, easing: cubicInOut }));
      // two-stage extrusion: the bulk of the rise, then the last 1% settles
      rise.value = withDelay(RISE.at, withSequence(
        withTiming(0.99, { duration: RISE.dur, easing: cubicOut }),
        withTiming(1, { duration: RISE.settle, easing: Easing.inOut(Easing.quad) }),
      ));
      grooves.value = withDelay(GROOVES.at, withTiming(1, { duration: GROOVES.dur, easing: cubicOut }));
      // beat 3: the words, and the shine at an even, unhurried pace
      word.value = withDelay(WORD.at, withTiming(1, { duration: WORD.dur, easing: cubicOut }));
      caption.value = withDelay(CAPTION.at, withTiming(CAPTION_OPACITY, {
        duration: CAPTION.dur, easing: Easing.linear,
      }));
      glint.value = withDelay(SHINE.at, withTiming(1, { duration: SHINE.dur, easing: Easing.inOut(Easing.sin) }));
      // beat 4: the dissolve
      overlay.value = withDelay(EXIT.at, withTiming(0, {
        duration: EXIT.dur, easing: Easing.inOut(Easing.quad),
      }));
      exitScale.value = withDelay(EXIT.at, withTiming(1.02, {
        duration: EXIT.dur, easing: Easing.out(Easing.quad),
      }));
      at(REVEAL, () => callbacks.current.onReveal());
      at(DONE, finish);
    }

    const animated = [overlay, content, exitScale, tau, travel, ink, carve, glint, rise, grooves, word, caption];
    return () => {
      timers.forEach(clearTimeout);
      animated.forEach(cancelAnimation);
    };
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const columnStyle = useAnimatedStyle(() => ({
    opacity: content.value,
    transform: [{ scale: exitScale.value }],
  }));
  const plateStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(rise.value, [0, 1], [0.985, 1], Extrapolation.CLAMP) }],
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
    opacity: word.value,
    transform: [{ translateY: 8 * (1 - word.value) }],
    // letter spacing trails each glyph, so the left padding keeps the word optically centred
    letterSpacing: 6 - 3 * word.value,
    paddingLeft: 6 - 3 * word.value,
  }));
  const captionStyle = useAnimatedStyle(() => ({ opacity: caption.value }));

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
        </Animated.View>

        <Animated.Text style={[st.word, wordStyle]}>STUROIDS</Animated.Text>
        <Animated.Text style={[st.caption, captionStyle]}>ALL-IN-ONE STUDENT APP</Animated.Text>

        <View style={{ width: sigW, height: sigH, marginTop: GAP_SIG }}>
          {full ? (
            <Signature
              width={sigW}
              heroScale={heroScale}
              heroX={0}
              heroY={heroY}
              tau={tau}
              travel={travel}
              ink={ink}
              carve={carve}
              glint={glint}
            />
          ) : (
            <SignatureStill width={sigW} />
          )}
        </View>
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
