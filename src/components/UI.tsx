import React from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Modal, ViewStyle,
  KeyboardAvoidingView, Platform, ScrollView, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Directions, Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing, FadeIn, FadeOut, LinearTransition, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, S, SH, T, ThemeMode, bgFor, neuRaised, neuInset, neuPressedInner } from '../theme';
import { useStore } from '../store';
import { Bouncy, Pop, RISE_OUT, useAnimLevel, useEntrance } from './Motion';
import { tap, tick } from '../haptics';
import { stepTab } from '../toolNav';
import { READ_MAX, WIDE_AT } from '../layout';

export const useTheme = (): ThemeMode => {
  // subscribing to the accent here makes EVERY themed component repaint the
  // moment a new accent is picked — no remount required
  useStore((s) => s.settings.accent);
  return useStore((s) => s.settings.theme);
};

/**
 * Screen background.
 * `guard` marks a screen shown in the tab bar: it paints an opaque status-bar zone and lets a
 * left or right fling move to the neighbouring tab, in bar order. `fling={false}` keeps the guard
 * but leaves horizontal gestures to the screen (a pager, a web view).
 * On a wide window the screen sits in a centred column no wider than `maxWidth` (null: the whole width), so its
 * header, its content and its floating buttons line up; on a phone nothing changes.
 */
export function ScreenBG({ children, guard = false, fling = true, maxWidth = READ_MAX }: {
  children: React.ReactNode; guard?: boolean; fling?: boolean; maxWidth?: number | null;
}) {
  const theme = useTheme(); // subscribes to the accent too, so every screen repaints on a new accent
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const bg = bgFor(theme);
  const column = maxWidth != null && width >= WIDE_AT;

  const go = React.useCallback((dir: 1 | -1) => {
    if (stepTab(dir)) tick();
  }, []);

  const gesture = React.useMemo(() => Gesture.Race(
    Gesture.Fling().direction(Directions.LEFT).onEnd(() => { 'worklet'; runOnJS(go)(1); }),
    Gesture.Fling().direction(Directions.RIGHT).onEnd(() => { 'worklet'; runOnJS(go)(-1); }),
  ), [go]);

  const body = (
    <View style={{ flex: 1, backgroundColor: bg }}>
      {column ? <View style={{ flex: 1, width: '100%', maxWidth: maxWidth as number, alignSelf: 'center' }}>{children}</View> : children}
      {guard && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top, backgroundColor: bg }}
        />
      )}
    </View>
  );
  if (!guard || !fling) return body;
  return <GestureDetector gesture={gesture}>{body}</GestureDetector>;
}

/**
 * App-owned header for tool screens: the ONE place status-bar spacing for headered screens is decided.
 * `page` (the default) has a back button. `tab` is the root of a bar slot, where there is nothing
 * to go back to, so it shows the tab's title instead; `compact` keeps that title one line tall for
 * tools that need the height (the calculator, Desmos).
 */
