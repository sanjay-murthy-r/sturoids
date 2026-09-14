import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing, interpolate, useAnimatedStyle, useSharedValue,
  withDelay, withSequence, withSpring, withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { C, F, bgFor } from '../theme';
import { useStore } from '../store';
import { RISE_OUT, useAnimLevel } from './Motion';

const PLATE = 160;
const R = 42;

// The icon's two seam grooves (viewBox = plate). Drawn as a dark carve with a
// light lip offset toward the shadow side — same deboss as assets/icon.png.
// They fade/settle in; there is deliberately NO stroke-draw animation.
const GROOVE_TOP = 'M 62 52 C 90 68 124 72 166 62';
const GROOVE_BOT = 'M -6 98 C 40 86 78 90 104 112';

/**
 * "Focus" intro. Out-of-focus light converges while the logo plate is pulled
 * into focus and extrudes out of the material (soft/diffuse shadows crossfade
 * into the crisp kit pair — no view-blur needed). The seam grooves carve in,
 * one quick low-key sheen crosses the plate, the wordmark settles, then the
 * scene defocuses into the app. Runs on both themes; the plate keeps the
 * default material — a deliberate brand exception on 'minimal'.
 *
 * Contract with app/_layout.tsx: onReveal() mounts the app beneath the
 * overlay; onDone() unmounts the overlay. Timings per animLevel:
 *   full ≈ reveal 2250 / done 2860 · some ≈ 820 / 1220 · none ≈ 50 / 420.
 */
