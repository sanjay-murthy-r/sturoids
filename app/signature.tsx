import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, TRACK, neuRaised } from '../src/theme';
import { useStore } from '../src/store';
import type { OwnSignature } from '../src/store';
import { SIG_SPEED } from '../src/signature';
import type { SigModel } from '../src/signature';
import type { HandDatePlace } from '../src/handDate';
import {
  DIGIT_H, DIGIT_KEYS, buildDigits, buildSigModel, clampPlace, dateDigits, defaultPlace, fitDate, signatureProblem,
} from '../src/sigModel';
import type { DigitMap, Hand } from '../src/sigModel';
import { Card, Chip, ListCard, ListRow, ScreenBG, SectionTitle, useTheme, useToolHeader } from '../src/components/UI';
import { Appear, Bouncy, Enter, useAnimLevel } from '../src/components/Motion';
import { SignaturePad } from '../src/components/SignaturePad';
import type { PadStroke } from '../src/components/SignaturePad';
import { DATE_SPEED, Signature, inkExtent, layoutDate } from '../src/components/Signature';
import { toast } from '../src/components/Toast';
import { tick } from '../src/haptics';
import { columnWidth } from '../src/layout';
import { fmtShortDate, todayKey } from '../src/utils';

/* ------------------------------------------------------------------ sizes and words */

/** the signing pad: the content's full width, 16:10, and never taller than this share of the window */
const PAD_RATIO = 10 / 16;
const PAD_MAX_H = 0.42;
/** a digit's pad: the cap line and the baseline, px from its top, and its size */
const DIGIT_PAD_W = 300;
const DIGIT_PAD_H = 210;
const CAP_Y = 36;
const BASE_Y = 172;
/** the preview: the signature's slot as a share of the content's width, and the frame's tallest */
const STAGE_SHARE = 0.72;
const STAGE_MAX_W = 320;
const STAGE_MAX_H = 260;
/** as the intro: the pen lifts before the date, and the finished writing is held before it sinks into the carve */
const DATE_LIFT = 160;
const HOLD = 520;
const SINK_MS = 700;
const SHINE_MS = 2000;
/** the steppers' ranges and steps; a placement from elsewhere outside them is kept as it is until it is stepped */
const SIZE = { min: 30, max: 120, step: 6 };
const GAP = { min: 0, max: 0.6, step: 0.05 };
const TILT = { min: -30, max: 30, step: 2 };
/** the creator's digit size, which a size reads against */
const BASE_SIZE = 54;

const PROBLEMS = {
  empty: 'Sign in the pad first.',
  dots: 'That reads as dots. Write at least one line.',
  small: 'That is very small. Sign across more of the pad.',
} as const;

type DigitDraft = Record<string, { strokes: PadStroke[] }>;
const GROUPS = ['dd', 'mm', 'yy'] as const;

const recordedOn = (at: number) => fmtShortDate(todayKey(new Date(at)));
const filled = (d: DigitDraft) => DIGIT_KEYS.filter((k) => (d[k]?.strokes.length ?? 0) > 0).length;
const firstMissing = (d: DigitDraft, after = -1): string | null => {
  for (let i = 1; i <= DIGIT_KEYS.length; i++) {
    const k = DIGIT_KEYS[(after + i + DIGIT_KEYS.length) % DIGIT_KEYS.length];
    if (!(d[k]?.strokes.length)) return k;
  }
  return null;
};
const clampTo = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));
/** a stepped value without the float's dust (0.30000000000000004) */
const stepped = (v: number, step: number) => Math.round(v / step) * step;
const signed = (n: number) => (n < 0 ? '−' + Math.abs(n) : String(n));

/* ------------------------------------------------------------------ the page */

/**
 * Your signature: which one the start screen writes, a pad to record your own, a preview that plays it the way the
 * intro will, and, folded away, your own digits and where today's date goes after it. Nothing is saved while you
 * write: Save stores the signature, its digits and their placement together.
 */
