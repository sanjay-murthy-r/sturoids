import React from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Modal, ViewStyle,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter } from 'expo-router';
import { Directions, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, T, ThemeMode, bgFor, neuRaised, neuInset, neuPressedInner } from '../theme';
import { useStore } from '../store';
import { Bouncy, Pop, RISE_OUT, useAnimLevel } from './Motion';
import { tap, tick } from '../haptics';

export const useTheme = (): ThemeMode => {
  // subscribing to the accent here makes EVERY themed component repaint the
  // moment a new accent is picked — no remount required
  useStore((s) => s.settings.accent);
  return useStore((s) => s.settings.theme);
};

const NATIVE_TABS = ['tasks', 'focus', 'planner'];
const PATH_TO_TAB: Record<string, string> = { '/': 'index', '/tasks': 'tasks', '/focus': 'focus', '/planner': 'planner', '/more': 'more' };

/**
 * Screen background.
 * `guard` paints an opaque status-bar zone AND enables left/right fling
 * navigation between tab screens — use it ONLY on the five tabs.
 */
export function ScreenBG({ children, guard = false }: { children: React.ReactNode; guard?: boolean }) {
  const theme = useTheme();
  const accent = useStore((s) => (s.settings as any).accent); // subscribe: accent changes re-render every screen
  const slots = useStore((s) => s.settings.tabSlots);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const pathname = usePathname();
  const bg = bgFor(theme);
  void accent;

  const go = React.useCallback((dir: 1 | -1) => {
    const order = ['index', ...(slots || NATIVE_TABS).filter((k) => NATIVE_TABS.includes(k)), 'more'];
    const cur = PATH_TO_TAB[pathname];
    const i = order.indexOf(cur);
    if (i < 0) return;
    const next = order[i + dir];
    if (!next) return;
    tick();
    router.navigate((next === 'index' ? '/' : '/' + next) as any);
  }, [pathname, slots]);

  const fling = React.useMemo(() => Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => { 'worklet'; runOnJS(go)(1); }),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => { 'worklet'; runOnJS(go)(-1); }),
  ), [go]);

  const body = (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {children}
      {guard && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: bg }}
        />
      )}
    </View>
  );
  if (!guard) return body;
  return <GestureDetector gesture={fling}>{body}</GestureDetector>;
}

/**
 * App-owned header for tool screens — the ONE place status-bar spacing for
 * headered screens is decided (insets.top is padded explicitly, consistent
 * with the tabs' insets.top + 20 content rule).
 */
export function NeuHeader({ title, right, onBack }: {
  title: string; right?: React.ReactNode; onBack?: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: insets.top + 8, paddingBottom: 10, paddingHorizontal: 14,
        flexDirection: 'row', alignItems: 'center', backgroundColor: bgFor(theme),
      }}
    >
      <NeuIconBtn name="arrow-back" dim={38} size={19} color={C.textDim} onPress={onBack || (() => router.back())} />
      <Text numberOfLines={1} style={{ flex: 1, marginLeft: 12, color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1 }}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Small ⓘ that floats a short feature description in a raised dialog. */
export function InfoDot({ text, size = 15 }: { text: string; size?: number }) {
  const theme = useTheme();
  const { width: winW } = useWindowDimensions();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0 });
  const ref = React.useRef<View>(null);
  const show = () => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setPos({ x, y: y + h });
      setOpen(true);
    });
  };
  return (
    <>
      <Pressable ref={ref} onPress={show} hitSlop={10} style={{ marginLeft: 6 }}>
        <Ionicons name="information-circle-outline" size={size} color={C.textFaint} />
      </Pressable>
      {/* statusBarTranslucent keeps this modal's window in the SAME coordinate
          space measureInWindow reported from — without it the content view
          starts below the translucent status bar and the bubble lands a
          status-bar height too low */}
      <Modal visible={open} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            style={[
              {
                position: 'absolute', top: pos.y + 8,
                left: Math.min(Math.max(12, pos.x - 110), winW - 252),
                width: 240, borderRadius: 14, padding: 12,
              },
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                : { backgroundColor: C.card, ...neuRaised('high') },
            ]}
          >
            <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 12.5, lineHeight: 18 }}>{text}</Text>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Raised soft-UI surface: the kit's dual drop-shadow (light side toward the
 * 60° light, dark side at the exact opposite end), 6px distance both ways.
 */
