import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T } from '../src/theme';
import { useStore } from '../src/store';
import { Card, Chip, Hairline, ScreenBG, SectionTitle, Toggle, useToolHeader } from '../src/components/UI';
import { Enter } from '../src/components/Motion';
import { READ_MAX, frame } from '../src/layout';
import { todayKey } from '../src/utils';
import { CUTE, CUTE_BOLD, GridArt, Sprite } from '../src/components/Mascot';
import { COLOR_SETS, FLIERS, Kind, NAMES, PROPS, Pose, REST, colorSet, gearFor } from '../src/mascot/art';
import { startMakeover } from '../src/components/Makeover';

const TALK: { key: 'often' | 'some' | 'asked'; label: string; line: string }[] = [
  { key: 'often', label: 'Chatty', line: 'Up to six little lines a day, twenty minutes apart at least.' },
  { key: 'some', label: 'Now and then', line: 'Two or three a day, never close together.' },
  { key: 'asked', label: 'When spoken to', line: 'Never by itself. Still waves, cheers and studies along.' },
];

const BLURB: Record<Kind, string> = {
  sprout: 'A little plant who waves with its leaves, waters itself, and opens a bud as your day gets done.',
  pip: 'A soft, round friend with nub arms who bounces, hums along, and keeps a balloon.',
};

/**
 * The companion's page: who it is (Sprout or Pip, or none), its name, its colours, what it wears or keeps, and how much
 * it talks, with a live preview that shows each choice as it is made and can be asked to wave, think, cheer or read.
 */
