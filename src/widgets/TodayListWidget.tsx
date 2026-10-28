import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated from 'react-native-reanimated';
import { C, F, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { todayKey } from '../utils';
import { shiftKey } from '../journal';
import {
  Card, CheckCircle, DotMenu, EmptyState, ListCard, ListRow, ProgressBar, Row, SectionTitle, StrikeText,
} from '../components/UI';
import { useSwapIn } from '../components/Swap';
import { QuickTaskSheet, shortClock } from '../components/QuickTaskSheet';
import { toast } from '../components/Toast';
import { tap } from '../haptics';
import { openTool } from '../toolNav';
import { LINK_SLOP, kit, useBoardToday } from './kit';
import { useTodayItems } from './data';
import type { TodayItem } from './logic';
import type { WidgetProps } from './types';

/**
 * Today's list: the ToDos due today and the long-term tasks due today or late, timed ones by their time and the rest
 * after; a row ticked off sinks to the end once its strike has drawn. A hold on a row opens its menu (Edit, Focus on
 * this, and Move to tomorrow for a long-term task); a late task also offers Tomorrow on its row, with an Undo.
 */
export function TodayListWidget({ preview }: WidgetProps) {
  const today = useBoardToday();
  const items = useTodayItems();
  const hour24 = useStore((s) => s.settings.hour24);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const toggleMission = useStore((s) => s.toggleMission);
  const [sheet, setSheet] = React.useState(false);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [menu, setMenu] = React.useState<TodayItem | null>(null);
  // the row the menu is for is kept while the menu closes, so its words never change mid-way
  const [menuFor, setMenuFor] = React.useState<TodayItem | null>(null);
  const doneCount = items.filter((t) => t.done).length;
  // the first ToDo takes the place of the empty note, and the last one done away with gives it back
  const listIn = useSwapIn(items.length === 0 ? 'none' : 'list');

  const editingTask = React.useMemo(() => {
    if (!editing) return null;
    const s = useStore.getState();
    return s.dailyTasks.find((t) => t.id === editing) ?? s.missions.find((m) => m.id === editing) ?? null;
  }, [editing, sheet]);

  const openMenu = React.useCallback((t: TodayItem) => {
    tap();
    setMenuFor(t);
    setMenu(t);
  }, []);
  const moveToTomorrow = React.useCallback((id: string) => moveMissionToTomorrow(id, today), [today]);

  const menuItems = menuFor ? [
    { label: 'Edit', icon: 'create-outline', onPress: () => { setEditing(menuFor.id); setSheet(true); } },
    { label: 'Focus on this', icon: 'timer-outline', onPress: () => openTool('focus', { subject: menuFor.title }) },
    ...(menuFor.kind === 'mission' && !menuFor.done
      ? [{ label: 'Move to tomorrow', icon: 'arrow-forward-circle-outline', onPress: () => moveToTomorrow(menuFor.id) }]
      : []),
  ] : [];

  return (
    <View>
      <SectionTitle
        right={preview ? undefined : (
          <Row style={{ gap: 20 }}>
            <Pressable
              onPress={() => { setEditing(null); setSheet(true); }} hitSlop={LINK_SLOP}
              accessibilityRole="button" accessibilityLabel="Add a task"
            >
              <Text style={[kit.link, { color: C.accent }]}>Add</Text>
            </Pressable>
            <Pressable onPress={() => openTool('tasks')} hitSlop={LINK_SLOP} accessibilityRole="button" accessibilityLabel="All tasks">
              <Text style={[kit.link, { color: C.accent }]}>All tasks →</Text>
            </Pressable>
          </Row>
        )}
      >
        Today {items.length > 0 ? '· ' + doneCount + '/' + items.length : ''}
      </SectionTitle>
      {/* an empty list has no progress to show; the bar comes up with the first ToDo, as the list does */}
      {items.length > 0 ? (
        <Animated.View entering={listIn} style={{ marginTop: 2, marginBottom: 16 }}>
          <ProgressBar value={doneCount / items.length} />
        </Animated.View>
      ) : null}
      <Animated.View key={items.length === 0 ? 'none' : 'list'} entering={listIn}>
        {items.length === 0 ? (
          <Card pad={6}>
            <EmptyState
              compact icon="checkbox-outline" title="Nothing on the list yet" body="ToDos and tasks due today show here."
              actionLabel="Add a ToDo" onAction={() => { setEditing(null); setSheet(true); }}
            />
          </Card>
        ) : (
          <TodayList
            items={items} hour24={hour24} onToggleDaily={toggleDaily} onToggleMission={toggleMission}
            onMenu={openMenu} onTomorrow={moveToTomorrow}
          />
        )}
      </Animated.View>
      {preview ? null : (
        <>
          <QuickTaskSheet visible={sheet} onClose={() => setSheet(false)} editing={editingTask} />
          <DotMenu visible={!!menu} onClose={() => setMenu(null)} title={menuFor?.title} items={menuItems} />
        </>
      )}
    </View>
  );
}

/** A late long-term task moved to tomorrow, with an Undo that puts its deadline back. */
function moveMissionToTomorrow(id: string, today: string) {
  const s = useStore.getState();
  const m = s.missions.find((x) => x.id === id);
  if (!m) return;
  const was = m.deadline;
  const to = shiftKey(today || todayKey(), 1);
  if (was === to) return;
  s.updateMission(id, { deadline: to });
  toast('Moved to tomorrow', {
    label: 'Undo',
    onPress: () => {
      const now = useStore.getState().missions.find((x) => x.id === id);
      // changed again since: the Undo has nothing of its own to put back
      if (now && now.deadline === to) useStore.getState().updateMission(id, { deadline: was });
    },
  });
}

/** about how long a tick's strike takes to draw (StrikeText): the row waits for it before it sinks */
const SINK_AFTER = 600;
const itemKey = (t: TodayItem) => t.kind + t.id;

/**
 * The rows. Its own component, so the minute changing on Today leaves them alone. A row ticked off stays where it is
 * while its strike draws, then glides to the end of the list (the card's own eased glide), so what is left to do stays
 * on top; unticked, it comes straight back up to its place. Rows already done when the list is built start at the end.
 */
const TodayList = React.memo(function TodayList({ items, hour24, onToggleDaily, onToggleMission, onMenu, onTomorrow }: {
  items: TodayItem[]; hour24: boolean; onToggleDaily: (id: string) => void; onToggleMission: (id: string) => void;
  onMenu: (t: TodayItem) => void; onTomorrow: (id: string) => void;
}) {
  const [sunk, setSunk] = React.useState<ReadonlySet<string>>(() => new Set(items.filter((t) => t.done).map(itemKey)));
  const sunkRef = React.useRef(sunk);
  sunkRef.current = sunk;
  // one wait per row on its way down, called off if it is unticked before it sinks
  const waits = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());
  React.useEffect(() => {
    const done = new Set(items.filter((t) => t.done).map(itemKey));
    // unticked (or gone from the list): back up at once, and no longer waiting to sink
    for (const [k, timer] of waits.current) {
      if (!done.has(k)) { clearTimeout(timer); waits.current.delete(k); }
    }
    setSunk((cur) => {
      let same = true;
      for (const k of cur) if (!done.has(k)) { same = false; break; }
      return same ? cur : new Set([...cur].filter((k) => done.has(k)));
    });
    for (const k of done) {
      if (sunkRef.current.has(k) || waits.current.has(k)) continue;
      waits.current.set(k, setTimeout(() => {
        waits.current.delete(k);
        setSunk((cur) => (cur.has(k) ? cur : new Set(cur).add(k)));
      }, SINK_AFTER));
    }
  }, [items]);
  React.useEffect(() => () => {
    for (const timer of waits.current.values()) clearTimeout(timer);
    waits.current.clear();
  }, []);
  const ordered = React.useMemo(
    () => [...items.filter((t) => !sunk.has(itemKey(t))), ...items.filter((t) => sunk.has(itemKey(t)))],
    [items, sunk],
  );
  return (
    <ListCard>
      {ordered.map((t) => (
        <TodayRow
          key={itemKey(t)} item={t} kind={t.kind} id={t.id} title={t.title} done={t.done} overdue={t.overdue} time={t.time}
          hour24={hour24} onToggleDaily={onToggleDaily} onToggleMission={onToggleMission} onMenu={onMenu} onTomorrow={onTomorrow}
        />
      ))}
    </ListCard>
  );
});

