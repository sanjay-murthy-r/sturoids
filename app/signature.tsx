import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing, cancelAnimation, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue, withDelay, withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, liteSh, neuInset, neuRaised, oneLine } from '../src/theme';
import { useStore } from '../src/store';
import type { OwnSignature } from '../src/store';
import { SIG_SPEED } from '../src/signature';
import type { SigModel } from '../src/signature';
import {
  DATE_FOOT, DATE_PARTS, DATE_SPOTS, DATE_TOP, DIGIT_H, DIGIT_KEYS, buildDigits, buildSigModel, clampPlace, dateDigits, datePartsOf, dateText,
  defaultPlace, fitDate, groupReach, groupWidth, rowPlace, samePlace, sigBaseline, signatureProblem, spotPlace, withParts,
} from '../src/sigModel';
import type { DatePart, DatePlace, DateSpot, DigitMap, Hand } from '../src/sigModel';
import { Card, Chip, ListCard, ListRow, ScreenBG, SectionTitle, Toggle, useTheme, useToolHeader } from '../src/components/UI';
import { ARRIVE, Appear, Bouncy, Enter, useAnimLevel } from '../src/components/Motion';
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
/**
 * Touch reach past a pad's control (38 dp, or a pill about 36 tall) to 44 dp and more, short of the 10 dp between two;
 * and past a digit's 28 dp circle, 44 dp tall and as wide as the space between ten in a row allows.
 */
const PAD_SLOP = { top: 5, bottom: 5, left: 4, right: 4 };
const CELL_SLOP = { top: 8, bottom: 8, left: 2, right: 2 };

const PROBLEMS = {
  empty: 'Sign in the pad first.',
  dots: 'That reads as dots. Write at least one line.',
  small: 'That is very small. Sign across more of the pad.',
} as const;

type DigitDraft = Record<string, { strokes: PadStroke[] }>;
const GROUPS = DATE_PARTS;
const PART_NAMES: Record<DatePart, string> = { dd: 'Day', mm: 'Month', yy: 'Year' };

/** A placement as the store keeps it: plain numbers, and the parts written only when they are a real choice. */
function storedPlace(p: DatePlace): NonNullable<OwnSignature['date']> {
  const at = (q: { x: number; y: number }) => ({ x: q.x, y: q.y });
  const out: NonNullable<OwnSignature['date']> = {
    size: p.size, gap: p.gap, tilt: p.tilt, when: p.when, groups: { dd: at(p.groups.dd), mm: at(p.groups.mm), yy: at(p.groups.yy) },
  };
  if (p.parts && p.parts.length < DATE_PARTS.length) out.parts = [...p.parts];
  return out;
}

/**
 * The placement the page opens with: the saved one, or null (placed automatically) when it is exactly the one the page
 * would place for these parts anyway. Save keeps an automatic date with fewer than all its parts so the parts are
 * remembered; read back, it stays automatic, so it still follows a signature recorded again.
 */