export default function SignaturePage() {
  useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const own = useStore((s) => s.settings.ownSignature);
  const source = useStore((s) => s.settings.signatureSource);
  const setSetting = useStore((s) => s.setSetting);

  const contentW = columnWidth(winW, false) - 2 * S.pad;
  const padW = Math.floor(contentW);
  const padH = Math.floor(Math.min(padW * PAD_RATIO, winH * PAD_MAX_H));

  const [strokes, setStrokes] = useState<PadStroke[]>([]);
  const [digits, setDigits] = useState<DigitDraft>(() => (own?.digits ? { ...own.digits } : {}));
  /** null: the date goes where it is placed automatically */
  const [place, setPlace] = useState<HandDatePlace | null>(() => (own?.digits && own.date ? clampPlace(own.date) : null));
  /** digits or the placement changed since the last save */
  const [edited, setEdited] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** each Play counts up and replays the preview; 0 is no play since the last change */
  const [played, setPlayed] = useState(0);
  const [dateOpen, setDateOpen] = useState(false);

  const yours = !!own && source === 'own';
  const working = strokes.length ? strokes : own?.strokes ?? null;
  const model = useMemo(() => (working ? buildSigModel({ strokes: working }) : null), [working]);
  const complete = filled(digits) === DIGIT_KEYS.length;
  const digitModel = useMemo(() => (complete ? buildDigits(digits) : null), [digits, complete]);
  const autoPlace = useMemo(() => (model && digitModel ? defaultPlace(model, digitModel) : null), [model, digitModel]);
  const activePlace = place ?? autoPlace;
  const stageShown = !!model && (played > 0 || (!strokes.length && !!own));
  const today = dateDigits();
  // the room the date makes is worked out only while something shows it
  const hand: Hand | null = useMemo(() => {
    if (!model || !digitModel || !activePlace || !(stageShown || dateOpen)) return null;
    return { digits: digitModel, place: activePlace, fit: fitDate(model, digitModel, activePlace, today) };
  }, [model, digitModel, activePlace, stageShown, dateOpen, today]);
  const dirty = strokes.length > 0 || edited;

  const onStroke = useCallback((s: PadStroke) => {
    setStrokes((prev) => [...prev, s]);
    setProblem(null);
    setPlayed(0);
  }, []);
  const undo = () => { setStrokes((prev) => prev.slice(0, -1)); setPlayed(0); setProblem(null); };
  const clear = () => { setStrokes([]); setPlayed(0); setProblem(null); };
  const play = () => {
    if (strokes.length) {
      const p = signatureProblem({ strokes });
      if (p === 'empty' || p === 'dots') { setProblem(PROBLEMS[p]); return; }
    }
    if (!model) { setProblem(PROBLEMS.empty); return; }
    setProblem(null);
    setPlayed((n) => n + 1);
  };

  const save = () => {
    const base = strokes.length ? strokes : own?.strokes;
    if (!base) { setProblem(PROBLEMS.empty); return; }
    if (strokes.length) {
      const p = signatureProblem({ strokes });
      if (p) { setProblem(PROBLEMS[p]); return; }
    }
    if (!dirty && own) { toast('Nothing new to save'); return; }
    const value: OwnSignature = {
      v: 1,
      recordedAt: strokes.length || !own ? Date.now() : own.recordedAt,
      strokes: base.map((s) => ({ pts: s.pts.map((p) => [p[0], p[1], p[2]] as [number, number, number]) })),
    };
    if (complete) {
      value.digits = digits;
      if (place) value.date = place;
    }
    setSetting('ownSignature', value);
    setSetting('signatureSource', 'own');
    setStrokes([]);
    setEdited(false);
    setProblem(null);
    setPlayed(0);
    toast(complete || !filled(digits) ? 'Signature saved' : 'Your signature is saved. The date needs all ten digits.');
  };

  const removeMine = () => {
    Alert.alert('Remove your signature?', 'The start screen goes back to the original, and your digits go with it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: () => {
          setSetting('signatureSource', 'creator');
          setSetting('ownSignature', null);
          setStrokes([]);
          setDigits({});
          setPlace(null);
          setEdited(false);
          setPlayed(0);
          toast('Signature removed');
        },
      },
    ]);
  };

  const pick = (to: 'creator' | 'own') => {
    if (to === 'own' && !own) return;
    tick();
    setSetting('signatureSource', to);
  };

  const onDigits = useCallback((next: (d: DigitDraft) => DigitDraft) => { setDigits(next); setEdited(true); }, []);
  const onPlace = useCallback((next: HandDatePlace | null) => { setPlace(next); setEdited(true); }, []);

  const leaveRef = useRef(() => {});
  leaveRef.current = () => {
    if (!dirty) { router.back(); return; }
    Alert.alert('Discard your changes?', 'What you recorded here is not saved.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };
  useFocusEffect(useCallback(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { leaveRef.current(); return true; });
    return () => sub.remove();
  }, []));

  const header = useToolHeader({
    title: 'Your signature',
    mode: 'page',
    context: yours ? 'Yours plays at launch' : 'The original plays at launch',
    actions: [{ icon: 'checkmark', label: 'Save', color: dirty ? C.accent : undefined, onPress: save }],
    onBack: () => leaveRef.current(),
  });

  return (
    <ScreenBG>
      {header.bar}
      <Animated.ScrollView
        {...header.scrollProps}
        contentContainerStyle={{ padding: S.pad, paddingTop: header.padTop, paddingBottom: 40 + insets.bottom }}
        keyboardShouldPersistTaps="handled"
      >
        <Enter index={0}>
          {header.hero}
          <SectionTitle>At launch</SectionTitle>
          <Card>
            <View style={st.choices} accessibilityRole="radiogroup">
              <Chip
                label="The original" active={!yours} onPress={() => pick('creator')}
                accessibilityRole="radio" accessibilityState={{ checked: !yours }}
              />
              {/* dimmed until there is one of yours to choose */}
              <View style={!own && st.unavailable}>
                <Chip
                  label="Yours" active={yours} onPress={own ? () => pick('own') : undefined}
                  accessibilityRole="radio" accessibilityState={{ checked: yours, disabled: !own }}
                />
              </View>
            </View>
            <Text style={[T.caption, { marginTop: 12 }]}>
              {own ? 'Yours was recorded on ' + recordedOn(own.recordedAt) + '.' : 'Record yours below and save it to choose it.'}
            </Text>
          </Card>
        </Enter>

        <Enter index={1}>
          <SectionTitle>{own ? 'Sign again' : 'Sign'}</SectionTitle>
          <SignaturePad
            width={padW} height={padH} unit={padW} strokes={strokes} onStroke={onStroke}
            guides={[Math.round(padH * 0.7)]} hint="Sign here" accessibilityLabel="Signature pad"
          />
          <View style={st.controls}>
            <PadButton icon="arrow-undo-outline" label="Undo last stroke" bare onPress={undo} disabled={!strokes.length} />
            <PadButton label="Clear" onPress={clear} disabled={!strokes.length} />
            <View style={{ flex: 1 }} />
            <PadButton icon="play" label="Play" onPress={play} disabled={!model} />
            <PadButton label="Save" onPress={save} disabled={!dirty} primary />
          </View>
          <Text style={[T.caption, problem ? { color: C.danger } : null]} accessibilityLiveRegion="polite">
            {problem ?? 'Write it as you sign. The start screen plays it back at your own pace.'}
          </Text>
        </Enter>

        {stageShown && model ? (
          <Appear>
            <SectionTitle>{strokes.length ? 'Preview' : 'Your saved signature'}</SectionTitle>
            <PreviewStage model={model} hand={hand} play={played} width={contentW} />
          </Appear>
        ) : null}

        <Enter index={2} style={{ marginTop: S.section }}>
          <DateSection
            model={model} digits={digits} onDigits={onDigits} digitModel={digitModel} hand={hand} explicit={place != null}
            onPlace={onPlace} open={dateOpen} onOpen={setDateOpen} width={contentW}
          />
        </Enter>

        {own ? (
          <Enter index={3}>
            <Bouncy onPress={removeMine} style={st.remove} radius={999} accessibilityLabel="Remove your signature">
              <Text style={st.removeText}>Remove mine</Text>
            </Bouncy>
          </Enter>
        ) : null}
      </Animated.ScrollView>
    </ScreenBG>
  );
}