export default function CompanionPage() {
  const insets = useSafeAreaInsets();
  const s = useStore((st) => st.settings);
  const setSetting = useStore((st) => st.setSetting);
  const tool = useToolHeader({ title: 'Companion', mode: 'page' });
  const kind: Kind = s.mascot === 'pip' ? 'pip' : 'sprout';
  const off = s.mascot === 'off';
  const name = s.mascotName || NAMES[kind];
  const set = colorSet(kind, s.mascotColors);
  const gear = (s.mascotGear || []).filter((g) => gearFor(kind).some((x) => x.key === g));
  const [nameDraft, setNameDraft] = React.useState(s.mascotName);
  const preview = usePreview();

  const choose = (k: Kind | 'off') => {
    if (k === s.mascot) return;
    setSetting('mascot', k);
    if (k !== 'off') { setSetting('mascotAwayOn', ''); setSetting('mascotColors', ''); setNameDraft(s.mascotName); preview.play('wave'); }
  };
  const toggleGear = (k: string) => {
    let next = gear.includes(k) ? gear.filter((g) => g !== k) : [...gear, k];
    // one friend flying about at a time
    if (!gear.includes(k) && FLIERS.includes(k)) next = next.filter((g) => g === k || !FLIERS.includes(g));
    // gear for the other companion is kept, so switching back finds it as it was
    const others = (s.mascotGear || []).filter((g) => !gearFor(kind).some((x) => x.key === g));
    setSetting('mascotGear', [...others, ...next]);
    if (!gear.includes(k)) preview.play(k === 'glasses' ? 'read' : 'cheer');
  };
  const saveName = () => {
    const v = nameDraft.replace(/\s+/g, ' ').trim().slice(0, 16);
    setNameDraft(v);
    if (v !== s.mascotName) { setSetting('mascotName', v); preview.play('wave'); }
  };

  let enter = 0;
  return (
    <ScreenBG>
      {tool.bar}
      <Animated.ScrollView
        {...tool.scrollProps}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[frame(READ_MAX), { padding: S.pad, paddingTop: tool.padTop, paddingBottom: 48 + insets.bottom }]}
      >
        <Enter index={enter++}>
          {tool.hero}
          {s.mood !== 'cheerful' ? (
            <Card style={{ marginBottom: 14 }}>
              <Text style={T.body}>Your companion lives in Cheerful.</Text>
              <Pressable onPress={() => startMakeover('cheerful')} accessibilityRole="button" style={{ marginTop: 8 }}>
                <Text style={[T.body, { color: C.accent, fontFamily: F.semi }]}>Switch to Cheerful</Text>
              </Pressable>
            </Card>
          ) : s.mascotAwayOn === todayKey() && !off ? (
            <Card style={{ marginBottom: 14 }}>
              <Text style={T.body}>{name} is tucked away until tomorrow.</Text>
              <Pressable onPress={() => setSetting('mascotAwayOn', '')} accessibilityRole="button" style={{ marginTop: 8 }}>
                <Text style={[T.body, { color: C.accent, fontFamily: F.semi }]}>Bring {name} back now</Text>
              </Pressable>
            </Card>
          ) : null}
          {!off ? (
            <View style={st.stage}>
              <Animated.View style={preview.style}>
                <Sprite kind={kind} pose={preview.pose} gear={gear} bud={preview.bud} pal={set.pal} px={6} />
              </Animated.View>
              {gear.includes('ladybug') ? <View style={st.bug}><GridArt grid={PROPS.ladybug.grid} pal={PROPS.ladybug.pal} px={4} /></View> : null}
              {gear.includes('firefly') ? <View style={st.fly}><View style={st.flyHalo} /><View style={st.flyDot} /></View> : null}
              {kind === 'pip' && gear.includes('balloon') ? (
                <View style={st.balloon}>
                  <GridArt grid={PROPS.balloon.grid} pal={{ a: set.pal.a, A: set.pal.A, h: '#FFFFFF' }} px={5} />
                  <View style={{ width: 1.5, height: 40, backgroundColor: 'rgba(120,110,100,0.7)' }} />
                </View>
              ) : null}
              <Text style={st.stageName}>{name}</Text>
              <View style={st.tries}>
                {(['wave', 'think', 'cheer', 'read'] as const).map((k) => (
                  <Pressable key={k} onPress={() => preview.play(k)} accessibilityRole="button" style={({ pressed }) => [st.try, pressed && { opacity: 0.6 }]}>
                    <Text style={st.tryText}>{k === 'read' ? 'Study' : k[0].toUpperCase() + k.slice(1)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </Enter>

        <Enter index={enter++}>
          <SectionTitle>Who</SectionTitle>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {(['sprout', 'pip'] as const).map((k) => {
              const on = s.mascot === k;
              return (
                <Pressable
                  key={k} onPress={() => choose(k)} accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={NAMES[k] + '. ' + BLURB[k]}
                  style={({ pressed }) => [st.who, { borderColor: on ? C.accent : 'transparent', backgroundColor: C.card }, pressed && !on && { transform: [{ scale: 0.98 }] }]}
                >
                  <Sprite kind={k} pose={REST} gear={[]} bud={2} pal={COLOR_SETS[k][0].pal} px={3} />
                  <Text style={[T.body, { fontFamily: F.semi, marginTop: 8 }, on && { color: C.accent }]}>{NAMES[k]}</Text>
                  <Text style={[T.caption, { marginTop: 2 }]} numberOfLines={3}>{BLURB[k]}</Text>
                </Pressable>
              );
            })}
          </View>
          <Pressable onPress={() => choose('off')} accessibilityRole="radio" accessibilityState={{ selected: off }} style={{ marginTop: 12, alignSelf: 'flex-start' }}>
            <Text style={[T.caption, { color: off ? C.accent : C.textDim, fontFamily: F.smMed }]}>{off ? 'No companion' : 'No companion, thanks'}</Text>
          </Pressable>
        </Enter>

        {!off ? (
          <>
            <Enter index={enter++}>
              <SectionTitle>Name</SectionTitle>
              <Card>
                <TextInput
                  value={nameDraft} onChangeText={setNameDraft} onBlur={saveName} onSubmitEditing={saveName}
                  placeholder={NAMES[kind]} placeholderTextColor={C.textFaint} maxLength={16} returnKeyType="done"
                  style={[st.name, { color: C.text }]} accessibilityLabel="Your companion's name"
                />
                <Text style={[T.caption, { marginTop: 4 }]}>What it is called when it says goodbye, and in its little card.</Text>
              </Card>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Colours</SectionTitle>
              <View style={st.swatches}>
                {COLOR_SETS[kind].map((c) => {
                  const on = c.key === set.key;
                  return (
                    <Pressable
                      key={c.key} onPress={() => { setSetting('mascotColors', c.key); preview.play('hop'); }}
                      accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name}
                      style={({ pressed }) => [st.swatch, { backgroundColor: C.card, borderColor: on ? C.accent : 'transparent' }, pressed && { opacity: 0.8 }]}
                    >
                      <Sprite kind={kind} pose={REST} gear={[]} bud={2} pal={c.pal} px={2} />
                      <Text style={[T.caption, { marginTop: 4 }, on && { color: C.accent }]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Keeps with it</SectionTitle>
              <Card pad={0}>
                {gearFor(kind).map((g, i, all) => (
                  <View key={g.key}>
                    <View style={st.gearRow}>
                      <View style={{ flex: 1, marginRight: 12 }}>
                        <Text style={[T.body, { fontFamily: F.med }]}>{g.name}</Text>
                        <Text style={[T.caption, { marginTop: 2 }]}>{g.line}</Text>
                      </View>
                      <Toggle value={gear.includes(g.key)} onChange={() => toggleGear(g.key)} label={g.name} />
                    </View>
                    {i < all.length - 1 ? <Hairline /> : null}
                  </View>
                ))}
              </Card>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>How much it talks</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TALK.map((t) => <Chip key={t.key} small label={t.label} active={s.mascotTalk === t.key} onPress={() => setSetting('mascotTalk', t.key)} />)}
              </View>
              <Text style={[T.caption, { marginTop: 8 }]}>{TALK.find((t) => t.key === s.mascotTalk)?.line}</Text>
              <Text style={[T.caption, { marginTop: 4 }]}>During Deep Work it studies with you and says nothing until the session ends.</Text>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Getting along</SectionTitle>
              <Card>
                {[
                  ['hand-left-outline', 'Tap it for a reaction. Tap a lot and see.'],
                  ['chatbubble-ellipses-outline', 'Hold it to talk to it, or to tuck it away until tomorrow.'],
                  ['move-outline', 'Drag it to another spot if it is ever in the way.'],
                ].map(([icon, line]) => (
                  <View key={line} style={st.tip}>
                    <Ionicons name={icon as any} size={17} color={C.textDim} style={{ marginRight: 10, marginTop: 1 }} />
                    <Text style={[T.caption, { flex: 1 }]}>{line}</Text>
                  </View>
                ))}
              </Card>
            </Enter>
          </>
        ) : null}
      </Animated.ScrollView>
    </ScreenBG>
  );
}

type Demo = 'wave' | 'think' | 'cheer' | 'read' | 'hop';

/** The preview's own little performances, and its breathing and blinking. */
function usePreview() {
  const [pose, setPoseState] = React.useState<Pose>(REST);
  const [bud, setBud] = React.useState(1);
  const ref = React.useRef(REST);
  const setPose = (p: Partial<Pose>) => { ref.current = { ...ref.current, ...p }; setPoseState(ref.current); };
  const token = React.useRef(0);
  const lift = useSharedValue(0);
  const tilt = useSharedValue(0);
  const breath = useSharedValue(0);
  React.useEffect(() => {
    breath.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.sin) }), -1, true);
    const iv = setInterval(() => {
      if (ref.current.eyes !== 'open') return;
      setPose({ eyes: 'blink' });
      setTimeout(() => { if (ref.current.eyes === 'blink') setPose({ eyes: 'open' }); }, 130);
    }, 3400);
    const t = setTimeout(() => play('wave'), 500);
    return () => { clearInterval(iv); clearTimeout(t); token.current++; };
  }, []);
  const play = (d: Demo) => {
    const my = ++token.current;
    const wait = (ms: number) => new Promise<boolean>((r) => setTimeout(() => r(token.current === my), ms));
    const run = async () => {
      setPose(REST);
      tilt.value = withTiming(0, { duration: 120 });
      if (d === 'hop') {
        setPose({ eyes: 'happy', feet: 'tuck' });
        lift.value = withSequence(withTiming(22, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }));
        if (!(await wait(420))) return;
      } else if (d === 'wave') {
        setPose({ eyes: 'happy', mouth: 'smile', r: 'out' });
        tilt.value = withTiming(5, { duration: 160 });
        if (!(await wait(110))) return;
        for (let i = 0; i < 4; i++) {
          setPose({ r: 'up' }); if (!(await wait(150))) return;
          setPose({ r: 'swing' }); if (!(await wait(150))) return;
        }
        setPose({ r: 'out' }); if (!(await wait(110))) return;
      } else if (d === 'think') {
        setPose({ eyes: 'up', mouth: 'flat', l: 'up' });
        tilt.value = withTiming(-6, { duration: 400 });
        if (!(await wait(1400))) return;
        setPose({ eyes: 'left' }); if (!(await wait(600))) return;
        setPose({ eyes: 'wide', mouth: 'o', l: 'rest' });
        tilt.value = withTiming(0, { duration: 160 });
        lift.value = withSequence(withTiming(10, { duration: 150 }), withTiming(0, { duration: 170 }));
        if (!(await wait(450))) return;
        setPose({ eyes: 'happy', mouth: 'smile' }); if (!(await wait(800))) return;
      } else if (d === 'cheer') {
        setPose({ eyes: 'happy', mouth: 'grin', l: 'up', r: 'up' });
        for (let i = 0; i < 3; i++) {
          setPose({ feet: 'tuck', l: i % 2 ? 'swing' : 'up', r: i % 2 ? 'up' : 'swing' });
          lift.value = withSequence(withTiming(20, { duration: 200, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 200, easing: Easing.in(Easing.quad) }));
          if (!(await wait(420))) return;
          setPose({ feet: 'stand' });
        }
        setBud(3);
        if (!(await wait(900))) return;
        setBud(1);
      } else {
        setPose({ eyes: 'focus' }); if (!(await wait(400))) return;
        setPose({ book: 'open', eyes: 'read', phones: true });
        if (!(await wait(1600))) return;
        setPose({ book: 'turn' }); if (!(await wait(260))) return;
        setPose({ book: 'open' }); if (!(await wait(1500))) return;
      }
      setPose(REST);
      tilt.value = withTiming(0, { duration: 200 });
    };
    void run();
  };
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -lift.value }, { rotate: tilt.value + 'deg' }, { scaleY: 1 + 0.025 * breath.value }] as const,
  }));
  return { pose, bud, play, style };
}

