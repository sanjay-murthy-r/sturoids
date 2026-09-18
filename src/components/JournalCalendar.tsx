import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { C, F, T } from '../theme';
import { NeuIconBtn, useTheme } from './UI';
import { Bouncy, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { keyToDate } from '../journal';
import { todayKey } from '../utils';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL = 40;

/**
 * A month of days, kept flat: a day with an entry carries a small dot, the picked day wears an accent ring, and
 * days after `maxKey` cannot be picked. Only the month arrows are raised. A new month glides in from the side it
 * was reached from.
 */
export function JournalCalendar({ value, onPick, marked, maxKey }: {
  value: string; onPick: (key: string) => void; marked: Set<string>; maxKey: string;
}) {
  useTheme(); // repaints on a new accent: the ring and the picked day read it
  const level = useAnimLevel();
  const start = keyToDate(value);
  const [ym, setYm] = React.useState({ y: start.getFullYear(), m: start.getMonth() });
  React.useEffect(() => {
    const d = keyToDate(value);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  }, [value]);

  const slide = useSharedValue(0);
  const fade = useSharedValue(1);
  const monthStyle = useAnimatedStyle(() => ({ opacity: fade.value, transform: [{ translateX: slide.value * 24 }] }));

  const max = keyToDate(maxKey);
  const atLatestMonth = ym.y > max.getFullYear() || (ym.y === max.getFullYear() && ym.m >= max.getMonth());
  const shift = (dir: 1 | -1) => {
    if (dir === 1 && atLatestMonth) return;
    tick();
    setYm(({ y, m }) => {
      const d = new Date(y, m + dir, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
    if (level === 'none') return;
    const enter = { duration: 280, easing: Easing.out(Easing.cubic) };
    slide.value = withSequence(withTiming(dir, { duration: 0 }), withTiming(0, enter));
    fade.value = withSequence(withTiming(0.25, { duration: 0 }), withTiming(1, enter));
  };

  const first = new Date(ym.y, ym.m, 1);
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const today = todayKey();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <View>
      <View style={st.head}>
        <NeuIconBtn name="chevron-back" dim={36} size={17} color={C.textDim} onPress={() => shift(-1)} />
        <Animated.Text style={[T.title, { flex: 1, textAlign: 'center' }, monthStyle]}>
          {first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </Animated.Text>
        <NeuIconBtn
          name="chevron-forward" dim={36} size={17}
          color={atLatestMonth ? C.textFaint : C.textDim}
          style={atLatestMonth ? { opacity: 0.4 } : undefined}
          onPress={() => shift(1)}
        />
      </View>

      <View style={st.row}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={st.cellBox}>
            <Text style={st.weekday}>{w}</Text>
          </View>
        ))}
      </View>

      <Animated.View style={[st.row, { flexWrap: 'wrap' }, monthStyle]}>
        {cells.map((day, i) => {
          if (day == null) return <View key={i} style={st.cellBox} />;
          const key = todayKey(new Date(ym.y, ym.m, day));
          const selected = key === value;
          const hasEntry = marked.has(key);
          const future = key > maxKey;
          return (
            <View key={i} style={st.cellBox}>
              <Bouncy
                disabled={future}
                onPress={() => { tick(); onPick(key); }}
                scaleTo={0.9}
                radius={CELL / 2}
                style={[st.cell, selected ? { borderColor: C.accent } : null, future ? { opacity: 0.35 } : null]}
              >
                <Text
                  style={[
                    st.day,
                    key === today && { color: C.text, fontFamily: F.semi },
                    selected && { color: C.accent, fontFamily: F.semi },
                  ]}
                >
                  {day}
                </Text>
                {hasEntry && !selected ? <View style={st.mark} /> : null}
              </Bouncy>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  row: { flexDirection: 'row' },
  cellBox: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  weekday: { color: C.textFaint, fontFamily: F.semi, fontSize: 11, letterSpacing: 0.6 },
  cell: {
    width: CELL, height: CELL, borderRadius: CELL / 2, borderWidth: 1.5, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  day: { color: C.textDim, fontFamily: F.med, fontSize: 14, fontVariant: ['tabular-nums'] },
  mark: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: C.gold },
});