export function Card({
  children, style, pad = S.cardPad, onPress, onLongPress, hero = false,
}: {
  children: React.ReactNode; style?: ViewStyle | ViewStyle[]; pad?: number;
  onPress?: () => void; onLongPress?: () => void; hero?: boolean;
}) {
  const theme = useTheme();
  const surface: ViewStyle =
    theme === 'minimal'
      ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
      : { backgroundColor: C.card, ...neuRaised(hero ? 'high' : 'mid') };

  const inner = <View style={{ padding: pad }}>{children}</View>;

  if (onPress || onLongPress) {
    return (
      <Bouncy onPress={onPress} onLongPress={onLongPress} style={[st.cardBase, surface, style as any]}>
        {inner}
      </Bouncy>
    );
  }
  return <View style={[st.cardBase, surface, style as any]}>{inner}</View>;
}

export const GlassCard = Card;

/** Depressed well — carved into the material with true inner shadows. */
export function Inset({ children, style, pad = 0 }: { children?: React.ReactNode; style?: any; pad?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        st.insetBase,
        theme === 'minimal'
          ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.inset, ...neuInset('mid') },
        { padding: pad },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={st.sectionRow}>
      <Text style={T.kicker}>{children}</Text>
      {right}
    </View>
  );
}

/**
 * Chips: resting = gently raised; active = pressed INTO the material.
 * The active state MORPHS in — an inset panel springs over the raised surface
 * (the kit's pressed recipe: raised silhouette + carved inner).
 */
export function Chip({
  label, active, color, onPress, small, icon,
}: { label: string; active?: boolean; color?: string; onPress?: () => void; small?: boolean; icon?: any }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const a = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    a.value = level === 'none' ? (active ? 1 : 0) : withSpring(active ? 1 : 0, RISE_OUT);
  }, [active, level]);
  const insetStyle = useAnimatedStyle(() => ({ opacity: a.value }));
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {icon ? (
        <Ionicons name={icon} size={small ? 13 : 15} color={active ? c : C.textFaint} style={{ marginRight: 6 }} />
      ) : null}
      <Text style={[st.chipText, small && { fontSize: 12 }, active && { color: c, fontFamily: F.semi }]}>{label}</Text>
    </View>
  );
  if (theme === 'minimal') {
    return (
      <Bouncy
        onPress={onPress}
        scaleTo={0.94}
        radius={999}
        style={[
          st.chip,
          small && { paddingVertical: 5, paddingHorizontal: 11 },
          { backgroundColor: active ? MIN.inset : MIN.card, borderWidth: 1, borderColor: active ? c : MIN.border },
        ]}
      >
        {content}
      </Bouncy>
    );
  }
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.94}
      radius={999}
      style={[
        st.chip,
        small && { paddingVertical: 5, paddingHorizontal: 11 },
        { backgroundColor: C.card, ...neuRaised('low') },
      ]}
    >
      <Animated.View pointerEvents="none" style={[st.chipInset, insetStyle]} />
      {content}
    </Bouncy>
  );
}

/** Slightly raised button; sinks on press. */
export function PillButton({
  label, onPress, color, icon, outline, style, small,
}: {
  label: string; onPress: () => void; color?: string; icon?: any; outline?: boolean;
  style?: ViewStyle; small?: boolean;
}) {
  const theme = useTheme();
  const c = color || C.accent;
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.96}
      style={[
        st.pill,
        small && { paddingVertical: 8, paddingHorizontal: 14 },
        outline
          ? { borderColor: c + '88', borderWidth: 1.5, backgroundColor: 'transparent' }
          : theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: c + '77' }
            : { backgroundColor: C.card, ...neuRaised('low') },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 14 : 16} color={c} style={{ marginRight: 7 }} /> : null}
      <Text style={{ color: c, fontFamily: F.semi, fontSize: small ? 13 : 15, letterSpacing: 0.1 }}>{label}</Text>
    </Bouncy>
  );
}

/** Bare icon button — padded + hit-slopped to a ≥44px effective target. */
export function IconBtn({ name, onPress, color = C.textDim, size = 22, style, pad = 8 }: {
  name: any; onPress?: () => void; color?: string; size?: number; style?: ViewStyle; pad?: number;
}) {
  return (
    <Bouncy onPress={onPress} scaleTo={0.85} hitSlop={6} radius={999} style={[{ padding: pad }, style]}>
      <Ionicons name={name} size={size} color={color} />
    </Bouncy>
  );
}

/** Raised circular action button (kit button geometry). `active` carves in. */
export function NeuIconBtn({ name, onPress, color, size = 20, dim = 44, active, style }: {
  name: any; onPress?: () => void; color?: string; size?: number; dim?: number;
  active?: boolean; style?: ViewStyle;
}) {
  const theme = useTheme();
  const c = color || C.accent;
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.9}
      radius={dim / 2}
      style={[
        { width: dim, height: dim, borderRadius: dim / 2, alignItems: 'center', justifyContent: 'center' },
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: active ? c : MIN.border }
          : { backgroundColor: C.card, ...neuRaised('low') },
        style,
      ]}
    >
      {active && theme !== 'minimal' ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            borderRadius: dim / 2, backgroundColor: C.inset, ...neuPressedInner(),
          }}
        />
      ) : null}
      <Ionicons name={name} size={size} color={c} />
    </Bouncy>
  );
}