function savedPlace(own: OwnSignature | null | undefined): DatePlace | null {
  if (!own?.digits || !own.date) return null;
  const p = clampPlace(own.date);
  if (!p.parts) return p;
  try {
    const model = buildSigModel(own);
    const digits = buildDigits(own.digits);
    if (model && digits && samePlace(p, defaultPlace(model, digits, p.parts))) return null;
  } catch {
    // a recording that does not build keeps its placement as saved
  }
  return p;
}

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
  const [place, setPlace] = useState<DatePlace | null>(() => savedPlace(own));
  /** which parts of the date are written: kept apart from the placement, so an automatic one follows them too */
  const [parts, setParts] = useState<DatePart[]>(() => datePartsOf(own?.digits ? own.date?.parts : undefined));
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
  const autoPlace = useMemo(
    () => (model && digitModel ? defaultPlace(model, digitModel, parts) : null), [model, digitModel, parts],
  );
  const activePlace = useMemo(() => (place ? withParts(place, parts) : autoPlace), [place, parts, autoPlace]);
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
      // a date placed automatically is saved only when it writes fewer than all its parts, which it has to remember
      const date = place ? withParts(place, parts) : parts.length < DATE_PARTS.length ? autoPlace : null;
      if (date) value.date = storedPlace(date);
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
          setParts([...DATE_PARTS]);
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
  const onPlace = useCallback((next: DatePlace | null) => { setPlace(next); setEdited(true); }, []);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  const digitModelRef = useRef(digitModel);
  digitModelRef.current = digitModel;
  /**
   * Another choice of parts. A date placed by hand is set in a row again from where it starts, closing up or making
   * room, at its own size and tilt; one placed automatically simply follows.
   */
  const onParts = useCallback((next: DatePart[]) => {
    const start = partsRef.current[0];
    const hand = digitModelRef.current;
    setParts(next);
    setEdited(true);
    setPlace((cur) => (cur && hand ? rowPlace(cur, hand, next, cur.groups[start]) : cur));
  }, []);

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
            onPlace={onPlace} parts={parts} onParts={onParts} open={dateOpen} onOpen={setDateOpen} width={contentW}
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
      onPress={onPress} disabled={disabled} scaleTo={0.96} radius={999} accessibilityLabel={label} hitSlop={PAD_SLOP}
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
  model, digits, onDigits, digitModel, hand, explicit, onPlace, parts, onParts, open, onOpen, width,
}: {
  model: SigModel | null; digits: DigitDraft; onDigits: (next: (d: DigitDraft) => DigitDraft) => void; digitModel: DigitMap | null;
  hand: Hand | null; explicit: boolean; onPlace: (p: DatePlace | null) => void;
  parts: DatePart[]; onParts: (next: DatePart[]) => void;
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
  const today = useMemo(() => dateDigits(), []);
  /** the date moves as one piece unless its parts are placed separately */
  const [apart, setApart] = useState(false);
  /** the last part written was tapped: it stays, and the caption says why */
  const [lastOne, setLastOne] = useState(false);
  /** each Preview counts up and plays the signature and date again, under the placer */
  const [previewed, setPreviewed] = useState(0);

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
      {
        text: 'Remove', style: 'destructive',
        onPress: () => { onDigits(() => ({})); onPlace(null); onParts([...DATE_PARTS]); setLastOne(false); setCurrent('0'); },
      },
    ]);
  };
  const togglePart = (g: DatePart) => {
    tick();
    const on = parts.includes(g);
    // at least one part stays: the date always writes something
    if (on && parts.length === 1) { setLastOne(true); return; }
    setLastOne(false);
    onParts(on ? parts.filter((p) => p !== g) : DATE_PARTS.filter((p) => p === g || parts.includes(p)));
  };
  const several = parts.length > 1;
  const together = !apart || !several;

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

          {count === DIGIT_KEYS.length ? (
            <View style={st.writeBlock}>
              <View style={st.writeRow}>
                <Text style={[T.body, st.writeLabel]} maxFontSizeMultiplier={CHROME_FONT_MAX}>Write</Text>
                {DATE_PARTS.map((g) => (
                  <Chip
                    key={g} label={PART_NAMES[g]} active={parts.includes(g)} onPress={() => togglePart(g)} style={st.partChip}
                    accessibilityRole="checkbox" accessibilityState={{ checked: parts.includes(g) }}
                  />
                ))}
              </View>
              <Text style={[T.caption, { marginTop: 10 }]} accessibilityLiveRegion="polite">
                {lastOne ? 'At least one stays on' : 'Shown as ' + dateText(today, parts)}
              </Text>
            </View>
          ) : null}

          {model && digitModel && hand ? (
            <>
              <SectionTitle>Place the date</SectionTitle>
              <Text style={[T.caption, { marginBottom: 14 }]}>
                {together
                  ? 'Drag the date to move it. Pinch to size it, or turn two fingers to tilt it.'
                  : 'Drag each part on its own. Pinch to size the date, or turn two fingers to tilt it.'}
              </Text>
              <DatePlacer model={model} hand={hand} width={width} together={together} onPlace={onPlace} />
              <View style={st.controls}>
                <PadButton icon="play" label="Preview" onPress={() => { tick(); setPreviewed((n) => n + 1); }} />
              </View>
              {previewed ? <PreviewStage model={model} hand={hand} play={previewed} width={width} /> : null}
              <PlaceSteppers hand={hand} model={model} together={together} onPlace={onPlace}>
                {several ? (
                  <View style={st.stepRow}>
                    <Text style={[T.body, { flex: 1 }]}>Place parts separately</Text>
                    <Toggle value={apart} onChange={setApart} label="Place parts separately" />
                  </View>
                ) : null}
              </PlaceSteppers>
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
      onPress={onPress} scaleTo={0.9} radius={999} hitSlop={CELL_SLOP}
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
/**
 * While it is dragged, a part (or the whole date) snaps its baseline to the signature's, or to another part's, within
 * this many signature units of it, or this many px on the screen when that is more: at the placer's scale six units
 * are only about two px, too fine for a finger.
 */
const SNAP_UNITS = 6;
const SNAP_PX = 8;
/** how far a digit may reach over its cap line, as a share of the size: the room each group is drawn in */
const DRAW_TOP = 1.4;
/** the faint line the signature sits on, as the pad's guide */
const GUIDE = liteSh(0.13);
const ZERO = { x: 0, y: 0 };
const SPOT_LABELS: Record<DateSpot, string> = {
  after: 'After it', belowRight: 'Below, right', belowLeft: 'Below, left', above: 'Above',
};
const SPOT_SPOKEN: Record<DateSpot, string> = {
  after: 'Put the date after the signature', belowRight: 'Put the date below it, at the right',
  belowLeft: 'Put the date below it, at the left', above: 'Put the date above it',
};

type Region = readonly [number, number, number, number];
type Touch = { id: number; x: number; y: number };

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const anchorsOf = (p: DatePlace) => [p.groups.dd.x, p.groups.dd.y, p.groups.mm.x, p.groups.mm.y, p.groups.yy.x, p.groups.yy.y];

/** How wide a group is written today, signature units: its two digits with the room it makes. */
function groupWidthToday(hand: Hand, group: DatePart, pair: string): number {
  const { place } = hand;
  const fit = hand.fit[group][pair];
  const scale = (place.size / DIGIT_H) * (fit?.scale ?? 1);
  const gap = fit?.gap ?? place.gap;
  const a = hand.digits[pair[0]];
  const b = hand.digits[pair[1]];
  if (!a || !b) return 0;
  return (Math.max(14, a.x1 - a.x0) + gap * DIGIT_H + Math.max(14, b.x1 - b.x0)) * scale;
}

/** The room the date may be dragged in, signature units: around the signature, with space below it, and wherever the date reaches. */
function placeRegion(model: SigModel, hand: Hand): Region {
  const ext = inkExtent(model, hand);
  return [
    Math.min(-0.1 * model.vw, ext[0] - 20),
    Math.min(-Math.max(0.12 * model.vh, 40), ext[1] - 20),
    Math.max(1.1 * model.vw, ext[2] + 20),
    Math.max(model.vh + Math.max(0.35 * model.vh, 170), ext[3] + 20),
  ];
}

/**
 * The signature in a well with today's date on it, on the line the signature sits on. The date moves as one piece, or
 * (`together` off) each part on its own; it snaps to the signature's baseline and to the other parts', a pinch sizes
 * it and two fingers turn it, and the quick spots under it set it against the ink. Everything moves on the UI thread
 * while a finger is down; the new place is handed over once, when the last finger lifts. A touch that lands on no part
 * is left to the page, so the page still scrolls from here.
 */
const DatePlacer = React.memo(function DatePlacer({ model, hand, width, together, onPlace }: {
  model: SigModel; hand: Hand; width: number; together: boolean; onPlace: (p: DatePlace) => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const today = useMemo(() => dateDigits(), []);
  const { place } = hand;
  const parts = datePartsOf(place.parts);
  const written = GROUPS.map((g) => parts.includes(g));
  const baseline = useMemo(() => sigBaseline(model), [model]);

  // the room grows to take in wherever the date goes (a quick spot, a bigger size) and never shrinks under one
  // signature, so the frame does not jump after a drop; a new signature starts it again
  const grown = useRef<{ model: SigModel; r: Region } | null>(null);
  const want = placeRegion(model, hand);
  const prev = grown.current && grown.current.model === model ? grown.current.r : null;
  const region: Region = prev
    ? [Math.min(prev[0], want[0]), Math.min(prev[1], want[1]), Math.max(prev[2], want[2]), Math.max(prev[3], want[3])]
    : want;
  grown.current = { model, r: region };
  // the canvas takes the content's full width and up to PLACER_MAX_H: the room widens to fill it
  const rw = region[2] - region[0];
  const rh = region[3] - region[1];
  const k = Math.min(width / rw, PLACER_MAX_H / rh);
  const padX = Math.max(0, width / k - rw) / 2;
  const rx0 = region[0] - padX;
  const rx1 = region[2] + padX;
  const ry0 = region[1];
  const ry1 = region[3];
  const cw = width;
  const ch = rh * k;
  const lineW = 1.7 / k;

  const widths = GROUPS.map((g, gi) => groupWidthToday(hand, g, today.slice(gi * 2, gi * 2 + 2)));
  // each part is drawn upright at the largest size the placer allows and scaled and turned to its own on the UI
  // thread, so a pinch never shows a blurred digit and nothing is drawn again when it ends
  const drawSize = Math.max(SIZE.max, place.size);
  const drawHand: Hand = useMemo(() => ({
    ...hand, place: { ...hand.place, size: drawSize, tilt: 0, groups: { dd: ZERO, mm: ZERO, yy: ZERO } },
  }), [hand, drawSize]);
  const laid = useMemo(() => layoutDate(today, drawHand), [drawHand, today]);
  const half = (Math.hypot(groupWidth(hand.digits, drawSize, place.gap), DRAW_TOP * drawSize) + 2 * lineW) * k;

  const anchors = useSharedValue(anchorsOf(place));
  /** a quick spot glides there: the anchors shown are from + (anchors - from) * spot */
  const from = useSharedValue(anchorsOf(place));
  const spot = useSharedValue(1);
  /** the anchors while a finger is down, and where they were when it (or the second finger) came down */
  const live = useSharedValue(anchorsOf(place));
  const base = useSharedValue(anchorsOf(place));
  /** -1 at rest; the part held (0 to 2), or 3 for the whole date */
  const active = useSharedValue(-1);
  const grab = useSharedValue(-1);
  const pA = useSharedValue(-1);
  const pB = useSharedValue(-1);
  const start = useSharedValue([0, 0]);
  /** a pinch, from when the second finger came down: [distance, angle, size, tilt, pivot x, pivot y, mid x, mid y] */
  const pin = useSharedValue<number[] | null>(null);
  const liveSize = useSharedValue(place.size);
  const liveTilt = useSharedValue(place.tilt);
  /** what the date snaps to: -1 nothing, 0 to 2 another part, 3 the signature's baseline; the guide as [x, y, angle] */
  const snap = useSharedValue(-1);
  const guide = useSharedValue([0, 0, 0]);

  /** the next placement handed in is a quick spot: it glides there instead of jumping */
  const glideNext = useRef(false);
  useEffect(() => {
    const next = anchorsOf(place);
    const glide = glideNext.current && level === 'full';
    glideNext.current = false;
    if (active.value !== -1) return;
    if (glide) {
      const f = from.value;
      const a = anchors.value;
      const t = spot.value;
      from.value = a.map((v, i) => f[i] + (v - f[i]) * t);
      anchors.value = next;
      spot.value = 0;
      spot.value = withTiming(1, ARRIVE);
    } else {
      cancelAnimation(spot);
      spot.value = 1;
      from.value = next;
      anchors.value = next;
    }
  }, [place]);
  useEffect(() => {
    if (active.value !== -1) return;
    liveSize.value = place.size;
    liveTilt.value = place.tilt;
  }, [place.size, place.tilt]);

  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const placeRef = useRef(place);
  placeRef.current = place;
  const dropped = (a: number[], size: number, tilt: number) => {
    const p = placeRef.current;
    const next: DatePlace = {
      ...p, size, tilt, groups: { dd: { x: a[0], y: a[1] }, mm: { x: a[2], y: a[3] }, yy: { x: a[4], y: a[5] } },
    };
    if (!samePlace(next, p)) onPlaceRef.current(next);
  };

  const gesture = useMemo(() => {
    const tiltDeg = place.tilt;
    const rad = (tiltDeg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const tan = Math.tan(rad);
    const slop = GRAB_SLOP / k;
    const ws = widths.slice();
    const on = written.slice();
    const top = 1.15 * place.size;
    const foot = 0.25 * place.size;
    const reach = groupReach(hand.digits, place.size, place.gap, place.tilt).slice();
    /** a group's width at size 1: its reach at whatever size a pinch ends on */
    const unitW = groupWidth(hand.digits, 1, place.gap);
    const snapU = Math.max(SNAP_UNITS, SNAP_PX / k);
    const whole = together;
    const mid = (rx0 + rx1) / 2;
    // a size or tilt from elsewhere outside the steppers' range is kept, not snapped in, as a pinch begins
    const sizeLo = Math.min(SIZE.min, place.size);
    const sizeHi = Math.max(SIZE.max, place.size);
    const tiltLo = Math.min(TILT.min, place.tilt);
    const tiltHi = Math.max(TILT.max, place.tilt);

    /** where the anchors show now: on their way to a quick spot, or at rest */
    const shown = (): number[] => {
      'worklet';
      const f = from.value;
      const a = anchors.value;
      const t = spot.value;
      const out: number[] = [];
      for (let i = 0; i < 6; i++) out.push(f[i] + (a[i] - f[i]) * t);
      return out;
    };
    const inside = (v: number, lo: number, hi: number) => {
      'worklet';
      return lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
    };
    /** one finger: the part held, or the whole date, follows it, kept in the frame and snapped to a baseline near it */
    const drag = (t: Touch) => {
      'worklet';
      const b = base.value;
      const g = grab.value;
      let ux = (t.x - start.value[0]) / k;
      let uy = (t.y - start.value[1]) / k;
      let lx = -1e9;
      let hx = 1e9;
      let ly = -1e9;
      let hy = 1e9;
      for (let i = 0; i < 3; i++) {
        if (!on[i] || !(whole || i === g)) continue;
        lx = Math.max(lx, rx0 - reach[0] - b[i * 2]);
        hx = Math.min(hx, rx1 - reach[2] - b[i * 2]);
        ly = Math.max(ly, ry0 - reach[1] - b[i * 2 + 1]);
        hy = Math.min(hy, ry1 - reach[3] - b[i * 2 + 1]);
      }
      ux = inside(ux, lx, hx);
      uy = inside(uy, ly, hy);
      // the nearest baseline in reach: the signature's, or (a part on its own) another part's, along the tilt
      let best = 0;
      let kind = -1;
      let gx = 0;
      let gy = 0;
      let ga = 0;
      for (let i = 0; i < 3; i++) {
        if (!on[i] || !(whole || i === g)) continue;
        const x = b[i * 2] + ux;
        const y = b[i * 2 + 1] + uy;
        const toSig = baseline - y;
        if (Math.abs(toSig) <= snapU && (kind === -1 || Math.abs(toSig) < Math.abs(best))) {
          best = toSig; kind = 3; gx = mid; gy = baseline; ga = 0;
        }
        if (whole) continue;
        for (let j = 0; j < 3; j++) {
          if (j === i || !on[j]) continue;
          const d = b[j * 2 + 1] + (x - b[j * 2]) * tan - y;
          if (Math.abs(d) <= snapU && (kind === -1 || Math.abs(d) < Math.abs(best))) {
            best = d; kind = j; gx = b[j * 2]; gy = b[j * 2 + 1]; ga = tiltDeg;
          }
        }
      }
      if (kind !== -1) {
        if (uy + best >= ly && uy + best <= hy) uy += best;
        else kind = -1;
      }
      if (kind !== snap.value) {
        if (kind !== -1) {
          guide.value = [gx, gy, ga];
          runOnJS(tick)();
        }
        snap.value = kind;
      }
      const l = b.slice();
      for (let i = 0; i < 3; i++) {
        if (!(whole || i === g)) continue;
        l[i * 2] += ux;
        l[i * 2 + 1] += uy;
      }
      live.value = l;
    };
    /** a second finger: the pinch starts from where everything is now */
    const pinchFrom = (a: Touch, t: Touch) => {
      'worklet';
      const mx = (a.x + t.x) / 2;
      const my = (a.y + t.y) / 2;
      base.value = live.value.slice();
      pin.value = [
        Math.max(1, Math.hypot(t.x - a.x, t.y - a.y)), Math.atan2(t.y - a.y, t.x - a.x), liveSize.value, liveTilt.value,
        rx0 + mx / k, ry0 + my / k, mx, my,
      ];
      snap.value = -1;
    };
    /**
     * Two fingers: the spread sizes the date and the turn tilts it, the steppers' ranges kept. The whole date turns and
     * grows about the point between the fingers and moves with them; a part on its own moves with them while every
     * part takes the new size and tilt about its own anchor (size and tilt are the date's, not a part's).
     */
    const pinchTo = (a: Touch, t: Touch) => {
      'worklet';
      const p = pin.value;
      if (!p) return;
      const size = Math.min(sizeHi, Math.max(sizeLo, (p[2] * Math.hypot(t.x - a.x, t.y - a.y)) / p[0]));
      let turn = Math.atan2(t.y - a.y, t.x - a.x) - p[1];
      while (turn > Math.PI) turn -= 2 * Math.PI;
      while (turn < -Math.PI) turn += 2 * Math.PI;
      const tilt = Math.min(tiltHi, Math.max(tiltLo, p[3] + (turn * 180) / Math.PI));
      const s = size / p[2];
      const r = ((tilt - p[3]) * Math.PI) / 180;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const mx = ((a.x + t.x) / 2 - p[6]) / k;
      const my = ((a.y + t.y) / 2 - p[7]) / k;
      const b = base.value;
      const l = b.slice();
      for (let i = 0; i < 3; i++) {
        if (whole) {
          const ox = b[i * 2] - p[4];
          const oy = b[i * 2 + 1] - p[5];
          l[i * 2] = p[4] + (ox * c - oy * sn) * s + mx;
          l[i * 2 + 1] = p[5] + (ox * sn + oy * c) * s + my;
        } else if (i === grab.value) {
          l[i * 2] = b[i * 2] + mx;
          l[i * 2 + 1] = b[i * 2 + 1] + my;
        }
      }
      liveSize.value = size;
      liveTilt.value = tilt;
      live.value = l;
    };
    /** the last finger lifts: every part is brought inside the frame at the size and tilt it ends on, and handed over */
    const drop = () => {
      'worklet';
      const size = Math.round(liveSize.value);
      const tilt = Math.round(liveTilt.value);
      const rr = (tilt * Math.PI) / 180;
      const c = Math.cos(rr);
      const sn = Math.sin(rr);
      const w = unitW * size;
      let r0 = 1e9;
      let r1 = 1e9;
      let r2 = -1e9;
      let r3 = -1e9;
      const ys = [-DATE_TOP * size, DATE_FOOT * size];
      for (let xi = 0; xi < 2; xi++) {
        for (let yi = 0; yi < 2; yi++) {
          const x = xi * w;
          const y = ys[yi];
          const X = x * c - y * sn;
          const Y = x * sn + y * c;
          r0 = Math.min(r0, X); r1 = Math.min(r1, Y); r2 = Math.max(r2, X); r3 = Math.max(r3, Y);
        }
      }
      const l = live.value.slice();
      for (let i = 0; i < 3; i++) {
        if (on[i]) {
          l[i * 2] = inside(l[i * 2], rx0 - r0, rx1 - r2);
          l[i * 2 + 1] = inside(l[i * 2 + 1], ry0 - r1, ry1 - r3);
        }
        l[i * 2] = Math.round(l[i * 2]);
        l[i * 2 + 1] = Math.round(l[i * 2 + 1]);
      }
      anchors.value = l;
      from.value = l;
      spot.value = 1;
      base.value = l;
      liveSize.value = size;
      liveTilt.value = tilt;
      pin.value = null;
      snap.value = -1;
      pA.value = -1;
      pB.value = -1;
      grab.value = -1;
      active.value = -1;
      runOnJS(dropped)(l, size, tilt);
    };

    return Gesture.Manual()
      .onTouchesDown((e, manager) => {
        'worklet';
        for (const t of e.changedTouches) {
          if (pA.value === -1) {
            const s = shown();
            const px = t.x / k + rx0;
            const py = t.y / k + ry0;
            let hit = -1;
            // the last drawn is on top
            for (let gi = 2; gi >= 0 && hit < 0; gi--) {
              if (!on[gi]) continue;
              const ox = px - s[gi * 2];
              const oy = py - s[gi * 2 + 1];
              const lx = ox * cos + oy * sin;
              const ly = -ox * sin + oy * cos;
              if (lx >= -slop && lx <= ws[gi] + slop && ly >= -top - slop && ly <= foot + slop) hit = gi;
            }
            if (hit < 0) {
              manager.fail();
              return;
            }
            // a date still gliding to a quick spot stops where it is
            anchors.value = s;
            from.value = s;
            spot.value = 1;
            base.value = s;
            live.value = s;
            pA.value = t.id;
            grab.value = hit;
            active.value = whole ? 3 : hit;
            start.value = [t.x, t.y];
            manager.activate();
            runOnJS(tick)();
          } else if (pB.value === -1 && t.id !== pA.value) {
            let a: Touch | null = null;
            for (const c of e.allTouches) {
              if (c.id === pA.value) a = c;
            }
            if (!a) continue;
            pB.value = t.id;
            pinchFrom(a, t);
          }
        }
      })
      .onTouchesMove((e) => {
        'worklet';
        if (pA.value === -1) return;
        let a: Touch | null = null;
        let b: Touch | null = null;
        for (const c of e.allTouches) {
          if (c.id === pA.value) a = c;
          else if (c.id === pB.value) b = c;
        }
        if (pin.value) {
          if (a && b) pinchTo(a, b);
          return;
        }
        if (a) drag(a);
      })
      .onTouchesUp((e, manager) => {
        'worklet';
        let mine = false;
        for (const c of e.changedTouches) {
          if (c.id === pA.value || c.id === pB.value) mine = true;
        }
        if (!mine) return;
        drop();
        manager.end();
      })
      .onTouchesCancelled((_e, manager) => {
        'worklet';
        if (pA.value !== -1) drop();
        manager.end();
      })
      .onFinalize(() => {
        'worklet';
        if (pA.value !== -1) drop();
      });
  }, [k, rx0, ry0, rx1, ry1, place.size, place.tilt, place.gap, widths.join(','), written.join(','), together, baseline, hand.digits]);

  const span = Math.ceil(2 * Math.hypot(cw, ch));
  const guideStyle = useAnimatedStyle(() => {
    const g = guide.value;
    return {
      opacity: snap.value === -1 ? 0 : 1,
      transform: [
        { translateX: (g[0] - rx0) * k - span / 2 },
        { translateY: (g[1] - ry0) * k - 0.5 },
        { rotate: g[2] + 'deg' },
      ] as const,
    };
  });

  const spots = useMemo(
    () => DATE_SPOTS.map((s) => ({ s, p: spotPlace(model, hand.digits, place, s, baseline) })),
    [model, hand.digits, place, baseline],
  );
  const goSpot = (p: DatePlace) => {
    tick();
    if (samePlace(p, placeRef.current)) return;
    glideNext.current = true;
    onPlace(p);
  };

  return (
    <>
      <View
        style={[
          st.placer, { width: cw, height: ch },
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('mid') },
        ]}
        accessible
        accessibilityLabel={together
          ? 'Where today\'s date goes. Drag the date, or use the spots below.'
          : 'Where today\'s date goes. Drag each part, or use the spots below.'}
      >
        <Svg width={cw} height={ch} viewBox={`${rx0} ${ry0} ${rx1 - rx0} ${ry1 - ry0}`} style={StyleSheet.absoluteFill}>
          <Line x1={rx0} x2={rx1} y1={baseline} y2={baseline} stroke={GUIDE} strokeWidth={1 / k} />
          {model.strokes.map((s, i) => (s.type === 'line' ? (
            <Path key={i} d={s.d} fill="none" stroke={C.textDim} strokeWidth={lineW} strokeLinecap="round" strokeLinejoin="round" />
          ) : (
            <Circle key={i} cx={s.cx} cy={s.cy} r={lineW} fill={C.textDim} />
          )))}
        </Svg>
        <Animated.View pointerEvents="none" style={[st.snapLine, { width: span, backgroundColor: C.accent }, guideStyle]} />
        {GROUPS.map((g, gi) => (written[gi] ? (
          <PlacedGroup
            key={g} index={gi} hand={hand} laid={laid.digits.filter((p) => p.key.startsWith(g))} half={half} k={k}
            lineW={lineW} drawSize={drawSize} rx0={rx0} ry0={ry0} anchors={anchors} from={from} spot={spot} live={live}
            active={active} liveSize={liveSize} liveTilt={liveTilt}
          />
        ) : null))}
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
      </View>
      <View style={st.spots}>
        {spots.map(({ s, p }) => (
          <Chip
            key={s} small label={SPOT_LABELS[s]} active={samePlace(p, place)} onPress={() => goSpot(p)}
            accessibilityLabel={SPOT_SPOKEN[s]}
          />
        ))}
      </View>
    </>
  );
});

type Laid = ReturnType<typeof layoutDate>['digits'];

/**
 * One part of the date in its own square, centred on its anchor: drawn upright at `drawSize`, then moved, turned and
 * scaled to the date's own on the UI thread.
 */
function PlacedGroup({
  index, hand, laid, half, k, lineW, drawSize, rx0, ry0, anchors, from, spot, live, active, liveSize, liveTilt,
}: {
  index: number; hand: Hand; laid: Laid; half: number; k: number; lineW: number; drawSize: number; rx0: number; ry0: number;
  anchors: SharedValue<number[]>; from: SharedValue<number[]>; spot: SharedValue<number>; live: SharedValue<number[]>;
  active: SharedValue<number>; liveSize: SharedValue<number>; liveTilt: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const i = index * 2;
    let x: number;
    let y: number;
    if (active.value !== -1) {
      x = live.value[i];
      y = live.value[i + 1];
    } else {
      const t = spot.value;
      const f = from.value;
      const a = anchors.value;
      x = f[i] + (a[i] - f[i]) * t;
      y = f[i + 1] + (a[i + 1] - f[i + 1]) * t;
    }
    return {
      transform: [
        { translateX: (x - rx0) * k - half },
        { translateY: (y - ry0) * k - half },
        { rotate: liveTilt.value + 'deg' },
        { scale: liveSize.value / drawSize },
      ] as const,
    };
  });
  const u = half / k;
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0, width: 2 * half, height: 2 * half }, style]}>
      <Svg width={2 * half} height={2 * half} viewBox={`${-u} ${-u} ${2 * u} ${2 * u}`}>
        {laid.map((p) => {
          // a digit unit's stroke times the size shown: the ink keeps the signature's weight at any size
          const wk = (lineW * drawSize) / p.scale;
          return (
            <G key={p.key + p.ch} transform={p.transform}>
              {hand.digits[p.ch].strokes.map((s, i) => (s.type === 'line'
                ? <GroupLine key={i} d={s.d} wk={wk} size={liveSize} />
                : <GroupDot key={i} cx={s.cx} cy={s.cy} wk={wk} size={liveSize} />))}
            </G>
          );
        })}
      </Svg>
    </Animated.View>
  );
}