/** One of today's rows. Memoised on plain values, so ticking one re-renders that row alone. */
const TodayRow = React.memo(function TodayRow({
  item, kind, id, title, done, overdue, time, hour24, onToggleDaily, onToggleMission, onMenu, onTomorrow,
}: Omit<TodayItem, never> & {
  item: TodayItem; hour24: boolean; onToggleDaily: (id: string) => void; onToggleMission: (id: string) => void;
  onMenu: (t: TodayItem) => void; onTomorrow: (id: string) => void;
}) {
  const by = time ? 'by ' + shortClock(time, hour24) : '';
  return (
    <ListRow onLongPress={() => onMenu(item)} accessibilityHint="Hold for more">
      <CheckCircle
        done={done}
        color={kind === 'mission' ? C.amber : C.green}
        onPress={() => (kind === 'daily' ? onToggleDaily(id) : onToggleMission(id))}
        label={title + (by ? ', ' + by : '')}
      />
      <StrikeText done={done} style={st.taskText} wrapStyle={st.taskWrap} numberOfLines={1}>{title}</StrikeText>
      {/* the time it is due by, quiet at the end of the row, as Tasks says it */}
      {by ? <Text style={st.byText} numberOfLines={1}>{by}</Text> : null}
      {/* a late task can be moved on from here, in one tap, with an Undo */}
      {kind === 'mission' && overdue && !done ? (
        <Pressable
          onPress={() => onTomorrow(id)} hitSlop={LINK_SLOP} style={st.tomorrow}
          accessibilityRole="button" accessibilityLabel={'Move ' + title + ' to tomorrow'}
        >
          <Text style={[st.tomorrowText, { color: C.accent }]}>Tomorrow</Text>
        </Pressable>
      ) : null}
      {/* a task past its deadline says so, as Tasks does, rather than looking like one due today */}
      {kind === 'mission' && (
        <View style={[st.missionPill, overdue && { backgroundColor: C.danger + '1C', borderColor: C.danger + '55' }]}>
          <Text style={[st.missionPillText, overdue && { color: C.danger }]}>{overdue ? 'OVERDUE' : 'DUE'}</Text>
        </View>
      )}
    </ListRow>
  );
});

const st = StyleSheet.create({
  taskWrap: { flex: 1, marginLeft: 12 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, letterSpacing: TRACK.body },
  missionPill: {
    backgroundColor: C.amber + '1C', borderColor: C.amber + '55', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  missionPillText: { color: C.amber, fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.caps },
  // a caption that only says a time ("by 5 pm"): Schibsted, its figures proportional
  byText: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, letterSpacing: TRACK.fine, marginLeft: 8 },
  tomorrow: { marginLeft: 8 },
  tomorrowText: { fontFamily: F.smSemi, ...oneLine(12), letterSpacing: TRACK.small },
});