export function NeuHeader({ title, right, onBack, variant = 'page', compact = false }: {
  title: string; right?: React.ReactNode; onBack?: () => void; variant?: 'page' | 'tab'; compact?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  if (variant === 'tab' && !compact) {
    return (
      <View
        style={{
          paddingTop: insets.top + 22, paddingBottom: 16, paddingHorizontal: S.pad,
          flexDirection: 'row', alignItems: 'center', backgroundColor: bgFor(theme),
        }}
      >
        <Text numberOfLines={1} style={[T.display, { flex: 1 }]}>{title}</Text>
        {right}
      </View>
    );
  }
  const page = variant === 'page';
  return (
    <View
      style={{
        paddingTop: insets.top + 8, paddingBottom: 14, paddingHorizontal: page ? 14 : S.pad,
        minHeight: insets.top + 56, flexDirection: 'row', alignItems: 'center', backgroundColor: bgFor(theme),
      }}
    >
      {page ? (
        <NeuIconBtn name="arrow-back" dim={38} size={19} color={C.textDim} onPress={onBack || (() => router.back())} accessibilityLabel="Back" />
      ) : null}
      <Text
        numberOfLines={1}
        style={{ flex: 1, marginLeft: page ? 12 : 0, color: C.text, fontFamily: F.semi, fontSize: 17, letterSpacing: -0.1 }}
      >
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Small ⓘ that floats a short feature description in a raised dialog. */
export function InfoDot({ text, size = 15 }: { text: string; size?: number }) {
  const theme = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({ x: 0, y: 0, top: 0 });
  // the bubble's own height, once it has laid out: near the foot of the screen it opens above the dot instead
  const [bubbleH, setBubbleH] = React.useState(0);
  const ref = React.useRef<View>(null);
  const show = () => {
    ref.current?.measureInWindow((x, y, w, h) => {
      setPos({ x, y: y + h, top: y });
      setBubbleH(0);
      setOpen(true);
    });
  };
  const below = pos.y + 8;
  const top = bubbleH > 0 && below + bubbleH > winH - 16 ? Math.max(16, pos.top - 8 - bubbleH) : below;
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
            onLayout={(e) => setBubbleH(e.nativeEvent.layout.height)}
            style={[
              {
                position: 'absolute', top,
                left: Math.min(Math.max(12, pos.x - 110), winW - 252),
                width: 240, borderRadius: 14, padding: 12,
                // hidden for the one frame before it knows whether it fits below the dot
                opacity: bubbleH > 0 ? 1 : 0,
              },
              theme === 'minimal'
                ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
                : { backgroundColor: C.card, ...neuRaised('high') },
            ]}
          >
            <Text style={{ color: C.textDim, fontFamily: F.reg, fontSize: 12, lineHeight: 17 }}>{text}</Text>
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
      <Bouncy onPress={onPress} onLongPress={onLongPress} radius={S.radius} style={[st.cardBase, surface, style as any]}>
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
 * Chips are flat: an outline at rest, a quiet tint of their colour when on. They come in rows, and a row of
 * raised pills reads as clutter, so the depth stays on the surfaces around them.
 */
export function Chip({
  label, active, color, onPress, small, icon,
}: { label: string; active?: boolean; color?: string; onPress?: () => void; small?: boolean; icon?: any }) {
  const theme = useTheme();
  const c = color || C.accent;
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.94}
      radius={999}
      style={[
        st.chip,
        small && { paddingVertical: 4, paddingHorizontal: 10 },
        active
          ? { backgroundColor: c + '1F', borderColor: c + '66' }
          : { borderColor: theme === 'minimal' ? MIN.border : C.outline },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {icon ? (
          <Ionicons name={icon} size={small ? 13 : 15} color={active ? c : C.textFaint} style={{ marginRight: 6 }} />
        ) : null}
        <Text style={[st.chipText, small && { fontSize: 12 }, active && { color: c, fontFamily: F.semi }]}>{label}</Text>
      </View>
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
export function IconBtn({ name, onPress, color = C.textDim, size = 22, style, pad = 8, accessibilityLabel }: {
  name: any; onPress?: () => void; color?: string; size?: number; style?: ViewStyle; pad?: number;
  /** what the button does, for a screen reader: an icon alone says nothing */
  accessibilityLabel?: string;
}) {
  return (
    <Bouncy
      onPress={onPress} scaleTo={0.85} hitSlop={6} radius={999} style={[{ padding: pad }, style]}
      accessibilityLabel={accessibilityLabel} accessibilityRole={accessibilityLabel ? 'button' : undefined}
    >
      <Ionicons name={name} size={size} color={color} />
    </Bouncy>
  );
}

/** Raised circular action button (kit button geometry). `active` carves in. */
export function NeuIconBtn({ name, onPress, color, size = 20, dim = 44, active, style, accessibilityLabel }: {
  name: any; onPress?: () => void; color?: string; size?: number; dim?: number;
  active?: boolean; style?: ViewStyle; accessibilityLabel?: string;
}) {
  const theme = useTheme();
  const c = color || C.accent;
  return (
    <Bouncy
      onPress={onPress}
      scaleTo={0.9}
      radius={dim / 2}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityLabel ? 'button' : undefined}
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
 * (overflow hidden — the knob's light and shadow are CLIPPED at the track's
 * rim, the rule for every raised part inside a carved well) → raised knob,
 * filled with the accent when on.
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
              { backgroundColor: value ? c : C.knob },
              theme === 'minimal' && { boxShadow: undefined },
              thumbStyle,
            ]}
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * A text field drawn as a line: an optional label above, the text, and a hairline underneath. While you type, an
 * accent line grows over the hairline from the left. Layout props go to the wrapper.
 */
export function Field({ label, ...props }: React.ComponentProps<typeof TextInput> & { style?: any; label?: string }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const [focused, setFocused] = React.useState(false);
  const on = useSharedValue(0);
  React.useEffect(() => {
    on.value = level === 'none' ? (focused ? 1 : 0) : withTiming(focused ? 1 : 0, { duration: focused ? 220 : 160 });
  }, [focused, level]);
  const lineStyle = useAnimatedStyle(() => ({ opacity: on.value, transform: [{ scaleX: on.value }] }));
  const flat = StyleSheet.flatten(props.style) || {};
  const {
    flex, width, minWidth, maxWidth, alignSelf,
    margin, marginBottom, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    ...innerStyle
  } = flat as any;
  const wrapStyle: any = {
    flex, width, minWidth, maxWidth, alignSelf, margin, marginTop, marginLeft, marginRight, marginHorizontal, marginVertical,
    marginBottom: marginBottom !== undefined ? marginBottom : 14,
  };
  return (
    <View style={wrapStyle}>
      {label ? <Text style={st.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={C.textFaint}
        selectionColor={C.accent}
        {...props}
        onFocus={(e) => { setFocused(true); props.onFocus?.(e); }}
        onBlur={(e) => { setFocused(false); props.onBlur?.(e); }}
        style={[st.fieldInner, innerStyle]}
      />
      <View style={[st.fieldLine, { backgroundColor: theme === 'minimal' ? MIN.border : C.borderBright }]}>
        <Animated.View pointerEvents="none" style={[st.fieldLineOn, { backgroundColor: C.accent }, lineStyle]} />
      </View>
    </View>
  );
}

/**
 * What an empty list says: a carved icon well, one line in the text colour, an optional quieter line, and at
 * most one way forward. `compact` sits inside a card.
 */
export function EmptyState({ icon, title, body, actionLabel, onAction, compact }: {
  icon: any; title: string; body?: string; actionLabel?: string; onAction?: () => void; compact?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={[st.emptyWrap, compact && { marginVertical: 14 }]}>
      <View
        style={[
          st.emptyWell,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('low') },
        ]}
      >
        <Ionicons name={icon} size={22} color={C.textFaint} />
      </View>
      <Text style={st.emptyTitle}>{title}</Text>
      {body ? <Text style={st.emptyBody}>{body}</Text> : null}
      {actionLabel && onAction ? <PillButton small outline label={actionLabel} onPress={onAction} style={{ marginTop: 14 }} /> : null}
    </View>
  );
}

/** A carved hairline track with a sprung accent fill. No glow: one accent, lit by the material. */
export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const v = Math.min(1, Math.max(0, value));
  const w = useSharedValue(v);
  React.useEffect(() => {
    // an ease, not a spring: a bar that moves every second (Deep Work) must step, never bounce
    w.value = level === 'none' ? v : withTiming(v, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [v, level]);
  const trackW = useSharedValue(0);
  // a full-width fill slides in from the left: a transform, so no layout pass per frame. Hidden until the track
  // has measured, so it never flashes full on its first frame
  const fillStyle = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: (w.value - 1) * trackW.value }],
  }));
  return (
    <View
      onLayout={(e) => { trackW.value = e.nativeEvent.layout.width; }}
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...neuInset('hairline') },
      ]}
    >
      <Animated.View
        style={[
          {
            height: height - 2, borderRadius: height / 2, backgroundColor: c, margin: 1,
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
  visible, onClose, onClosed, title, children,
}: {
  visible: boolean; onClose: () => void; title?: string; children: React.ReactNode;
  /** runs once the sheet has finished closing: the moment to open another sheet or show a toast */
  onClosed?: () => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const { height: winH, width: winW } = useWindowDimensions();
  // on a wide window a sheet keeps a phone's proportions: at most 560 wide, centred, still rising from the bottom
  const narrowPanel = winW >= WIDE_AT ? st.sheetWide : null;
  // the panel's fixed chrome (padding 22 + paddingBottom 36 + handle 21 +
  // title 38, about 120dp) sits OUTSIDE this scroller, so the cap has to come
  // off the screen — a flat 540 pushed the primary button below a short display
  const scrollMax = Math.min(540, Math.max(220, winH * 0.72 - 120));
  const [render, setRender] = React.useState(visible);
  const prog = useSharedValue(visible ? 1 : 0);
  const drag = useSharedValue(0);
  const closedRef = React.useRef(onClosed);
  closedRef.current = onClosed;
  const finishClose = React.useCallback(() => {
    setRender(false);
    closedRef.current?.();
  }, []);
  React.useEffect(() => {
    if (visible) {
      drag.value = 0;
      setRender(true);
      tap();
      if (level === 'none') { prog.value = 1; }
      else { prog.value = 0; prog.value = withSpring(1, RISE_OUT); }
    } else if (render) {
      if (level === 'none') { prog.value = 0; finishClose(); }
      else {
        prog.value = withTiming(0, { duration: 200 }, (fin) => {
          if (fin) runOnJS(finishClose)();
        });
      }
    }
  }, [visible]);
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, prog.value) }));
  // NOTE: the panel keeps full opacity — only the slide is animated. (An
  // animated panel opacity read as a "transparent popup" bug on device.)
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - prog.value) * 64 + drag.value }],
  }));
  // a pull on the handle or the title follows the finger; far enough, or flicked, it closes the sheet
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const requestClose = React.useCallback(() => closeRef.current(), []);
  const pull = React.useMemo(() => Gesture.Pan()
    .activeOffsetY(8)
    .onUpdate((e) => { drag.value = Math.max(0, e.translationY); })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 900) runOnJS(requestClose)();
      else drag.value = withSpring(0, RISE_OUT);
    }), [requestClose]);
  if (!render) return null;
  // statusBarTranslucent: app.json runs a translucent status bar, so the modal's
  // own window has to span it too — without it the dialog content view starts
  // below the bar and the backdrop leaves an undimmed strip across the top
  return (
    <Modal visible transparent statusBarTranslucent animationType="none" onRequestClose={onClose}>
      {/* a modal is its own window: gestures inside it need their own root */}
      <GestureHandlerRootView style={{ flex: 1 }}>
      <Animated.View style={[st.sheetOverlay, backdropStyle]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.View style={[st.sheet, narrowPanel, theme === 'minimal' && { backgroundColor: MIN.card, borderColor: MIN.border, boxShadow: undefined }, panelStyle]}>
          {/* minimal has no shadow to define the handle, so the FILL has to
              carry it — C.inset on MIN.card is all but invisible */}
          <GestureDetector gesture={pull}>
            <View collapsable={false} style={st.grab}>
              <View style={[st.sheetHandle, theme === 'minimal' ? { backgroundColor: MIN.border } : neuInset('hairline')]} />
              {title ? <Text style={st.sheetTitle}>{title}</Text> : null}
            </View>
          </GestureDetector>
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
      </GestureHandlerRootView>
    </Modal>
  );
}