/* ------------------------------------------------------------------ small parts */

/** A pad's control: a slightly raised pill that sinks on press, the save one in the accent; dimmed while it has nothing to do. */
function PadButton({ label, icon, bare, onPress, disabled, primary }: {
  label: string; icon?: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; disabled?: boolean; primary?: boolean;
  /** the icon alone; the label is what a screen reader says */
  bare?: boolean;
}) {
  const theme = useTheme();
  const c = primary ? C.accent : C.textDim;
  return (
    <Bouncy
      onPress={onPress} disabled={disabled} scaleTo={0.96} radius={999} accessibilityLabel={label}
      style={[
        st.padBtn,
        theme === 'minimal' ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: primary ? c + '77' : MIN.border } : { backgroundColor: C.card, ...neuRaised('low') },
        bare && st.padBtnBare,
        disabled && { opacity: 0.4 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={bare ? 16 : 14} color={c} style={bare ? null : { marginRight: 6 }} /> : null}
      {bare ? null : <Text style={[st.padBtnText, { color: c }]} maxFontSizeMultiplier={1.3}>{label}</Text>}
    </Bouncy>
  );
}

/**
 * The signature played the way the intro plays it, at preview size, with the real Signature: the pen at the recorded
 * pace, the date after it when there is one, then the sink into the carve and one shine. At rest it shows the carved
 * end state. Some motion fades the end state in; no motion simply shows it.
 */
const PreviewStage = React.memo(function PreviewStage({ model, hand, play, width }: {
  model: SigModel; hand: Hand | null; play: number; width: number;
}) {
  const level = useAnimLevel();
  const date = useMemo(() => dateDigits(), []);
  const late = hand?.place.when === 'outro';
  const dateTotal = hand ? layoutDate(date, hand).total : 0;
  // at rest every pen has finished: the carve shows the whole signature and date
  const tau = useSharedValue(1e9);
  const dateTau = useSharedValue(1e9);
  const travel = useSharedValue(1);
  const ink = useSharedValue(0);
  const carve = useSharedValue(1);
  const glint = useSharedValue(0);
  const fade = useSharedValue(1);

  useEffect(() => {
    if (!play) return undefined;
    const all = [tau, dateTau, ink, carve, glint, fade];
    all.forEach(cancelAnimation);
    const rest = () => { tau.value = 1e9; dateTau.value = 1e9; ink.value = 0; carve.value = 1; glint.value = 0; };
    if (level !== 'full') {
      rest();
      if (level === 'some') {
        fade.value = 0;
        fade.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
      }
      return () => all.forEach(cancelAnimation);
    }
    const inOut = Easing.inOut(Easing.cubic);
    fade.value = 1;
    tau.value = 0;
    dateTau.value = 0;
    ink.value = 1;
    carve.value = 0;
    glint.value = 0;
    const sigMs = model.total / SIG_SPEED;
    tau.value = withTiming(model.total, { duration: sigMs, easing: Easing.linear });
    let penDone = sigMs;
    if (hand && !late) {
      dateTau.value = withDelay(sigMs + DATE_LIFT, withTiming(dateTotal, { duration: dateTotal / DATE_SPEED, easing: Easing.linear }));
      penDone += DATE_LIFT + dateTotal / DATE_SPEED;
    }
    const sinkAt = penDone + HOLD;
    ink.value = withDelay(sinkAt, withTiming(0, { duration: SINK_MS, easing: inOut }));
    carve.value = withDelay(sinkAt, withTiming(1, { duration: SINK_MS, easing: inOut }));
    const shineAt = sinkAt + SINK_MS + 160;
    glint.value = withDelay(shineAt, withTiming(1, { duration: SHINE_MS, easing: Easing.inOut(Easing.sin) }));
    // a date written at the end is cut into the carve after the shine
    if (hand && late) {
      dateTau.value = withDelay(shineAt + SHINE_MS + DATE_LIFT, withTiming(dateTotal, {
        duration: dateTotal / DATE_SPEED, easing: Easing.linear,
      }));
    }
    return () => all.forEach(cancelAnimation);
  }, [play]);

  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const ext = inkExtent(model, hand);
  const k = Math.min(
    Math.min(width * STAGE_SHARE, STAGE_MAX_W) / model.vw, width / (ext[2] - ext[0]), STAGE_MAX_H / (ext[3] - ext[1]),
  );
  const frameW = (ext[2] - ext[0]) * k;
  const frameH = (ext[3] - ext[1]) * k;
  return (
    <Animated.View
      style={[st.stage, fadeStyle]}
      accessible accessibilityLabel={hand ? 'Preview of your signature and today\'s date' : 'Preview of your signature'}
    >
      <View style={{ width: frameW, height: frameH }}>
        <View style={{ position: 'absolute', left: -ext[0] * k, top: -ext[1] * k }}>
          <Signature
            width={model.vw * k} model={model} hand={hand} heroScale={1} heroX={0} heroY={0}
            tau={tau} date={date} dateTau={dateTau} dateLate={late} travel={travel} ink={ink} carve={carve} glint={glint}
          />
        </View>
      </View>
    </Animated.View>
  );
});

/* ------------------------------------------------------------------ today's date: digits and placement */

const DateSection = React.memo(function DateSection({
  model, digits, onDigits, digitModel, hand, explicit, onPlace, open, onOpen, width,
}: {
  model: SigModel | null; digits: DigitDraft; onDigits: (next: (d: DigitDraft) => DigitDraft) => void; digitModel: DigitMap | null;
  hand: Hand | null; explicit: boolean; onPlace: (p: HandDatePlace | null) => void;
  open: boolean; onOpen: (open: boolean) => void; width: number;
}) {
  const count = filled(digits);
  const [picked, setCurrent] = useState<string | null>(() => firstMissing(digits));
  // with digits still to write there is always one being written, even after they were cleared from elsewhere
  const current = picked ?? (count < DIGIT_KEYS.length ? firstMissing(digits) : null);
  const has = !!current && (digits[current]?.strokes.length ?? 0) > 0;
  const nextMissing = current ? firstMissing(digits, DIGIT_KEYS.indexOf(current as typeof DIGIT_KEYS[number])) : null;
  const summary = count === DIGIT_KEYS.length ? (digitModel ? 'On, in your own digits' : 'Your digits need writing again')
    : count ? count + ' of 10 digits written' : 'Optional';

  const addStroke = useCallback((s: PadStroke) => {
    if (!current) return;
    onDigits((d) => ({ ...d, [current]: { strokes: [...(d[current]?.strokes ?? []), s] } }));
  }, [current, onDigits]);
  const redo = () => {
    if (!current) return;
    onDigits((d) => ({ ...d, [current]: { strokes: [] } }));
  };
  const next = () => {
    tick();
    // the one after this that is still unwritten; with none left, the digits are done
    setCurrent(nextMissing && nextMissing !== current ? nextMissing : null);
  };
  const removeDate = () => {
    Alert.alert('Remove the date?', 'Your digits are cleared, and the start screen writes no date after your signature.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => { onDigits(() => ({})); onPlace(null); setCurrent('0'); } },
    ]);
  };

  const digitPadW = Math.min(width, DIGIT_PAD_W);
  return (
    <>
      <ListCard>
        <ListRow
          onPress={() => { tick(); onOpen(!open); }} style={st.foldRow}
          accessibilityLabel="Write today's date after it" accessibilityHint={(open ? 'Open. ' : '') + summary}
        >
          <Ionicons name="calendar-outline" size={21} color={C.textDim} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={[T.body, { fontFamily: F.med }]}>Write today's date after it</Text>
            <Text style={[T.caption, { marginTop: 1 }]} numberOfLines={1}>{summary}</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={17} color={C.textFaint} />
        </ListRow>
      </ListCard>

      {open ? (
        <Appear>
          <Text style={[T.caption, { marginTop: 4 }]}>
            Without your digits the start screen writes no date. Write each one between the lines, the way you write it in a date.
          </Text>
          <View style={st.cells}>
            {DIGIT_KEYS.map((k) => (
              <DigitCell
                key={k} digit={k} done={(digits[k]?.strokes.length ?? 0) > 0} current={k === current}
                onPress={() => { tick(); setCurrent(k); }}
              />
            ))}
          </View>

          {current ? (
            <View style={{ alignItems: 'center' }}>
              <Text style={[T.label, { alignSelf: 'stretch', marginBottom: 10 }]}>
                {'Write ' + current + ' between the lines'}
              </Text>
              <SignaturePad
                key={current} width={digitPadW} height={DIGIT_PAD_H} unit={BASE_Y - CAP_Y} originY={CAP_Y}
                guides={[BASE_Y]} dashed={[CAP_Y]} strokes={digits[current]?.strokes ?? []} onStroke={addStroke}
                maxPoints={400} accessibilityLabel={'Pad for the digit ' + current}
              />
              <View style={[st.controls, { alignSelf: 'stretch' }]}>
                <PadButton icon="refresh" label="Redo" onPress={redo} disabled={!has} />
                <View style={{ flex: 1 }} />
                <PadButton
                  label={nextMissing && nextMissing !== current ? 'Next' : 'Done'} onPress={next} disabled={!has} primary
                />
              </View>
            </View>
          ) : (
            <Text style={T.caption}>All ten are written. Tap a digit to write it again.</Text>
          )}

          {model && digitModel && hand ? (
            <>
              <SectionTitle>Place the date</SectionTitle>
              <Text style={[T.caption, { marginBottom: 14 }]}>
                Drag the day, the month or the year. Today is shown as the start screen will write it.
              </Text>
              <DatePlacer model={model} hand={hand} width={width} onPlace={onPlace} />
              <PlaceSteppers hand={hand} model={model} onPlace={onPlace} />
              {explicit ? (
                <Bouncy onPress={() => { tick(); onPlace(null); }} style={st.link} radius={999}>
                  <Text style={st.linkText}>Place it for me</Text>
                </Bouncy>
              ) : null}
            </>
          ) : count === DIGIT_KEYS.length && !model ? (
            <Text style={[T.caption, { marginTop: 14 }]}>Record your signature to place the date after it.</Text>
          ) : null}

          {count ? (
            <Bouncy onPress={removeDate} style={st.link} radius={999}>
              <Text style={[st.linkText, { color: C.danger }]}>Remove the date</Text>
            </Bouncy>
          ) : null}
        </Appear>
      ) : null}
    </>
  );
});