export function CheckCircle({ done, onPress, color = C.green, size = 26 }: {
  done: boolean; onPress: () => void; color?: string; size?: number;
}) {
  return (
    <Bouncy onPress={onPress} scaleTo={0.82} style={{ padding: 2 }}>
      <Pop dep={done}>
        <Ionicons
          name={done ? 'checkmark-circle' : 'ellipse-outline'}
          size={size}
          color={done ? color : C.textFaint}
        />
      </Pop>
    </Bouncy>
  );
}

/**
 * Kit switch. Raised outer ring (the kit's pill border) → carved inner track
 * (overflow hidden — the knob's shine/shadow rims are CLIPPED to the track
 * boundary; this clipping is required and applies only to toggles) → raised
 * knob carrying a tiny accent dot that pops in when on (kit's active state).
 */
const RING_W = 56;
const RING_H = 32;
const TRACK_W = 50;
const TRACK_H = 26;
const KNOB = 20;
const KNOB_TRAVEL = TRACK_W - KNOB - 6; // 24

export function Toggle({ value, onChange, color }: {
  value: boolean; onChange: (v: boolean) => void; color?: string;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const x = useSharedValue(value ? 1 : 0);
  React.useEffect(() => {
    x.value = level === 'none' ? (value ? 1 : 0) : withSpring(value ? 1 : 0, RISE_OUT);
  }, [value, level]);
  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * KNOB_TRAVEL }] }));
  return (
    <Pressable onPress={() => { tick(); onChange(!value); }} hitSlop={8}>
      <View
        style={[
          st.ring,
          theme === 'minimal' && {
            backgroundColor: MIN.card, borderWidth: 1,
            borderColor: value ? c : MIN.border, boxShadow: undefined,
          },
        ]}
      >
        <View style={[st.track, theme === 'minimal' && { backgroundColor: MIN.inset, boxShadow: undefined }]}>
          <Animated.View
            style={[
              st.thumb,
              { backgroundColor: value ? c : '#454C59' },
              theme === 'minimal' && { boxShadow: undefined },
              thumbStyle,
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

/** Text input carved into the material. Layout props go to the wrapper. */
export function Field(props: React.ComponentProps<typeof TextInput> & { style?: any }) {
  const theme = useTheme();
  const flat = StyleSheet.flatten(props.style) || {};
  const {
    flex, width, minWidth, maxWidth, alignSelf,
    margin, marginBottom, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    ...innerStyle
  } = flat as any;
  const wrapStyle: any = {
    flex, width, minWidth, maxWidth, alignSelf, margin, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    marginBottom: marginBottom !== undefined ? marginBottom : 10,
  };
  return (
    <View
      style={[
        st.fieldWrap,
        theme === 'minimal'
          ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.inset, ...neuInset('low') },
        wrapStyle,
      ]}
    >
      <TextInput
        placeholderTextColor={C.textFaint}
        selectionColor={C.accent}
        {...props}
        style={[st.fieldInner, innerStyle]}
      />
    </View>
  );
}

export function EmptyText({ children }: { children: React.ReactNode }) {
  return <Text style={st.empty}>{children}</Text>;
}

/** Inset track + sprung accent fill with the kit's soft glow. */
export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const v = Math.min(1, Math.max(0, value));
  const w = useSharedValue(v);
  React.useEffect(() => {
    w.value = level === 'none' ? v : withSpring(v, RISE_OUT);
  }, [v, level]);
  const fillStyle = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...neuInset('low') },
      ]}
    >
      <Animated.View
        style={[
          {
            height: height - 2, borderRadius: height / 2, backgroundColor: c, margin: 1,
            ...(theme === 'minimal' ? null : { boxShadow: `0 0 4px ${c}B0` }),
          },
          fillStyle,
        ]}
      />
    </View>
  );
}

export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, marginVertical: 2 }} />;
}