export function DotMenu({
  visible, onClose, items,
}: {
  visible: boolean; onClose: () => void;
  items: { label: string; icon: any; color?: string; onPress: () => void }[];
}) {
  // the chosen action runs once the menu has closed, so a sheet it opens or a toast it shows is never behind it
  const pending = React.useRef<(() => void) | null>(null);
  return (
    <Sheet visible={visible} onClose={onClose} onClosed={() => { const run = pending.current; pending.current = null; run?.(); }}>
      {items.map((it, i) => (
        <Bouncy
          key={i}
          onPress={() => { pending.current = it.onPress; onClose(); }}
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

/* ---------------------------------------------------------------- lists: one card per list */

/** room a list card's slices leave for its light (top) and shadow (bottom), and how far a slice runs past a seam */
const SLICE_TOP = 12;
const SLICE_BOTTOM = 20;
const SLICE_OVERLAP = 40;

/**
 * One raised card that holds a whole list, with hairlines between its rows, so a list reads as one object instead of
 * a stack of cards. Rows fold in and out, and the card follows their height.
 */
export function ListCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  const level = useAnimLevel();
  const rows = React.Children.toArray(children);
  // rows added or removed later fold in and out; the rows the card is built with are simply there
  const built = React.useRef(false);
  React.useEffect(() => { built.current = true; }, []);
  // an eased glide, not a spring: nested springs overshoot against each other and read as a wobble
  const layout = level === 'full' ? LinearTransition.duration(260).easing(Easing.out(Easing.cubic)) : undefined;
  return (
    <Animated.View
      layout={layout}
      style={[
        st.cardBase, lst.card,
        theme === 'minimal'
          ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.card, ...neuRaised('mid') },
        style,
      ]}
    >
      {rows.map((row, i) => (
        <Animated.View
          key={(row as React.ReactElement).key ?? i}
          entering={level === 'none' || !built.current ? undefined : FadeIn.duration(220)}
          exiting={level === 'none' ? undefined : FadeOut.duration(150)}
          layout={layout}
        >
          {i > 0 ? <View style={lst.hair} /> : null}
          {row}
        </Animated.View>
      ))}
    </Animated.View>
  );
}

/**
 * A row's slice of one list card, for lists that virtualise and so cannot wrap their rows in a card. The first slice
 * owns the top corners and the last the bottom ones; each slice clips its shadow where it meets the next, so the list
 * still reads as one card with no seams. The list's content keeps its usual side padding.
 */
export function ListSlice({ first, last, enter = false, children }: {
  first: boolean; last: boolean;
  /** rows of the first screenful rise together, so the card arrives as one object */
  enter?: boolean;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const r = S.radius;
  // every slice of the first screenful rises on the same cue and the same curve, so the card arrives whole and no
  // seam opens between its slices
  const entrance = useEntrance(0, enter);
  return (
    <Animated.View style={[lst.clip, { paddingTop: first ? SLICE_TOP : 0, paddingBottom: last ? SLICE_BOTTOM : 0 }, entrance]}>
      <View
        pointerEvents="none"
        style={[
          lst.surface,
          {
            top: first ? SLICE_TOP : -SLICE_OVERLAP,
            bottom: last ? SLICE_BOTTOM : -SLICE_OVERLAP,
            borderTopLeftRadius: first ? r : 0, borderTopRightRadius: first ? r : 0,
            borderBottomLeftRadius: last ? r : 0, borderBottomRightRadius: last ? r : 0,
          },
          theme === 'minimal'
            ? {
              backgroundColor: MIN.card, borderColor: MIN.border, borderLeftWidth: 1, borderRightWidth: 1,
              borderTopWidth: first ? 1 : 0, borderBottomWidth: last ? 1 : 0,
            }
            : { backgroundColor: C.card, ...neuRaised('mid') },
        ]}
      />
      {first ? null : <View style={lst.hair} />}
      <View style={{ paddingTop: first ? 4 : 0, paddingBottom: last ? 4 : 0 }}>{children}</View>
    </Animated.View>
  );
}

/** A pressable row inside a list card: it stays in place and carves in while pressed. */
export function ListRow({ children, onPress, onLongPress, style }: {
  children: React.ReactNode; onPress?: () => void; onLongPress?: () => void; style?: ViewStyle | ViewStyle[];
}) {
  if (!onPress && !onLongPress) return <View style={[lst.row, style]}>{children}</View>;
  return (
    <Bouncy onPress={onPress} onLongPress={onLongPress} scaleTo={1} sink={false} radius={14} style={[lst.row, style]}>
      {children}
    </Bouncy>
  );
}

/** Text whose strike-through draws across it, line by line, when `done` turns on, and lifts away when it turns off. */
export function StrikeText({ done, style, wrapStyle, numberOfLines, children }: {
  done: boolean; style?: any; wrapStyle?: ViewStyle; numberOfLines?: number; children: React.ReactNode;
}) {
  const level = useAnimLevel();
  const [lines, setLines] = React.useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const p = useSharedValue(done ? 1 : 0);
  React.useEffect(() => {
    p.value = level === 'none'
      ? (done ? 1 : 0)
      : withTiming(done ? 1 : 0, { duration: done ? 340 : 180, easing: Easing.out(Easing.cubic) });
  }, [done, level]);
  const drawn = useAnimatedStyle(() => ({ opacity: p.value > 0.001 ? 1 : 0, transform: [{ scaleX: p.value }] }));
  return (
    <View style={wrapStyle}>
      <Text
        style={[style, done && { color: C.textFaint }]}
        numberOfLines={numberOfLines}
        onTextLayout={(e) => {
          const next = e.nativeEvent.lines.map((l) => ({ x: l.x, y: l.y, width: l.width, height: l.height }));
          setLines((prev) => (prev.length === next.length && prev.every((l, i) => l.width === next[i].width && l.y === next[i].y) ? prev : next));
        }}
      >
        {children}
      </Text>
      {lines.map((l, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[lst.strike, { left: l.x, top: l.y + l.height * 0.54, width: l.width }, drawn]}
        />
      ))}
    </View>
  );
}

const lst = StyleSheet.create({
  card: { paddingVertical: 4 },
  hair: { height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, marginHorizontal: 12 },
  clip: { overflow: 'hidden', marginHorizontal: -S.pad, paddingHorizontal: S.pad },
  surface: { position: 'absolute', left: S.pad, right: S.pad },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14 },
  strike: { position: 'absolute', height: 1.5, borderRadius: 1, backgroundColor: C.textFaint, transformOrigin: 'left' },
});

const st = StyleSheet.create({
  cardBase: {
    borderRadius: S.radius,
    marginBottom: S.gap,
    // no overflow clip: it would cut the raised shadow; images inside round their own corners
  },
  insetBase: {
    borderRadius: S.radiusSm,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: S.section, marginBottom: 14, paddingHorizontal: 2,
  },
  chip: {
    paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1,
    marginRight: 10, marginBottom: 10,
    overflow: 'hidden',
  },
  chipText: { color: C.textDim, fontFamily: F.med, fontSize: 13, letterSpacing: 0.1 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 13, paddingHorizontal: 20, borderRadius: 999,
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
  fieldLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 12, letterSpacing: 0.2, marginLeft: 2, marginBottom: 2 },
  fieldInner: {
    color: C.text, fontFamily: F.reg, paddingHorizontal: 2, paddingVertical: 10, fontSize: 15,
    marginBottom: 0,
  },
  fieldLine: { height: 1 },
  fieldLineOn: { position: 'absolute', left: 0, right: 0, top: -0.5, height: 2, transformOrigin: 'left' },
  emptyWrap: { alignItems: 'center', marginVertical: 24, paddingHorizontal: 16 },
  emptyWell: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { color: C.text, fontFamily: F.semi, fontSize: 15, textAlign: 'center' },
  emptyBody: {
    color: C.textFaint, fontFamily: F.reg, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 4, maxWidth: 300,
  },
  sheetOverlay: { flex: 1, backgroundColor: C.scrim },
  /** the handle and title: a taller target for the pull that closes a sheet */
  grab: { marginTop: -12, paddingTop: 12 },
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: 30, borderTopRightRadius: 30,
    padding: 24, paddingBottom: 40,
    borderTopWidth: 1.5, borderColor: C.lite,
    boxShadow: SH.sheetLift,
  },
  sheetWide: { width: '100%', maxWidth: 560, alignSelf: 'center' },
  sheetHandle: {
    alignSelf: 'center', width: 44, height: 5, borderRadius: 3,
    backgroundColor: C.inset, marginBottom: 18,
    ...neuInset('hairline'),
  },
  sheetTitle: { color: C.text, fontFamily: F.bold, fontSize: 22, letterSpacing: -0.3, marginBottom: 18 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.hairline,
  },
});