/** One digit's place in the row: flat, tinted once it is written, ringed while it is the one being written. */
function DigitCell({ digit, done, current, onPress }: { digit: string; done: boolean; current: boolean; onPress: () => void }) {
  const c = C.accent;
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.9} radius={999} hitSlop={4}
      accessibilityLabel={'Digit ' + digit + (done ? ', written' : '')} accessibilityState={{ selected: current }}
      style={[
        st.cell,
        { borderColor: current ? c : done ? c + '55' : C.outline, backgroundColor: done ? c + '1F' : 'transparent' },
      ]}
    >
      <Text style={[st.cellText, { color: done || current ? c : C.textFaint }]} maxFontSizeMultiplier={1.3}>{digit}</Text>
    </Bouncy>
  );
}

/* ------------------------------------------------------------------ placing the date */

const PLACER_MAX_H = 300;
/** how far past a group's ink a touch still picks it up, px */
const GRAB_SLOP = 14;
const ZERO = { x: 0, y: 0 };

/** How wide a group is written today, signature units: its two digits with the room it makes. */
function groupWidthToday(hand: Hand, group: (typeof GROUPS)[number], pair: string): number {
  const { place } = hand;
  const fit = hand.fit[group][pair];
  const scale = (place.size / DIGIT_H) * (fit?.scale ?? 1);
  const gap = fit?.gap ?? place.gap;
  const a = hand.digits[pair[0]];
  const b = hand.digits[pair[1]];
  if (!a || !b) return 0;
  return (Math.max(14, a.x1 - a.x0) + gap * DIGIT_H + Math.max(14, b.x1 - b.x0)) * scale;
}