function GroupLine({ d, wk, size }: { d: string; wk: number; size: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ strokeWidth: wk / size.value }));
  return <AnimatedPath d={d} fill="none" stroke={C.text} strokeLinecap="round" strokeLinejoin="round" animatedProps={props} />;
}

function GroupDot({ cx, cy, wk, size }: { cx: number; cy: number; wk: number; size: SharedValue<number> }) {
  const props = useAnimatedProps(() => ({ r: wk / size.value }));
  return <AnimatedCircle cx={cx} cy={cy} fill={C.text} animatedProps={props} />;
}

/**
 * Size, spacing and tilt, a step at a time: no sliders to fumble. Anything given first goes at the top of the list.
 * The date as one piece (`together`) grows and turns about its first part, as a pinch grows and turns it, so its parts
 * keep their spacing; a date placed part by part keeps each part's anchor.
 */
function PlaceSteppers({ hand, model, together, onPlace, children }: {
  hand: Hand; model: SigModel; together: boolean; onPlace: (p: DatePlace) => void; children?: React.ReactNode;
}) {
  const { place } = hand;
  const set = (patch: Partial<DatePlace>) => {
    const next = { ...place, ...patch };
    let { groups } = next;
    if (together && (next.size !== place.size || next.tilt !== place.tilt)) {
      const pivot = place.groups[datePartsOf(place.parts)[0]];
      const s = next.size / place.size;
      const r = ((next.tilt - place.tilt) * Math.PI) / 180;
      const c = Math.cos(r);
      const sn = Math.sin(r);
      const about = (q: { x: number; y: number }) => {
        const ox = q.x - pivot.x;
        const oy = q.y - pivot.y;
        return { x: pivot.x + (ox * c - oy * sn) * s, y: pivot.y + (ox * sn + oy * c) * s };
      };
      groups = { dd: about(groups.dd), mm: about(groups.mm), yy: about(groups.yy) };
    }
    // never past the room it may be dragged in
    const [rx0, ry0, rx1, ry1] = placeRegion(model, hand);
    const at = (q: { x: number; y: number }) => ({
      x: Math.round(Math.min(rx1 - 20, Math.max(rx0, q.x))),
      y: Math.round(Math.min(ry1, Math.max(ry0 + 1.15 * next.size, q.y))),
    });
    onPlace({ ...next, groups: { dd: at(groups.dd), mm: at(groups.mm), yy: at(groups.yy) } });
  };
  return (
    <ListCard style={{ marginTop: S.gap }}>
      {children}
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
  // a digit's place is a small flat choice, like a chip: Schibsted
  cellText: { ...oneLine(13), fontFamily: F.smSemi },
  writeBlock: { marginTop: S.section },
  writeRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 10 },
  writeLabel: { marginRight: 14 },
  partChip: { marginRight: 8, marginBottom: 0 },
  // the placer is a well like the pad: the signature and the date inside it are clipped by its rim
  placer: { alignSelf: 'center', overflow: 'hidden', borderRadius: S.radiusSm },
  snapLine: { position: 'absolute', left: 0, top: 0, height: 1 },
  spots: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 4, gap: 10 },
  stepKey: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  // figures that step and line up: Inter Tight Medium with tabular figures, never Schibsted, centred on one line
  stepValue: {
    ...oneLine(13), fontFamily: F.med, color: C.text, minWidth: 48, textAlign: 'center', fontVariant: ['tabular-nums'],
  },
  link: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 2, marginTop: 10 },
  linkText: { fontFamily: F.med, fontSize: 13, letterSpacing: TRACK.small, color: C.accent },
  remove: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginTop: S.section },
  removeText: { fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, color: C.danger },
});