/** Bottom sheet — backdrop fades while the panel springs up from the material. */
export function Sheet({
  visible, onClose, title, children,
}: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { height: winH } = useWindowDimensions();
  // the panel's fixed chrome (padding 22 + paddingBottom 36 + handle 21 +
  // title 38, about 120dp) sits OUTSIDE this scroller, so the cap has to come
  // off the screen — a flat 540 pushed the primary button below a short display
  const scrollMax = Math.min(540, Math.max(220, winH * 0.72 - 120));
  const [render, setRender] = React.useState(visible);
  const prog = useSharedValue(visible ? 1 : 0);
  React.useEffect(() => {
    if (visible) {
      setRender(true);
      tap();
      if (level === 'none') { prog.value = 1; }
      else { prog.value = 0; prog.value = withSpring(1, RISE_OUT); }
    } else if (render) {
      if (level === 'none') { prog.value = 0; setRender(false); }
      else {
        prog.value = withTiming(0, { duration: 200 }, (fin) => {
          if (fin) runOnJS(setRender)(false);
        });
      }
    }
  }, [visible]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, prog.value) }));
  // NOTE: the panel keeps full opacity — only the slide is animated. (An
  // animated panel opacity read as a "transparent popup" bug on device.)
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - prog.value) * 64 }],
  }));
  if (!render) return null;
  // statusBarTranslucent: app.json runs a translucent status bar, so the modal's
  // own window has to span it too — without it the dialog content view starts
  // below the bar and the backdrop leaves an undimmed strip across the top
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[st.sheetOverlay, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[st.sheet, theme === 'minimal' && { backgroundColor: MIN.card, borderColor: MIN.border, boxShadow: undefined }, panelStyle]}>
          {/* minimal has no shadow to define the handle, so the FILL has to
              carry it — C.inset on MIN.card is all but invisible */}
          <View style={[st.sheetHandle, theme === 'minimal' ? { backgroundColor: MIN.border } : neuInset('low')]} />
          {title ? <Text style={st.sheetTitle}>{title}</Text> : null}
          {/* negative margin + matching padding: children's raised shadows get
              breathing room inside the ScrollView's clip bounds */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            style={{ maxHeight: scrollMax, marginHorizontal: -10, marginTop: -8 }}
            contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 8, paddingBottom: 10 }}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function DotMenu({
  visible, onClose, items,
}: {
  visible: boolean; onClose: () => void;
  items: { label: string; icon: any; color?: string; onPress: () => void }[];
}) {
  return (
    <Sheet visible={visible} onClose={onClose}>
      {items.map((it, i) => (
        <Bouncy
          key={i}
          onPress={() => { onClose(); setTimeout(it.onPress, 120); }}
          style={st.menuRow}
        >
          <Ionicons name={it.icon} size={19} color={it.color || C.textDim} />
          <Text style={[T.body, { marginLeft: 14, color: it.color || C.text }]}>{it.label}</Text>
        </Bouncy>
      ))}
    </Sheet>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

const st = StyleSheet.create({
  cardBase: {
    borderRadius: S.radius,
    marginBottom: S.gap,
    overflow: 'hidden',
  },
  insetBase: {
    borderRadius: S.radiusSm,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: S.section, marginBottom: 12, paddingHorizontal: 2,
  },
  chip: {
    paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999,
    marginRight: 8, marginBottom: 8,
    overflow: 'hidden',
  },
  chipInset: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 999, backgroundColor: C.inset,
    ...neuInset('low'),
  },
  chipText: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: 0.1 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999,
    overflow: 'hidden',
  },
  ring: {
    width: RING_W, height: RING_H, borderRadius: RING_H / 2,
    backgroundColor: C.card, alignItems: 'center', justifyContent: 'center',
    ...neuRaised('low'),
  },
  track: {
    width: TRACK_W, height: TRACK_H, borderRadius: TRACK_H / 2,
    backgroundColor: C.inset, justifyContent: 'center',
    overflow: 'hidden', // ← clips the knob's shadow rims to the track bounds (required)
    ...neuInset('mid'),
  },
  thumb: {
    width: KNOB, height: KNOB, borderRadius: KNOB / 2, marginLeft: 3,
    ...neuRaised('low'),
  },
  fieldWrap: {
    borderRadius: S.radiusSm,
    overflow: 'hidden',
  },
  fieldInner: {
    color: C.text, fontFamily: F.reg, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15,
    marginBottom: 0,
  },
  empty: {
    color: C.textFaint, fontFamily: F.reg, textAlign: 'center', marginVertical: 26,
    fontSize: 13.5, lineHeight: 20, paddingHorizontal: 10,
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(15,16,19,0.55)' },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 30, borderTopRightRadius: 30,
    padding: 22, paddingBottom: 36,
    borderTopWidth: 1.5, borderColor: C.lite,
    boxShadow: '0 -8px 20px rgba(24,26,30,0.45)',
    overflow: 'hidden', // clips content bg to the rounded corners
  },
  sheetHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: C.inset, marginBottom: 16,
  },
  sheetTitle: { color: C.text, fontFamily: F.semi, fontSize: 18, letterSpacing: -0.2, marginBottom: 14 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
});