/** The room the date may be dragged in, signature units: around the signature, with space below it. */
function placeRegion(model: SigModel, hand: Hand): [number, number, number, number] {
  const ext = inkExtent(model, hand);
  return [
    Math.min(-0.1 * model.vw, ext[0] - 20),
    Math.min(-Math.max(0.12 * model.vh, 40), ext[1] - 20),
    Math.max(1.1 * model.vw, ext[2] + 20),
    Math.max(model.vh + Math.max(0.35 * model.vh, 170), ext[3] + 20),
  ];
}

/**
 * The signature with today's date on it, its day, month and year each draggable. A group moves on the UI thread as it
 * is dragged; the new place is handed over once, when it is let go. A touch that lands on no group is left to the page,
 * so the page still scrolls from here.
 */
const DatePlacer = React.memo(function DatePlacer({ model, hand, width, onPlace }: {
  model: SigModel; hand: Hand; width: number; onPlace: (p: HandDatePlace) => void;
}) {
  const today = useMemo(() => dateDigits(), []);
  const { place } = hand;
  // worked out for this signature, so the frame never shifts under a drag
  const region = useMemo(() => placeRegion(model, hand), [model]);
  const [rx0, ry0, rx1, ry1] = region;
  const k = Math.min(width / (rx1 - rx0), PLACER_MAX_H / (ry1 - ry0));
  const cw = (rx1 - rx0) * k;
  const ch = (ry1 - ry0) * k;
  const widths = GROUPS.map((g, gi) => groupWidthToday(hand, g, today.slice(gi * 2, gi * 2 + 2)));
  const top = 1.15 * place.size;
  const foot = 0.25 * place.size;
  // each group is drawn in a square of its own centred on its anchor, big enough to turn in
  const half = Math.hypot(Math.max(...widths, place.size), top + foot) + GRAB_SLOP / k;
  const side = 2 * half * k;
  const local: Hand = useMemo(() => ({ ...hand, place: { ...hand.place, groups: { dd: ZERO, mm: ZERO, yy: ZERO } } }), [hand]);
  const laid = useMemo(() => layoutDate(today, local), [local, today]);
  const lineW = 1.7 / k;

  const anchors = useSharedValue([place.groups.dd.x, place.groups.dd.y, place.groups.mm.x, place.groups.mm.y, place.groups.yy.x, place.groups.yy.y]);
  const active = useSharedValue(-1);
  const pointer = useSharedValue(-1);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  useEffect(() => {
    if (active.value !== -1) return;
    anchors.value = [place.groups.dd.x, place.groups.dd.y, place.groups.mm.x, place.groups.mm.y, place.groups.yy.x, place.groups.yy.y];
  }, [place]);

  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const placeRef = useRef(place);
  placeRef.current = place;
  const dropped = (gi: number, x: number, y: number) => {
    const p = placeRef.current;
    const g = GROUPS[gi];
    onPlaceRef.current({ ...p, groups: { ...p.groups, [g]: { x, y } } });
  };

  const gesture = useMemo(() => {
    const rad = (place.tilt * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const slop = GRAB_SLOP / k;
    const ws = widths.slice();
    const drop = () => {
      'worklet';
      const gi = active.value;
      const a = anchors.value.slice();
      a[gi * 2] = Math.round(a[gi * 2] + dx.value / k);
      a[gi * 2 + 1] = Math.round(a[gi * 2 + 1] + dy.value / k);
      anchors.value = a;
      dx.value = 0;
      dy.value = 0;
      active.value = -1;
      pointer.value = -1;
      runOnJS(dropped)(gi, a[gi * 2], a[gi * 2 + 1]);
    };
    return Gesture.Manual()
      .onTouchesDown((e, manager) => {
        'worklet';
        if (pointer.value !== -1) return;
        const t = e.changedTouches[0];
        if (!t) return;
        const px = t.x / k + rx0;
        const py = t.y / k + ry0;
        let hit = -1;
        // the last drawn is on top
        for (let gi = 2; gi >= 0 && hit < 0; gi--) {
          const ox = px - anchors.value[gi * 2];
          const oy = py - anchors.value[gi * 2 + 1];
          const lx = ox * cos + oy * sin;
          const ly = -ox * sin + oy * cos;
          if (lx >= -slop && lx <= ws[gi] + slop && ly >= -top - slop && ly <= foot + slop) hit = gi;
        }
        if (hit < 0) {
          manager.fail();
          return;
        }
        pointer.value = t.id;
        active.value = hit;
        sx.value = t.x;
        sy.value = t.y;
        dx.value = 0;
        dy.value = 0;
        manager.activate();
        runOnJS(tick)();
      })
      .onTouchesMove((e) => {
        'worklet';
        if (pointer.value === -1) return;
        for (const c of e.allTouches) {
          if (c.id !== pointer.value) continue;
          const gi = active.value;
          const ax = anchors.value[gi * 2];
          const ay = anchors.value[gi * 2 + 1];
          // the group stays inside the frame
          const nx = Math.min(rx1 - ws[gi], Math.max(rx0, ax + (c.x - sx.value) / k));
          const ny = Math.min(ry1 - foot, Math.max(ry0 + top, ay + (c.y - sy.value) / k));
          dx.value = (nx - ax) * k;
          dy.value = (ny - ay) * k;
        }
      })
      .onTouchesUp((e, manager) => {
        'worklet';
        let mine = false;
        for (const c of e.changedTouches) {
          if (c.id === pointer.value) mine = true;
        }
        if (!mine) return;
        drop();
        manager.end();
      })
      .onTouchesCancelled((_e, manager) => {
        'worklet';
        if (pointer.value !== -1) drop();
        manager.end();
      })
      .onFinalize(() => {
        'worklet';
        if (pointer.value !== -1) drop();
      });
  }, [k, rx0, ry0, rx1, ry1, place.tilt, top, foot, widths.join(',')]);

  return (
    <View style={[st.placer, { width: cw, height: ch }]} accessible accessibilityLabel="Where today's date goes. Drag the day, the month or the year.">
      <Svg width={cw} height={ch} viewBox={`${rx0} ${ry0} ${rx1 - rx0} ${ry1 - ry0}`} style={StyleSheet.absoluteFill}>
        {model.strokes.map((s, i) => (s.type === 'line' ? (
          <Path key={i} d={s.d} fill="none" stroke={C.textDim} strokeWidth={lineW} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <Circle key={i} cx={s.cx} cy={s.cy} r={lineW} fill={C.textDim} />
        )))}
      </Svg>
      {GROUPS.map((g, gi) => (
        <PlacedGroup
          key={g} index={gi} hand={hand} laid={laid.digits.filter((p) => p.key.startsWith(g))} side={side} k={k}
          lineW={lineW} rx0={rx0} ry0={ry0} anchors={anchors} active={active} dx={dx} dy={dy}
        />
      ))}
      <GestureDetector gesture={gesture}>
        <View style={StyleSheet.absoluteFill} collapsable={false} />
      </GestureDetector>
    </View>
  );
});

type Laid = ReturnType<typeof layoutDate>['digits'];

/** One group of the date in its own square, centred on its anchor and moved there by transform. */
function PlacedGroup({ index, hand, laid, side, k, lineW, rx0, ry0, anchors, active, dx, dy }: {
  index: number; hand: Hand; laid: Laid; side: number; k: number; lineW: number; rx0: number; ry0: number;
  anchors: { value: number[] }; active: { value: number }; dx: { value: number }; dy: { value: number };
}) {
  const half = side / 2;
  const style = useAnimatedStyle(() => {
    const on = active.value === index;
    return {
      transform: [
        { translateX: (anchors.value[index * 2] - rx0) * k - half + (on ? dx.value : 0) },
        { translateY: (anchors.value[index * 2 + 1] - ry0) * k - half + (on ? dy.value : 0) },
      ] as const,
    };
  });
  const u = half / k;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: side, height: side }, style]}>
      <Svg width={side} height={side} viewBox={`${-u} ${-u} ${2 * u} ${2 * u}`}>
        {laid.map((p) => (
          <G key={p.key} transform={p.transform}>
            {hand.digits[p.ch].strokes.map((s, i) => (s.type === 'line' ? (
              <Path
                key={i} d={s.d} fill="none" stroke={C.text} strokeWidth={lineW / p.scale} strokeLinecap="round" strokeLinejoin="round"
              />
            ) : (
              <Circle key={i} cx={s.cx} cy={s.cy} r={lineW / p.scale} fill={C.text} />
            )))}
          </G>
        ))}
      </Svg>
    </Animated.View>
  );
}

