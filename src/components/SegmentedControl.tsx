import React from 'react';
import { Pressable, Text, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { C, F, MIN, neuInset, neuRaised } from '../theme';
import { useTheme } from './UI';
import { RISE_OUT, useAnimLevel } from './Motion';
import { tick } from '../haptics';

/**
 * Kit segmented control: carved trough + a raised thumb that springs to the
 * active segment. Replaces every ad-hoc `st.seg` in the app.
 */
export function SegmentedControl<K extends string>({
  options, value, onChange, onPressActive, color, size = 'md', stretch, style,
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
            onPress={() => {
              if (!active) { tick(); onChange(o.key); } else onPressActive?.(o.key);
            }}
            onLayout={(e) => {
              layouts[o.key] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width };
              if (active) place(false);
            }}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
              paddingVertical: padV, paddingHorizontal: padH, borderRadius: 999,
              flex: stretch ? 1 : undefined,
            }}
          >
            {o.icon ? <Ionicons name={o.icon} size={fontSize + 1} color={active ? c : C.textFaint} /> : null}
            <Text style={{ fontFamily: F.med, fontSize, letterSpacing: 0.1, color: active ? c : C.textFaint }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
