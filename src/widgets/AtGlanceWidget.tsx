import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C, T } from '../theme';
import { useStore } from '../store';
import { fmtClockTime, toMinutes } from '../utils';
import { openTool } from '../toolNav';
import { Kicker, MiniTick, TILE_TEXT_MAX, Tile, Track, kit, useBoardNow, useBoardToday } from './kit';
import { useNextBlock, useTodayItems, useTodaysHabits } from './data';
import { blockProgress } from './logic';
import type { WidgetProps } from './types';

/**
 * At a glance: the block on now (with how far through it the clock is) or next, three open ToDos ticked in place, and a
 * dot for each of today's habits, ticked in place too.
 */
export function AtGlanceWidget({ size }: WidgetProps) {
  const now = useBoardNow();
  const today = useBoardToday();
  const hour24 = useStore((s) => s.settings.hour24);
  const archived = useStore((s) => s.settings.archivedTools);
  const hidePlanner = archived.includes('planner');
  const hideTasks = archived.includes('tasks');
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const toggleHabit = useStore((s) => s.toggleHabitToday);
  const next = useNextBlock();
  const items = useTodayItems();
  const habits = useTodaysHabits();
  const open = items.filter((t) => !t.done).slice(0, 3);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const block = hidePlanner ? null : next;
  const left = block && block.tag === 'NOW' ? Math.max(0, toMinutes(block.block.end) - nowMin) : 0;
  const clock = (hhmm: string) => fmtClockTime(toMinutes(hhmm), hour24);

  return (
    <Tile size={size} pad={16}>
      <View style={st.row}>
        <Pressable
          style={st.left} onPress={() => openTool('planner')} accessibilityRole="button"
          accessibilityLabel={block ? (block.tag === 'NOW' ? 'Now, ' : block.tag === 'NEXT UP' ? 'Next, ' : 'Tomorrow, ') + block.block.subject : 'Nothing planned'}
          accessibilityHint="Opens the Planner"
        >
          {block ? (
            <>
              <Kicker color={C.accent}>
                {block.tag === 'NOW' ? 'Now · ' + clock(block.block.start) + ' – ' + clock(block.block.end)
                  : block.tag === 'NEXT UP' ? 'Next · ' + clock(block.block.start) : 'Tomorrow · ' + clock(block.block.start)}
              </Kicker>
              <Text style={[kit.name, { marginTop: 6 }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{block.block.subject}</Text>
              {block.tag === 'NOW' ? (
                <View style={{ marginTop: 8 }}>
                  <Track value={blockProgress(block.block, now)} color={block.block.color || C.accent} />
                  <Text style={[kit.sub, { marginTop: 5 }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{left} min left</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Kicker>Today</Kicker>
              <Text style={[kit.name, { marginTop: 6 }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>Nothing planned</Text>
            </>
          )}
          {!hidePlanner && habits.length ? (
            <View style={st.dots}>
              {habits.slice(0, 8).map((h) => {
                const done = h.doneDates.includes(today);
                return (
                  <Pressable
                    key={h.id} onPress={() => toggleHabit(h.id)} hitSlop={8}
                    accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={h.title}
                    style={[st.dot, done ? { backgroundColor: C.green } : { borderWidth: 1.5, borderColor: C.borderBright }]}
                  />
                );
              })}
            </View>
          ) : null}
        </Pressable>
        {hideTasks ? null : (
          <View style={st.right}>
            {open.length ? open.map((t) => (
              <Pressable
                key={t.kind + t.id} style={st.todo}
                onPress={() => (t.kind === 'daily' ? toggleDaily(t.id) : toggleMission(t.id))}
                accessibilityRole="checkbox" accessibilityState={{ checked: false }} accessibilityLabel={t.title}
              >
                <MiniTick done={false} color={t.kind === 'mission' ? C.amber : C.green} label={t.title} />
                <Text style={[kit.rowText, { marginLeft: 9 }]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>{t.title}</Text>
              </Pressable>
            )) : (
              <Text style={[T.caption, { marginTop: 4 }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{items.length ? 'All done today' : 'Nothing due today'}</Text>
            )}
          </View>
        )}
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', gap: 14 },
  left: { flex: 1, minWidth: 0 },
  right: { flex: 1, minWidth: 0, justifyContent: 'center', gap: 4 },
  todo: { flexDirection: 'row', alignItems: 'center', minHeight: 32 },
  dots: { flexDirection: 'row', gap: 9, marginTop: 'auto', alignItems: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
});
