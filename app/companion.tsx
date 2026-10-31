import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T } from '../src/theme';
import { MascotLook, useStore } from '../src/store';
import { ScreenBG, SectionTitle, useToolHeader } from '../src/components/UI';
import { Enter } from '../src/components/Motion';
import { READ_MAX, frame } from '../src/layout';
import { CUTE, CUTE_BOLD, GridArt, Sprite } from '../src/components/Mascot';
import { COLOR_SETS, FLIERS, Kind, NAMES, PROPS, Pose, REST, colorSet, gearFor } from '../src/mascot/art';
import { startMakeover } from '../src/components/Makeover';
import { tick } from '../src/haptics';
import { fmtClockTime } from '../src/utils';

const TALK: { key: 'often' | 'some' | 'asked'; label: string; line: string }[] = [
  { key: 'often', label: 'Chatty', line: 'Up to six little lines a day, twenty minutes apart at least.' },
  { key: 'some', label: 'Now and then', line: 'Two or three a day, never close together.' },
  { key: 'asked', label: 'Only when tapped', line: 'Never by itself. Still waves, cheers and studies along.' },
];

const BLURB: Record<Kind, string> = {
  sprout: 'A little plant who waves with its leaves, waters itself, and opens a bud as your day gets done.',
  pip: 'A soft, round friend with nub arms who bounces, hums along, and keeps a balloon.',
};

/** a warm card, Cheerful's own: a soft fill and rim, no carved shadows */
const CARD = { backgroundColor: 'rgba(255,244,230,0.06)', borderWidth: 1, borderColor: 'rgba(255,244,230,0.08)', borderRadius: 20 };
const PICKED = { borderColor: C.accent, backgroundColor: 'rgba(255,244,230,0.1)' };

/**
 * The companion's page: who it is (Sprout or Pip, or none), its name, its colours, what it keeps, and how much it talks,
 * each companion's look kept on its own. A live stage at the top shows every choice as it is made, and can be asked to
 * wave, think, cheer or study.
 */
