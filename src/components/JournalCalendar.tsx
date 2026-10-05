import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { C, F, T, TRACK } from '../theme';
import { NeuIconBtn, useTheme } from './UI';
import { Bouncy, EASE_OUT, shiftIn, useAnimLevel } from './Motion';
import { tick } from '../haptics';
import { keyToDate } from '../journal';
import { todayKey } from '../utils';
import { WIDE_AT } from '../layout';

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CELL = 40;

/**
 * A month of days, kept flat: a day with an entry carries a small dot, the picked day wears an accent ring, and
 * days outside `minKey`..`maxKey` (either may be left open) cannot be picked. Only the month arrows are raised. A
 * new month glides in from the side it was reached from. With no day picked (`value` empty) it opens on this month.
 */
export function JournalCalendar({ value, onPick, marked, maxKey, minKey }: {
  value: string; onPick: (key: string) => void; marked?: Set<string>; maxKey?: string; minKey?: string;
}) {
  useTheme(); // repaints on a new accent: the ring and the picked day read it
  const level = useAnimLevel();
  const wideWin = useWindowDimensions().width >= WIDE_AT;
  const start = keyToDate(value || todayKey());
  const [ym, setYm] = React.useState({ y: start.getFullYear(), m: start.getMonth() });
  React.useEffect(() => {
    if (!value) return;
    const d = keyToDate(value);
    dir.current = 0;
    setYm((cur) => (cur.y === d.getFullYear() && cur.m === d.getMonth() ? cur : { y: d.getFullYear(), m: d.getMonth() }));
  }, [value]);

  // the side the new month was reached from; 0 when it was set from outside (it is simply there)
  const dir = React.useRef<0 | 1 | -1>(0);

  const max = maxKey ? keyToDate(maxKey) : null;
  const min = minKey ? keyToDate(minKey) : null;
  const atLatestMonth = !!max && (ym.y > max.getFullYear() || (ym.y === max.getFullYear() && ym.m >= max.getMonth()));
  const atEarliestMonth = !!min && (ym.y < min.getFullYear() || (ym.y === min.getFullYear() && ym.m <= min.getMonth()));
  const shift = (step: 1 | -1) => {
    if (step === 1 && atLatestMonth) return;
    if (step === -1 && atEarliestMonth) return;
    tick();
    dir.current = step;
    setYm(({ y, m }) => {
      const d = new Date(y, m + step, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  };
  // the month is keyed, so its entrance runs as the new days mount: setting shared values beforehand slid the old
  // month for a frame before the new one had rendered
  const monthIn = level === 'none' || !dir.current ? undefined
    : level === 'full' ? shiftIn(dir.current * 24) : FadeIn.duration(180).easing(EASE_OUT);

  const first = new Date(ym.y, ym.m, 1);
  const monthKey = ym.y * 12 + ym.m;
  const lead = (first.getDay() + 6) % 7; // Monday first
  const days = new Date(ym.y, ym.m + 1, 0).getDate();
  const today = todayKey();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);

  return (
    <View style={wideWin ? st.root : undefined}>
      <View style={st.head}>
        <NeuIconBtn
          name="chevron-back" dim={36} size={17}
          color={atEarliestMonth ? C.textFaint : C.textDim}
          style={atEarliestMonth ? { opacity: 0.4 } : undefined}
          onPress={() => shift(-1)}
          accessibilityLabel="Previous month"
        />
        <Animated.Text key={monthKey} entering={monthIn} style={[T.title, { flex: 1, textAlign: 'center' }]}>
          {first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </Animated.Text>
        <NeuIconBtn
          name="chevron-forward" dim={36} size={17}
          color={atLatestMonth ? C.textFaint : C.textDim}
          style={atLatestMonth ? { opacity: 0.4 } : undefined}
          onPress={() => shift(1)}
          accessibilityLabel="Next month"
        />
      </View>

      <View style={st.row}>
        {WEEKDAYS.map((w, i) => (
          <View key={i} style={st.cellBox}>
            <Text style={st.weekday}>{w}</Text>
          </View>
        ))}
      </View>

      <Animated.View key={monthKey} entering={monthIn} style={[st.row, { flexWrap: 'wrap' }]}>
        {cells.map((day, i) => {
          if (day == null) return <View key={i} style={st.cellBox} />;
          const key = todayKey(new Date(ym.y, ym.m, day));
          const selected = key === value;
          const hasEntry = !!marked?.has(key);
          const outside = (!!maxKey && key > maxKey) || (!!minKey && key < minKey);
          return (
            <View key={i} style={st.cellBox}>
              <Bouncy
                disabled={outside}
                onPress={() => { tick(); onPick(key); }}
                scaleTo={0.9}
                radius={CELL / 2}
                style={[st.cell, selected ? { borderColor: C.accent } : null, outside ? { opacity: 0.35 } : null]}
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
  /** a month keeps a phone's proportions in a wide sheet (a phone's month spans its sheet as it always has) */
  root: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  row: { flexDirection: 'row' },
  cellBox: { width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  weekday: { color: C.textFaint, fontFamily: F.semi, fontSize: 11, letterSpacing: TRACK.fine },
  cell: {
    width: CELL, height: CELL, borderRadius: CELL / 2, borderWidth: 1.5, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  day: { color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small, fontVariant: ['tabular-nums'] },
  mark: { position: 'absolute', bottom: 6, width: 4, height: 4, borderRadius: 2, backgroundColor: C.gold },
});