const st = StyleSheet.create({
  stage: { alignItems: 'center', paddingTop: 34, paddingBottom: 14, marginBottom: 6, borderRadius: S.radius, backgroundColor: 'rgba(255,248,238,0.06)' },
  stageName: { fontFamily: CUTE_BOLD, fontSize: 17, color: C.text, marginTop: 6 },
  tries: { flexDirection: 'row', gap: 8, marginTop: 12 },
  try: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,248,238,0.1)' },
  tryText: { fontFamily: CUTE, fontSize: 13, color: C.text },
  bug: { position: 'absolute', top: 30, left: '50%', marginLeft: 30 },
  fly: { position: 'absolute', top: 40, left: '50%', marginLeft: -70 },
  flyHalo: { position: 'absolute', left: -7, top: -7, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFE68A', opacity: 0.35 },
  flyDot: { width: 6, height: 6, backgroundColor: '#FFF2B0' },
  balloon: { position: 'absolute', top: 6, left: '50%', marginLeft: 50, alignItems: 'center' },
  who: { flex: 1, padding: 14, borderRadius: S.radius, borderWidth: 1.5, alignItems: 'flex-start' },
  name: { fontFamily: CUTE_BOLD, fontSize: 18, paddingVertical: 4 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 76, alignItems: 'center', paddingVertical: 10, borderRadius: S.radiusSm, borderWidth: 1.5 },
  gearRow: { flexDirection: 'row', alignItems: 'center', padding: S.cardPad },
  tip: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
});