/** Size, spacing and tilt, a step at a time: no sliders to fumble. */
function PlaceSteppers({ hand, model, onPlace }: { hand: Hand; model: SigModel; onPlace: (p: HandDatePlace) => void }) {
  const { place } = hand;
  const set = (patch: Partial<HandDatePlace>) => {
    const next = { ...place, ...patch };
    // a bigger date keeps its anchors, but never past the room it may be dragged in
    const [rx0, ry0, rx1, ry1] = placeRegion(model, hand);
    const at = (q: { x: number; y: number }) => ({
      x: Math.round(Math.min(rx1 - 20, Math.max(rx0, q.x))),
      y: Math.round(Math.min(ry1, Math.max(ry0 + 1.15 * next.size, q.y))),
    });
    onPlace({ ...next, groups: { dd: at(next.groups.dd), mm: at(next.groups.mm), yy: at(next.groups.yy) } });
  };
  return (
    <ListCard style={{ marginTop: S.gap }}>
      <Stepper
        label="Size" value={Math.round((place.size / BASE_SIZE) * 100) + '%'}
        onLess={place.size > SIZE.min ? () => set({ size: clampTo(stepped(place.size - SIZE.step, 1), SIZE) }) : undefined}
        onMore={place.size < SIZE.max ? () => set({ size: clampTo(stepped(place.size + SIZE.step, 1), SIZE) }) : undefined}
      />
      <Stepper
        label="Spacing" value={Math.round(place.gap * 100) + '%'}
        onLess={place.gap > GAP.min ? () => set({ gap: clampTo(stepped(place.gap - GAP.step, GAP.step), GAP) }) : undefined}
        onMore={place.gap < GAP.max ? () => set({ gap: clampTo(stepped(place.gap + GAP.step, GAP.step), GAP) }) : undefined}
      />
      <Stepper
        label="Tilt" value={signed(Math.round(place.tilt)) + '°'}
        onLess={place.tilt > TILT.min ? () => set({ tilt: clampTo(stepped(place.tilt - TILT.step, 1), TILT) }) : undefined}
        onMore={place.tilt < TILT.max ? () => set({ tilt: clampTo(stepped(place.tilt + TILT.step, 1), TILT) }) : undefined}
      />
    </ListCard>
  );
}