export default function CompanionPage() {
  const insets = useSafeAreaInsets();
  const s = useStore((st) => st.settings);
  const setSetting = useStore((st) => st.setSetting);
  const tool = useToolHeader({ title: 'Companion', mode: 'page' });
  const kind: Kind = s.mascot === 'pip' ? 'pip' : 'sprout';
  const off = s.mascot === 'off';
  const name = s.mascotName || NAMES[kind];
  const look = s.mascotLooks[kind];
  const set = colorSet(kind, look.colors);
  const gear = look.gear.filter((g) => gearFor(kind).some((x) => x.key === g));
  const [nameDraft, setNameDraft] = React.useState(s.mascotName);
  const preview = usePreview();

  const setLook = (patch: Partial<MascotLook>) => setSetting('mascotLooks', { ...s.mascotLooks, [kind]: { ...look, ...patch } });
  const choose = (k: Kind | 'off') => {
    if (k === s.mascot) return;
    tick();
    setSetting('mascot', k);
    if (k !== 'off') preview.play('wave');
  };
  const toggleGear = (k: string) => {
    tick();
    const on = gear.includes(k);
    let next = on ? gear.filter((g) => g !== k) : [...gear, k];
    // one friend flying about at a time
    if (!on && FLIERS.includes(k)) next = next.filter((g) => g === k || !FLIERS.includes(g));
    setLook({ gear: next });
    if (!on) preview.play(k === 'glasses' || k === 'phones' ? 'read' : 'cheer');
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
            <View style={[CARD, st.note]}>
              <Text style={T.body}>Your companion lives in Cheerful.</Text>
              <Pressable onPress={() => startMakeover('cheerful')} accessibilityRole="button" style={{ marginTop: 8 }}>
                <Text style={[T.body, { color: C.accent, fontFamily: F.semi }]}>Switch to Cheerful</Text>
              </Pressable>
            </View>
          ) : (s.mascotOut || s.mascotHideUntil > Date.now()) && !off ? (
            <View style={[CARD, st.note]}>
              <Text style={T.body}>
                {s.mascotOut
                  ? name + ' is out for a walk. Knock on the little door at the right edge of the screen, or:'
                  : (() => {
                    const d = new Date(s.mascotHideUntil);
                    return name + ' is hiding until ' + fmtClockTime(d.getHours() * 60 + d.getMinutes(), s.hour24) + '. Or:';
                  })()}
              </Text>
              <Pressable onPress={() => { setSetting('mascotOut', false); setSetting('mascotHideUntil', 0); }} accessibilityRole="button" style={{ marginTop: 8 }}>
                <Text style={[T.body, { color: C.accent, fontFamily: F.semi }]}>Call {name} back</Text>
              </Pressable>
            </View>
          ) : null}
          {!off ? (
            <View style={[CARD, st.stage]}>
              <View style={{ alignItems: 'center', justifyContent: 'flex-end', height: 140 }}>
                {kind === 'pip' && gear.includes('balloon') ? (
                  <View style={st.balloon}>
                    <GridArt grid={PROPS.balloon.grid} pal={{ a: set.pal.a, A: set.pal.A, h: '#FFFFFF' }} px={5} />
                    <View style={{ width: 1.5, height: 30, backgroundColor: 'rgba(160,150,140,0.7)' }} />
                  </View>
                ) : null}
                {gear.includes('ladybug') ? <View style={st.bug}><GridArt grid={PROPS.ladybug.grid} pal={PROPS.ladybug.pal} px={4} /></View> : null}
                {gear.includes('firefly') ? <View style={st.fly}><View style={st.flyHalo} /><View style={st.flyDot} /></View> : null}
                <Animated.View style={preview.style}>
                  <Sprite kind={kind} pose={preview.pose} gear={gear} bud={preview.bud} pal={set.pal} px={6} />
                </Animated.View>
              </View>
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
                  style={({ pressed }) => [CARD, st.who, on && PICKED, pressed && !on && { transform: [{ scale: 0.98 }] }]}
                >
                  <Sprite kind={k} pose={REST} gear={s.mascotLooks[k].gear} bud={2} pal={colorSet(k, s.mascotLooks[k].colors).pal} px={3} />
                  <Text style={[st.whoName, on && { color: C.accent }]}>{NAMES[k]}</Text>
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
              <View style={[CARD, { paddingHorizontal: 16, paddingVertical: 10 }]}>
                <TextInput
                  value={nameDraft} onChangeText={setNameDraft} onBlur={saveName} onSubmitEditing={saveName}
                  placeholder={NAMES[kind]} placeholderTextColor={C.textFaint} maxLength={16} returnKeyType="done"
                  style={[st.name, { color: C.text }]} accessibilityLabel="Your companion's name"
                />
              </View>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Colours</SectionTitle>
              <View style={st.grid}>
                {COLOR_SETS[kind].map((c) => {
                  const on = c.key === set.key;
                  return (
                    <Pressable
                      key={c.key} onPress={() => { tick(); setLook({ colors: c.key }); preview.play('hop'); }}
                      accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={c.name}
                      style={({ pressed }) => [CARD, st.swatch, on && PICKED, pressed && { opacity: 0.8 }]}
                    >
                      <Sprite kind={kind} pose={REST} gear={[]} bud={2} pal={c.pal} px={2.5} />
                      <Text style={[st.tileName, on && { color: C.accent }]}>{c.name}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Keeps with it</SectionTitle>
              <View style={st.grid}>
                {gearFor(kind).map((g) => {
                  const on = gear.includes(g.key);
                  // the tile shows it wearing just this, in the pose that shows it best
                  const showPose: Pose = g.key === 'phones' ? { ...REST, phones: true, eyes: 'happy' } : g.key === 'glasses' ? { ...REST, eyes: 'open' } : REST;
                  return (
                    <Pressable
                      key={g.key} onPress={() => toggleGear(g.key)}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={g.name + '. ' + g.line}
                      style={({ pressed }) => [CARD, st.gearTile, on && PICKED, pressed && { opacity: 0.85 }]}
                    >
                      <View style={st.gearArt}>
                        <Sprite kind={kind} pose={showPose} gear={[g.key]} bud={3} pal={set.pal} px={3} />
                        {g.key === 'ladybug' ? <View style={{ position: 'absolute', right: 6, top: 4 }}><GridArt grid={PROPS.ladybug.grid} pal={PROPS.ladybug.pal} px={3} /></View> : null}
                        {g.key === 'firefly' ? <View style={{ position: 'absolute', left: 8, top: 6 }}><View style={st.flyHalo} /><View style={st.flyDot} /></View> : null}
                        {g.key === 'balloon' ? <View style={{ position: 'absolute', right: 2, top: -2 }}><GridArt grid={PROPS.balloon.grid} pal={{ a: set.pal.a, A: set.pal.A, h: '#FFFFFF' }} px={3} /></View> : null}
                        {on ? <View style={st.tick}><Ionicons name="checkmark" size={12} color="#1B1A18" /></View> : null}
                      </View>
                      <Text style={[st.tileName, on && { color: C.accent }]}>{g.name}</Text>
                      <Text style={st.gearLine} numberOfLines={3}>{g.line}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>How much it talks</SectionTitle>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {TALK.map((t) => {
                  const on = s.mascotTalk === t.key;
                  return (
                    <Pressable
                      key={t.key} onPress={() => { tick(); setSetting('mascotTalk', t.key); }}
                      accessibilityRole="radio" accessibilityState={{ selected: on }}
                      style={[st.pill, on && { backgroundColor: C.accent + '2E', borderColor: C.accent }]}
                    >
                      <Text style={[st.pillText, on && { color: C.accent }]}>{t.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[T.caption, { marginTop: 8 }]}>{TALK.find((t) => t.key === s.mascotTalk)?.line} During Deep Work it studies with you and keeps quiet.</Text>
            </Enter>

            <Enter index={enter++}>
              <SectionTitle>Getting along</SectionTitle>
              <View style={[CARD, { padding: 14 }]}>
                {[
                  ['hand-left-outline', 'It lives on the header of each screen, by the buttons. Tap it for a reaction, and sometimes a word about your day.'],
                  ['exit-outline', 'Hold it to send it off for a walk. It leaves by its door in the wall.'],
                  ['notifications-outline', 'Knock on the little door at the right edge to bring it back.'],
                ].map(([icon, line]) => (
                  <View key={line} style={st.tip}>
                    <Ionicons name={icon as any} size={17} color={C.textDim} style={{ marginRight: 10, marginTop: 1 }} />
                    <Text style={[T.caption, { flex: 1 }]}>{line}</Text>
                  </View>
                ))}
              </View>
            </Enter>
          </>
        ) : null}
      </Animated.ScrollView>
    </ScreenBG>
  );
}

type Demo = 'wave' | 'think' | 'cheer' | 'read' | 'hop';

/** The stage's own little performances, and its breathing and blinking. */
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
  note: { padding: 16, marginBottom: 14 },
  stage: { alignItems: 'center', paddingTop: 10, paddingBottom: 16, marginBottom: 6 },
  stageName: { fontFamily: CUTE_BOLD, fontSize: 18, color: C.text, marginTop: 8 },
  tries: { flexDirection: 'row', gap: 8, marginTop: 12 },
  try: { paddingHorizontal: 13, paddingVertical: 6, borderRadius: 999, backgroundColor: 'rgba(255,244,230,0.08)' },
  tryText: { fontFamily: CUTE, fontSize: 13, color: C.text },
  bug: { position: 'absolute', top: 18, left: '50%', marginLeft: 44 },
  fly: { position: 'absolute', top: 30, left: '50%', marginLeft: -70 },
  flyHalo: { position: 'absolute', left: -7, top: -7, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFE68A', opacity: 0.35 },
  flyDot: { width: 6, height: 6, backgroundColor: '#FFF2B0' },
  balloon: { position: 'absolute', top: 0, left: '50%', marginLeft: -84, alignItems: 'center' },
  who: { flex: 1, padding: 14, alignItems: 'flex-start' },
  whoName: { fontFamily: CUTE_BOLD, fontSize: 16, color: C.text, marginTop: 8 },
  name: { fontFamily: CUTE_BOLD, fontSize: 18, paddingVertical: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 78, alignItems: 'center', paddingVertical: 10 },
  tileName: { fontFamily: CUTE_BOLD, fontSize: 13, color: C.text, marginTop: 6 },
  gearTile: { width: '47.5%', padding: 12, alignItems: 'center' },
  gearArt: { width: '100%', height: 64, alignItems: 'center', justifyContent: 'center' },
  gearLine: { fontFamily: CUTE, fontSize: 12, lineHeight: 16, color: C.textDim, textAlign: 'center', marginTop: 3 },
  tick: { position: 'absolute', right: 0, top: 0, width: 20, height: 20, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,244,230,0.1)', backgroundColor: 'rgba(255,244,230,0.05)' },
  pillText: { fontFamily: CUTE_BOLD, fontSize: 13, color: C.text },
  tip: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 5 },
});
