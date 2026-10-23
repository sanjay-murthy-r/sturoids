import React from 'react';
import { Pressable, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, CHROME_FONT_MAX, F, MIN, TRACK, neuInset, neuRaised, oneLine } from '../theme';
import { useTheme } from './UI';
import { CHANGE, RISE_OUT, useAnimLevel } from './Motion';
import { tick } from '../haptics';

/** a segment's reach grows above and below to the rows' rhythm; its sides already meet the next segment */
const SEG_SLOP = { top: 6, bottom: 6 };

/**
 * Kit segmented control: carved trough + a raised thumb that springs to the
 * active segment. Replaces every ad-hoc `st.seg` in the app. Each segment is a button that says whether it is the
 * chosen one.
 */
export function SegmentedControl<K extends string>({
  options, value, onChange, onPressActive, color, size = 'md', stretch, height, style,
}: {
  options: { key: K; label: string; icon?: any }[];
  value: K;
  onChange: (k: K) => void;
  /** a tap on the segment that is already chosen, e.g. to edit a custom value */
  onPressActive?: (k: K) => void;
  color?: string;
  size?: 'sm' | 'md';
  /** fill the row — each segment takes equal width */
  stretch?: boolean;
  /** a fixed height, to line up with the controls beside it (the segments centre their names in it) */
  height?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const c = color || C.accent;
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const sx = useSharedValue(1);
  const layouts = React.useRef<Record<string, { x: number; width: number }>>({}).current;
  const place = React.useCallback((animate: boolean) => {
    const l = layouts[value];
    if (!l) return;
    if (animate && level !== 'none' && w.value > 0) {
      // the thumb takes its new width at once and springs its scale from the old width: only transforms move
      sx.value = w.value / l.width;
      w.value = l.width;
      sx.value = withSpring(1, RISE_OUT);
      x.value = withSpring(l.x, RISE_OUT);
    } else {
      x.value = l.x;
      w.value = l.width;
      sx.value = 1;
    }
  }, [value, level]);
  React.useEffect(() => { place(true); }, [value]);
  const thumbStyle = useAnimatedStyle(() => ({
    width: w.value,
    transform: [{ translateX: x.value }, { scaleX: sx.value }] as const,
  }));

  const padV = size === 'sm' ? 7 : 9;
  const padH = size === 'sm' ? 12 : 16;
  const fontSize = size === 'sm' ? 12 : 13;

  return (
    <View
      style={[
        {
          flexDirection: 'row', padding: 4, borderRadius: 999,
          alignSelf: stretch ? 'stretch' : 'flex-start',
          height,
          // the thumb is raised inside the carved trough, so the trough clips its light and shadow at the rim
          overflow: 'hidden',
        },
        theme === 'minimal'
          ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
          : { backgroundColor: C.inset, ...neuInset('low') },
        style as any,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          { position: 'absolute', left: 0, top: 4, bottom: 4, borderRadius: 999, transformOrigin: 'left' },
          theme === 'minimal'
            ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: c }
            : { backgroundColor: C.card, ...neuRaised('low') },
          thumbStyle,
        ]}
      />
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            hitSlop={SEG_SLOP}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (!active) { tick(); onChange(o.key); } else onPressActive?.(o.key);
            }}
            onLayout={(e) => {
              layouts[o.key] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
              if (active) place(false);
            }}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              // equal stretched segments centre their label, so padding only eats the room a narrow screen needs
              paddingVertical: height ? 0 : padV, paddingHorizontal: stretch ? 4 : padH, borderRadius: 999,
              flex: stretch ? 1 : undefined,
            }}
          >
            <SegLabel active={active} label={o.label} icon={o.icon} color={c} size={fontSize} />
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A segment's name and icon: the muted and the chosen inks cross over while the thumb travels, instead of the new
 * segment lighting up the moment it is tapped. Both inks share one face, so they lie exactly over each other.
 */
function SegLabel({ active, label, icon, color, size }: {
  active: boolean; label: string; icon?: any; color: string; size: number;
}) {
  const level = useAnimLevel();
  const on = useSharedValue(active ? 1 : 0);
  React.useEffect(() => {
    on.value = level === 'none' ? (active ? 1 : 0) : withTiming(active ? 1 : 0, CHANGE);
  }, [active, level]);
  const lit = useAnimatedStyle(() => ({ opacity: on.value }));
  const unlit = useAnimatedStyle(() => ({ opacity: 1 - on.value }));
  // the stretched segments are tight, so both sizes take the 13 to 14 px value. A segment's name is its control's
  // primary label, in Inter Tight; the font padding is dropped and the line set, so it centres truly in the segment
  const text = React.useMemo(() => ({ ...oneLine(size), fontFamily: F.med, letterSpacing: TRACK.small }), [size]);
  return (
    <>
      {icon ? (
        <View>
          <Animated.View style={unlit}><Ionicons name={icon} size={size + 1} color={C.textFaint} /></Animated.View>
          <Animated.View style={[ink, lit]}><Ionicons name={icon} size={size + 1} color={color} /></Animated.View>
        </View>
      ) : null}
      {/* fixed chrome: the segments share one row, so their names grow with the phone's font size only up to 1.3 */}
      <View style={{ flexShrink: 1 }}>
        <Animated.Text numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX} style={[text, { color: C.textFaint }, unlit]}>{label}</Animated.Text>
        <Animated.Text
          numberOfLines={1} maxFontSizeMultiplier={CHROME_FONT_MAX} style={[text, ink, { color }, lit]}
          importantForAccessibility="no" accessibilityElementsHidden
        >
          {label}
        </Animated.Text>
      </View>
    </>
  );
}

const ink = { position: 'absolute' as const, top: 0, left: 0, right: 0 };