function Stepper({ label, value, onLess, onMore }: { label: string; value: string; onLess?: () => void; onMore?: () => void }) {
  return (
    <View style={st.stepRow} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') onMore?.();
        if (e.nativeEvent.actionName === 'decrement') onLess?.();
      }}
    >
      <Text style={[T.body, { flex: 1 }]} numberOfLines={1}>{label}</Text>
      <StepKey icon="remove" onPress={onLess} />
      <Text style={st.stepValue} maxFontSizeMultiplier={1.3}>{value}</Text>
      <StepKey icon="add" onPress={onMore} />
    </View>
  );
}

function StepKey({ icon, onPress }: { icon: 'add' | 'remove'; onPress?: () => void }) {
  return (
    <Bouncy
      onPress={onPress ? () => { tick(); onPress(); } : undefined} disabled={!onPress} scaleTo={0.88} radius={999} hitSlop={6}
      style={[st.stepKey, { borderColor: C.outline }, !onPress && { opacity: 0.35 }]}
    >
      <Ionicons name={icon} size={16} color={C.textDim} />
    </Bouncy>
  );
}

const st = StyleSheet.create({
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  unavailable: { opacity: 0.4 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: S.gap, marginBottom: 12 },
  padBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 9, paddingHorizontal: 14, borderRadius: 999, overflow: 'hidden',
  },
  padBtnText: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  padBtnBare: { width: 38, height: 38, paddingVertical: 0, paddingHorizontal: 0 },
  stage: { alignItems: 'center', paddingVertical: 8 },
  foldRow: { paddingVertical: 13 },
  cells: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: S.gap, marginBottom: 18 },
  cell: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  cellText: { fontFamily: F.semi, fontSize: 13 },
  placer: { alignSelf: 'center', overflow: 'hidden' },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 10 },
  stepKey: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepValue: { ...T.label, color: C.text, minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'] },
  link: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2, marginTop: 10 },
  linkText: { fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, color: C.accent },
  remove: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginTop: S.section },
  removeText: { fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, color: C.danger },
});
