import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F } from '../theme';
import { useStore } from '../store';
import { openTool } from '../toolNav';
import { Ring, SeenCount, TILE_TEXT_MAX, Tile, kit, spokenMinutes } from './kit';
import { FadeSwap } from '../components/Motion';
import { useFocusToday, useTodayItems } from './data';
import type { WidgetProps } from './types';

/**
 * Day ring: two rings, the day's ToDos ticked against all of them, and inside it the minutes focused against the focus
 * goal (when one is set); in the middle, how many are left. Opens Tasks.
 */
export function DayRingWidget({ size }: WidgetProps) {
  const items = useTodayItems();
  const focus = useFocusToday();
  const goal = useStore((s) => s.settings.focusGoalMin || 0);
  const hideFocus = useStore((s) => s.settings.archivedTools.includes('focus'));
  const total = items.length;
  const left = items.filter((t) => !t.done).length;
  const showGoal = goal > 0 && !hideFocus;
  const label = (total ? (left ? left + ' of ' + total + ' left today' : 'All ' + total + ' done today') : 'Nothing due today')
    + (showGoal ? ', ' + spokenMinutes(focus) + ' of a ' + spokenMinutes(goal) + ' focus goal' : '');
  return (
    <Tile size={size} onPress={() => openTool('tasks')} label={label} hint="Opens Tasks" pad={12}>
      <View style={st.stage}>
        <View style={st.layer}><Ring size={104} stroke={9} value={total ? (total - left) / total : 0} color={C.accent} /></View>
        {showGoal ? <View style={st.layer}><Ring size={80} stroke={7} value={focus / goal} color={C.green} /></View> : null}
        <FadeSwap swapKey={total === 0 ? 'none' : left === 0 ? 'done' : 'left'} style={[st.layer, st.centre]}>
          {total === 0 ? (
            <Ionicons name="sunny-outline" size={22} color={C.textFaint} />
          ) : left === 0 ? (
            <Ionicons name="checkmark" size={26} color={C.green} />
          ) : (
            <>
              <SeenCount value={left} style={st.count} />
              <Text style={kit.sub} maxFontSizeMultiplier={TILE_TEXT_MAX}>left</Text>
            </>
          )}
        </FadeSwap>
      </View>
    </Tile>
  );
}

const st = StyleSheet.create({
  stage: { flex: 1 },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  centre: { gap: 0 },
  count: { ...kit.big, fontFamily: F.num, fontSize: 28, lineHeight: 32 },
});