export function StartScreen({ onReveal, onDone }: { onReveal: () => void; onDone: () => void }) {
  const theme = useStore((s) => s.settings.theme);
  const level = useAnimLevel();
  const [gone, setGone] = useState(false);
  const staticStart = level === 'none';

  const overlay = useSharedValue(1);
  const focus = useSharedValue(staticStart ? 1 : 0);   // 0 = defocused, 1 = crisp
  const scale = useSharedValue(staticStart ? 1 : 1.08);
  const bloomO = useSharedValue(0);
  const grooveO = useSharedValue(staticStart ? 1 : 0);
  const sheenX = useSharedValue(-120);
  const wordO = useSharedValue(staticStart ? 1 : 0);
  const capO = useSharedValue(staticStart ? 0.8 : 0);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));

    if (level === 'none') {
      overlay.value = withDelay(150, withTiming(0, { duration: 250 }));
      at(50, onReveal);
      at(420, () => { setGone(true); onDone(); });
    } else if (level === 'some') {
      focus.value = withTiming(1, { duration: 400, easing: Easing.out(Easing.cubic) });
      scale.value = withSpring(1, RISE_OUT);
      grooveO.value = withDelay(250, withTiming(1, { duration: 300 }));
      wordO.value = withDelay(450, withTiming(1, { duration: 300 }));
      capO.value = withDelay(550, withTiming(0.8, { duration: 250 }));
      at(820, () => { onReveal(); overlay.value = withTiming(0, { duration: 320 }); });
      at(1220, () => { setGone(true); onDone(); });
    } else {
      // full — ≈2.9s total
      bloomO.value = withSequence(
        withTiming(0.5, { duration: 180 }),
        withDelay(700, withTiming(0, { duration: 300 })),
      );
      focus.value = withDelay(120, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }));
      scale.value = withDelay(120, withSequence(
        withSpring(1, RISE_OUT),
        withDelay(700, withSequence(               // micro-breath ≈1800ms
          withTiming(1.012, { duration: 130 }),
          withTiming(1, { duration: 130 }),
        )),
      ));
      grooveO.value = withDelay(560, withTiming(1, { duration: 450 }));
      sheenX.value = withDelay(1150, withTiming(220, { duration: 550, easing: Easing.inOut(Easing.cubic) }));
      wordO.value = withDelay(1250, withTiming(1, { duration: 380 }));
      capO.value = withDelay(1450, withTiming(0.8, { duration: 320 }));
      at(2250, onReveal);
      at(2420, () => {                             // exit: defocus + dissolve
        focus.value = withTiming(0.4, { duration: 320 });
        scale.value = withTiming(1.05, { duration: 360, easing: Easing.in(Easing.cubic) });
        wordO.value = withTiming(0, { duration: 280 });
        capO.value = withTiming(0, { duration: 240 });
        overlay.value = withTiming(0, { duration: 380 });
      });
      at(2860, () => { setGone(true); onDone(); });
    }
    return () => timers.forEach(clearTimeout);
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlay.value }));
  const bloomStyle = useAnimatedStyle(() => ({
    opacity: bloomO.value,
    transform: [
      { translateX: interpolate(focus.value, [0, 1], [44, 6]) },
      { translateY: interpolate(focus.value, [0, 1], [-76, -12]) },
      { scale: interpolate(focus.value, [0, 1], [1.5, 0.95]) },
    ] as const,
  }));
  const wrapStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  // crisp sharpens late (focus²) while the soft ghost lingers — reads as a
  // true rack-focus emergence rather than a plain crossfade
  const softStyle = useAnimatedStyle(() => ({ opacity: (1 - focus.value) * 0.9 + 0.1 * (1 - focus.value * focus.value) }));
  const crispStyle = useAnimatedStyle(() => ({ opacity: focus.value * focus.value }));
  const grooveStyle = useAnimatedStyle(() => ({
    opacity: grooveO.value,
    transform: [{ translateY: interpolate(grooveO.value, [0, 1], [3, 0]) }],
  }));
  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheenX.value, [-120, -70, 170, 220], [0, 1, 1, 0]),
    transform: [{ translateX: sheenX.value }, { rotate: '18deg' }] as const,
  }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: wordO.value,
    transform: [{ translateY: (1 - wordO.value) * 8 }],
    letterSpacing: interpolate(wordO.value, [0, 1], [6, 3]),
    paddingLeft: interpolate(wordO.value, [0, 1], [6, 3]),
  }));
  const capStyle = useAnimatedStyle(() => ({ opacity: capO.value }));

  if (gone) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: bgFor(theme), zIndex: 100 }, st.center, overlayStyle]}
    >
      {/* out-of-focus light, converging toward the highlight side */}
      <Animated.View style={[st.bloom, bloomStyle]} />

      <Animated.View style={[st.plateWrap, wrapStyle]}>
        {/* defocused plate: huge, diffuse, faint shadow pair */}
        <Animated.View style={[st.plate, st.plateSoft, softStyle]} />
        {/* crisp plate: the kit pair */}
        <Animated.View style={[st.plate, st.plateCrisp, crispStyle]} />
        {/* seam grooves — deboss (dark carve + light lip) */}
        <Animated.View style={[StyleSheet.absoluteFill, st.clip, grooveStyle]}>
          <Svg width={PLATE} height={PLATE} viewBox={`0 0 ${PLATE} ${PLATE}`}>
            <Path d={GROOVE_TOP} stroke="rgba(128,139,159,0.55)" strokeWidth={1.6} strokeLinecap="round" fill="none" translateX={1.2} translateY={2} />
            <Path d={GROOVE_BOT} stroke="rgba(128,139,159,0.55)" strokeWidth={1.6} strokeLinecap="round" fill="none" translateX={1.2} translateY={2} />
            <Path d={GROOVE_TOP} stroke="rgba(24,26,30,0.85)" strokeWidth={3} strokeLinecap="round" fill="none" />
            <Path d={GROOVE_BOT} stroke="rgba(24,26,30,0.85)" strokeWidth={3} strokeLinecap="round" fill="none" />
          </Svg>
        </Animated.View>
        {/* one quick, low-key sheen pass */}
        <View style={[StyleSheet.absoluteFill, st.clip]}>
          <Animated.View style={[st.sheen, sheenStyle]}>
            <LinearGradient
              colors={['rgba(244,245,247,0)', 'rgba(244,245,247,0.16)', 'rgba(244,245,247,0)']}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </View>
      </Animated.View>

      <Animated.Text style={[st.word, wordStyle]}>STUROIDS</Animated.Text>
      <Animated.Text style={[st.caption, capStyle]}>ALL-IN-ONE STUDENT APP</Animated.Text>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  bloom: {
    position: 'absolute', width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(128,139,159,0.10)',
    boxShadow: '0 0 90px 40px rgba(128,139,159,0.16)',
  },
  plateWrap: { width: PLATE, height: PLATE, marginBottom: 30 },
  plate: {
    position: 'absolute', top: 0, left: 0, width: PLATE, height: PLATE,
    borderRadius: R, backgroundColor: C.card,
  },
  plateSoft: {
    boxShadow: '12px -20.8px 46px rgba(128,139,159,0.10), -12px 20.8px 54px rgba(24,26,30,0.20)',
  },
  plateCrisp: {
    boxShadow: '3px -5.2px 6px rgba(128,139,159,0.25), -3px 5.2px 15px rgba(24,26,30,0.48)',
  },
  clip: { borderRadius: R, overflow: 'hidden' },
  sheen: { position: 'absolute', top: -30, bottom: -30, left: 0, width: 70 },
  word: { color: C.text, fontFamily: F.semi, fontSize: 22 },
  caption: {
    color: C.textFaint, fontFamily: F.med, fontSize: 9,
    letterSpacing: 2.6, paddingLeft: 2.6, marginTop: 10,
  },
});
