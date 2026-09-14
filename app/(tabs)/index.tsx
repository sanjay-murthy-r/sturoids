import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { C, F, MIN, S, T, neuRaised, neuInset } from '../../src/theme';
import { useStore, QuickItem } from '../../src/store';
import { uid, fmtDate, todayKey, dayName, DAY_NAMES, toMinutes, fmtClockTime, daysUntil } from '../../src/utils';
import {
  ScreenBG, Card, SectionTitle, CheckCircle, Sheet, Field, PillButton, EmptyText, Row, Hairline, Chip, IconBtn,
  ProgressBar, useTheme,
} from '../../src/components/UI';
import { Enter, Bouncy, Pop, RISE_OUT, useAnimLevel, useFocusKey } from '../../src/components/Motion';
import { tap } from '../../src/haptics';
import { ROUTE_CATALOG, launchExternal } from '../../src/quickAccess';
import { ToolKey, colorOf } from '../../src/tools';
import { openTool } from '../../src/toolNav';
import { useGreeting } from '../../src/greeting';
import { journalDayFor } from '../../src/journal';
import { appListAvailable, getInstalledApps, InstalledApp } from '../../modules/app-list';

export default function Today() {
  const insets = useSafeAreaInsets();
  const fk = useFocusKey();
  const router = useRouter();
  const theme = useTheme();
  const settings = useStore((s) => s.settings);
  const setSetting = useStore((s) => s.setSetting);
  const dailyTasks = useStore((s) => s.dailyTasks);
  const toggleDaily = useStore((s) => s.toggleDaily);
  const missions = useStore((s) => s.missions);
  const toggleMission = useStore((s) => s.toggleMission);
  const habits = useStore((s) => s.habits);
  const toggleHabitToday = useStore((s) => s.toggleHabitToday);
  const planner = useStore((s) => s.planner);
  const sessions = useStore((s) => s.sessions);
  const quickAccess = useStore((s) => s.quickAccess);
  const journal = useStore((s) => s.journal);
  const setQuickAccess = useStore((s) => s.setQuickAccess);

  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.name);
  const [qaEdit, setQaEdit] = useState(false);
  const [qaAddSheet, setQaAddSheet] = useState(false);
  const [customPkg, setCustomPkg] = useState('');
  const [appQuery, setAppQuery] = useState('');
  const [installed, setInstalled] = useState<InstalledApp[]>([]);
  const [appsLoaded, setAppsLoaded] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const today = todayKey();

  const dueMissions = useMemo(
    () => missions.filter((m) => !m.done && daysUntil(m.deadline) <= 0),
    [missions]
  );
  const tasksLeft = dailyTasks.filter((t) => t.doneOn !== today).length + dueMissions.length;
  const habitsDone = habits.filter((h) => h.doneDates.includes(today)).length;
  const focusToday = Math.round(
    sessions.filter((s) => s.dateKey === today).reduce((a, s) => a + s.netSeconds, 0) / 60
  );

  const nextBlock = useMemo(() => {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const lateNight = now.getHours() >= 21;
    const dToday = dayName(now);
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    const dTomorrow = dayName(tomorrow);
    const sorted = (d: typeof dToday) =>
      [...(planner[d] || [])].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
    if (!lateNight) {
      const current = sorted(dToday).find((b) => toMinutes(b.start) <= nowMin && toMinutes(b.end) > nowMin);
      if (current) return { block: current, tag: 'NOW' };
      const next = sorted(dToday).find((b) => toMinutes(b.start) > nowMin);
      if (next) return { block: next, tag: 'NEXT UP' };
    }
    const first = sorted(dTomorrow)[0];
    if (first) return { block: first, tag: 'TOMORROW' };
    return null;
  }, [planner, now]);

  const weekBars = useMemo(() => {
    const out: { label: string; mins: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = todayKey(d);
      const mins = Math.round(sessions.filter((s) => s.dateKey === key).reduce((a, s) => a + s.netSeconds, 0) / 60);
      out.push({ label: DAY_NAMES[(d.getDay() + 6) % 7][0], mins });
    }
    return out;
  }, [sessions]);
  const maxMins = Math.max(30, ...weekBars.map((b) => b.mins));
  const weekTotal = weekBars.reduce((a, b) => a + b.mins, 0);

  const todayList = [
    ...dailyTasks.map((t) => ({ kind: 'daily' as const, id: t.id, title: t.title, done: t.doneOn === today })),
    ...dueMissions.map((m) => ({ kind: 'mission' as const, id: m.id, title: m.title, done: m.done })),
  ];
  const doneCount = todayList.filter((t) => t.done).length;

  const greeting = useGreeting({
    now, name: settings.name, sessions, habits, planner,
    listTotal: todayList.length, listDone: doneCount, nextBlock,
  });

  // a quiet reminder of the Journal's page for today, never shown while the journal is locked
  const journalDay = journalDayFor(now, settings.journalCutoffHour);
  const journalNudge = !settings.journalLocked && !journal.some((e) => e.dateKey === journalDay);

  const runQuick = (q: QuickItem) => {
    if (qaEdit) return;
    if (q.kind === 'tool') openTool(q.target as ToolKey);
    else if (q.kind === 'route') router.push(q.target as any);
    else launchExternal(q);
  };
  const removeQuick = (id: string) => setQuickAccess(quickAccess.filter((q) => q.id !== id));
  // open instantly; enumerate installed apps only after the sheet is up
  const openQaAdd = () => {
    setInstalled([]);
    setAppsLoaded(false);
    setAppQuery('');
    setQaAddSheet(true);
  };
  useEffect(() => {
    if (!qaAddSheet) return;
    const t = setTimeout(() => { setInstalled(getInstalledApps()); setAppsLoaded(true); }, 60);
    return () => clearTimeout(t);
  }, [qaAddSheet]);
  const addQuick = (item: Omit<QuickItem, 'id'>) => {
    if (quickAccess.some((q) => q.kind === item.kind && q.target === item.target)) return;
    setQuickAccess([...quickAccess, { ...item, id: uid() }]);
  };

  return (
    <ScreenBG guard>
      <ScrollView
        key={fk}
        contentContainerStyle={{ padding: S.pad, paddingTop: insets.top + 20, paddingBottom: 44 }}
        showsVerticalScrollIndicator={false}
      >
        <Enter index={0}>
          <Pressable onPress={() => { setNameDraft(settings.name); setNameSheet(true); }}>
            <Text style={T.kicker}>{fmtDate(now)}</Text>
            <Text style={[T.display, { marginTop: 6, marginBottom: greeting.sub ? 4 : 18 }]}>
              {greeting.parts.map((part, i) => (
                <Text key={i} style={part.name ? { color: C.accent } : undefined}>{part.text}</Text>
              ))}
            </Text>
            {greeting.sub ? <Text style={[T.label, { marginBottom: 18 }]}>{greeting.sub}</Text> : null}
          </Pressable>
        </Enter>

        {nextBlock && (
          <Enter index={1}>
            <Card hero pad={14} onPress={() => openTool('planner')}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row style={{ flex: 1 }}>
                  <View style={[st.blockBar, { backgroundColor: nextBlock.block.color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={T.title} numberOfLines={1}>{nextBlock.block.subject}</Text>
                    <Text style={[T.caption, { marginTop: 2, fontVariant: ['tabular-nums'] }]}>
                      {fmtClockTime(toMinutes(nextBlock.block.start), settings.hour24)} – {fmtClockTime(toMinutes(nextBlock.block.end), settings.hour24)}
                    </Text>
                  </View>
                </Row>
                <View style={[st.tagPill, { borderColor: C.accent + '55', backgroundColor: C.accent + '18' }]}>
                  <Text style={[st.tagText, { color: C.accent }]}>{nextBlock.tag}</Text>
                </View>
              </Row>
            </Card>
          </Enter>
        )}

        <Enter index={2}>
          <Card pad={0}>
            <Row>
              <Glance value={String(tasksLeft)} label="tasks left" color={C.accent} />
              <View style={st.vDivider} />
              <Glance value={habits.length ? habitsDone + '/' + habits.length : '—'} label="habits" color={C.green} />
              <View style={st.vDivider} />
              <Glance value={String(focusToday)} suffix=" min" label="focused" color={C.violet} />
            </Row>
          </Card>
        </Enter>

        <SectionTitle
          right={
            <Pressable onPress={() => setQaEdit(!qaEdit)} hitSlop={8}>
              <Text style={[st.link, { color: C.accent }]}>{qaEdit ? 'Done' : 'Edit'}</Text>
            </Pressable>
          }
        >
          Quick access
        </SectionTitle>
        <Enter index={3}>
          <QuickGrid
            items={quickAccess}
            edit={qaEdit}
            onRun={runQuick}
            onRemove={removeQuick}
            onReorder={setQuickAccess}
            onAdd={openQaAdd}
          />
        </Enter>

        {journalNudge ? (
          <Pressable
            onPress={() => openTool('journal')}
            style={[
              st.journalNudge,
              theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
            ]}
          >
            <Ionicons name="book-outline" size={17} color={C.gold} />
            <Text style={st.journalNudgeText}>{journalDay === today ? "Today's page is empty" : "Yesterday's page is empty"}</Text>
            <Text style={[st.link, { color: C.gold }]}>Write</Text>
          </Pressable>
        ) : null}

        <SectionTitle
          right={
            <Pressable onPress={() => openTool('tasks')} hitSlop={8}>
              <Text style={[st.link, { color: C.accent }]}>All tasks →</Text>
            </Pressable>
          }
        >
          Today {todayList.length > 0 ? '· ' + doneCount + '/' + todayList.length : ''}
        </SectionTitle>
        <View style={{ marginVertical: 8 }}>
          <ProgressBar value={doneCount / Math.max(1, todayList.length)} />
        </View>
        <Enter index={4}>
          <Card pad={6}>
            {todayList.length === 0 ? (
              <EmptyText>Nothing on the list — add ToDos from the Tasks tab.</EmptyText>
            ) : (
              todayList.map((t, i) => (
                <View key={t.kind + t.id}>
                  {i > 0 && <Hairline />}
                  <Row style={{ paddingVertical: 11, paddingHorizontal: 10 }}>
                    <CheckCircle
                      done={t.done}
                      color={t.kind === 'mission' ? C.amber : C.green}
                      onPress={() => (t.kind === 'daily' ? toggleDaily(t.id) : toggleMission(t.id))}
                    />
                    <Text style={[st.taskText, t.done && st.taskDone]} numberOfLines={1}>{t.title}</Text>
                    {t.kind === 'mission' && (
                      <View style={st.missionPill}><Text style={st.missionPillText}>DUE</Text></View>
                    )}
                  </Row>
                </View>
              ))
            )}
          </Card>
        </Enter>

        {habits.length > 0 && (
          <>
            <SectionTitle>Habits</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {habits.map((h) => {
                const done = h.doneDates.includes(today);
                return (
                  <Chip
                    key={h.id}
                    icon={done ? 'checkmark-circle' : 'ellipse-outline'}
                    label={h.title}
                    active={done}
                    color={C.green}
                    onPress={() => toggleHabitToday(h.id)}
                    small
                  />
                );
              })}
            </View>
          </>
        )}

        <SectionTitle>Focus this week</SectionTitle>
        <Enter index={5}>
          <Card>
            <Row style={{ alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 4 }}>
              {weekBars.map((b, i) => (
                <WeekBar key={i} label={b.label} mins={b.mins} maxMins={maxMins} isToday={i === 6} />
              ))}
            </Row>
            {weekTotal > 0 && (
              <>
                <Hairline />
                <Text style={[T.caption, { textAlign: 'center', marginTop: 10 }]}>
                  <Text style={{ color: C.accent, fontFamily: F.semi }}>{weekTotal} min</Text> focused in the last 7 days
                </Text>
              </>
            )}
          </Card>
        </Enter>
      </ScrollView>

      <Sheet visible={nameSheet} onClose={() => setNameSheet(false)} title="Your name">
        <Field value={nameDraft} onChangeText={setNameDraft} placeholder="What should the greeting call you?" autoFocus />
        <PillButton label="Save" onPress={() => { setSetting('name', nameDraft.trim()); setNameSheet(false); }} />
      </Sheet>

      <Sheet visible={qaAddSheet} onClose={() => setQaAddSheet(false)} title="Add to quick access">
        <Text style={st.sheetSection}>In-app</Text>
        <Row style={{ flexWrap: 'wrap' }}>
          {ROUTE_CATALOG.filter((r) => !quickAccess.some((q) => q.kind === r.kind && q.target === r.target)).map((r) => (
            <Chip key={r.kind + r.target} label={r.label} color={colorOf(r.color)} onPress={() => addQuick(r)} />
          ))}
        </Row>
        <Text style={st.sheetSection}>Apps on this phone</Text>
        {installed.length === 0 ? (
          <Text style={[T.caption, { marginBottom: 8 }]}>
            {!appsLoaded && appListAvailable()
              ? 'Loading apps…'
              : appListAvailable()
                ? 'No launchable apps found.'
                : 'The live app list needs the installed APK build - meanwhile add by package name below.'}
          </Text>
        ) : (
          <>
            <Field value={appQuery} onChangeText={setAppQuery} placeholder="Search your apps…" />
            <View style={{ maxHeight: 320 }}>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {installed
                  .filter((a) => !quickAccess.some((q) => q.target === a.packageName))
                  .filter((a) => !appQuery.trim() || a.label.toLowerCase().includes(appQuery.trim().toLowerCase()))
                  .map((a) => (
                    <Bouncy
                      key={a.packageName}
                      onPress={() => addQuick({ label: a.label, icon: 'apps-outline', color: 'teal', kind: 'app', target: a.packageName })}
                      style={{ paddingVertical: 9, flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Ionicons name="apps-outline" size={16} color={C.teal} />
                      <Text style={[T.body, { marginLeft: 10, flex: 1 }]} numberOfLines={1}>{a.label}</Text>
                      <Ionicons name="add" size={18} color={C.textFaint} />
                    </Bouncy>
                  ))}
              </ScrollView>
            </View>
          </>
        )}
        <Text style={st.sheetSection}>Custom app (package name)</Text>
        <Field value={customLabel} onChangeText={setCustomLabel} placeholder="Label, e.g. BYJU'S" />
        <Row>
          <Field
            value={customPkg} onChangeText={setCustomPkg} autoCapitalize="none"
            placeholder="com.example.app" style={{ flex: 1, marginBottom: 0 }}
          />
          <PillButton
            small label="Add" style={{ marginLeft: 8 }}
            onPress={() => {
              const p = customPkg.trim();
              if (!p.includes('.')) return;
              addQuick({ label: customLabel.trim() || p.split('.').pop() || 'App', icon: 'apps-outline', color: 'teal', kind: 'app', target: p });
              setCustomPkg(''); setCustomLabel('');
            }}
          />
        </Row>
        <Text style={[T.caption, { marginTop: 10 }]}>
          Find an app's package name in its Play Store URL after "id=".
        </Text>
      </Sheet>
    </ScreenBG>
  );
}

function Glance({ value, label, color, suffix }: { value: string; label: string; color: string; suffix?: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 16 }}>
      <Pop dep={value}>
        <Text style={[st.glanceValue, { color }]}>
          {value}
          {suffix ? <Text style={{ fontSize: 13, fontFamily: F.semi }}>{suffix}</Text> : null}
        </Text>
      </Pop>
      <Text style={st.glanceLabel}>{label}</Text>
    </View>
  );
}

/** Carved vertical trough with a sprung fill rising from the bottom. */
const BAR_SPRING = { damping: 20, stiffness: 240, mass: 0.8 };

/* ---------------- quick access: exact 4-column grid + hold-to-drag ---------------- */
const QA_COLS = 4;
const QA_GAP = 10;
const QA_CELL_H = 96;

const slotPos = (i: number, cell: number) => ({
  x: (i % QA_COLS) * (cell + QA_GAP),
  y: Math.floor(i / QA_COLS) * (QA_CELL_H + QA_GAP),
});

function QuickTile({ q, index, count, cell, isDragging, onDragState, onCross, onDrop, onRun, edit, onRemove }: {
  q: QuickItem; index: number; count: number; cell: number; isDragging: boolean;
  onDragState: (id: string) => void; onCross: (id: string, idx: number) => void; onDrop: () => void;
  onRun: (q: QuickItem) => void; edit: boolean; onRemove: (id: string) => void;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const pos = slotPos(index, cell);
  const x = useSharedValue(pos.x);
  const y = useSharedValue(pos.y);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const lift = useSharedValue(0);

  // live refs — the pan worklet is memoized, so JS callbacks go through here
  const idxRef = React.useRef(index); idxRef.current = index;
  const crossRef = React.useRef(onCross); crossRef.current = onCross;
  const dropRef = React.useRef(onDrop); dropRef.current = onDrop;
  const dragStateRef = React.useRef(onDragState); dragStateRef.current = onDragState;
  const crossStable = React.useCallback((id: string, idx: number) => {
    if (idx !== idxRef.current) crossRef.current(id, idx);
  }, []);
  const dropStable = React.useCallback(() => dropRef.current(), []);
  const dragStable = React.useCallback((id: string) => dragStateRef.current(id), []);

  React.useEffect(() => {
    if (isDragging) return; // the finger owns the position
    if (level === 'none') { x.value = pos.x; y.value = pos.y; }
    else { x.value = withSpring(pos.x, RISE_OUT); y.value = withSpring(pos.y, RISE_OUT); }
  }, [pos.x, pos.y, isDragging, level]);

  // 420ms: long enough that a lingering tap never rearranges by accident,
  // short enough to still feel like a standard launcher hold-to-drag
  const pan = React.useMemo(() => Gesture.Pan()
    .activateAfterLongPress(420)
    .onStart(() => {
      lift.value = withSpring(1, RISE_OUT);
      sx.value = x.value; sy.value = y.value;
      runOnJS(tap)();
      runOnJS(dragStable)(q.id);
    })
    .onUpdate((e) => {
      x.value = sx.value + e.translationX;
      y.value = sy.value + e.translationY;
      const col = Math.min(QA_COLS - 1, Math.max(0, Math.floor((x.value + cell / 2) / (cell + QA_GAP))));
      const row = Math.max(0, Math.floor((y.value + QA_CELL_H / 2) / (QA_CELL_H + QA_GAP)));
      runOnJS(crossStable)(q.id, Math.min(count - 1, row * QA_COLS + col));
    })
    .onFinalize(() => {
      lift.value = withSpring(0, RISE_OUT);
      runOnJS(dropStable)();
    }), [cell, count, q.id]);

  const aStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { scale: 1 + lift.value * 0.07 },
    ] as const,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        style={[
          { position: 'absolute', width: cell, height: QA_CELL_H, zIndex: isDragging ? 10 : 0, elevation: isDragging ? 10 : 0 },
          aStyle,
        ]}
      >
        <Bouncy
          onPress={() => onRun(q)}
          radius={18}
          style={[
            { flex: 1, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
            theme === 'minimal'
              ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
              : { backgroundColor: C.card, ...neuRaised('mid') },
          ]}
        >
          <Ionicons name={q.icon as any} size={24} color={colorOf(q.color)} />
          <Text style={[st.gridLabel, { maxWidth: cell - 10 }]} numberOfLines={1}>{q.label}</Text>
        </Bouncy>
        {edit && (
          <IconBtn
            name="close-circle" size={18} color={C.danger} pad={4}
            style={{ position: 'absolute', top: -8, right: -8 }}
            onPress={() => onRemove(q.id)}
          />
        )}
      </Animated.View>
    </GestureDetector>
  );
}

function QuickGrid({ items, edit, onRun, onRemove, onReorder, onAdd }: {
  items: QuickItem[]; edit: boolean; onRun: (q: QuickItem) => void;
  onRemove: (id: string) => void; onReorder: (items: QuickItem[]) => void; onAdd: () => void;
}) {
  const { width: winW } = useWindowDimensions();
  const cell = Math.floor((winW - S.pad * 2 - QA_GAP * (QA_COLS - 1)) / QA_COLS);
  const [dragId, setDragId] = useState<string | null>(null);
  const slotCount = items.length + (edit ? 1 : 0);
  const rows = Math.max(1, Math.ceil(slotCount / QA_COLS));
  const height = rows * QA_CELL_H + (rows - 1) * QA_GAP;
  const reorder = (id: string, idx: number) => {
    const from = items.findIndex((it) => it.id === id);
    if (from < 0 || idx === from) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(idx, 0, moved);
    onReorder(next);
  };
  const addPos = slotPos(items.length, cell);
  return (
    <View style={{ height, marginBottom: 6 }}>
      {items.map((q, i) => (
        <QuickTile
          key={q.id} q={q} index={i} count={items.length} cell={cell}
          isDragging={dragId === q.id}
          onDragState={setDragId}
          onCross={reorder}
          onDrop={() => setDragId(null)}
          onRun={onRun} edit={edit} onRemove={onRemove}
        />
      ))}
      {edit && (
        <Bouncy
          onPress={onAdd}
          radius={18}
          style={{
            position: 'absolute', left: addPos.x, top: addPos.y, width: cell, height: QA_CELL_H,
            borderRadius: 18, alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderStyle: 'dashed', borderColor: C.borderBright,
          }}
        >
          <Ionicons name="add" size={24} color={C.textDim} />
          <Text style={st.gridLabel}>Add</Text>
        </Bouncy>
      )}
    </View>
  );
}

function WeekBar({ label, mins, maxMins, isToday }: {
  label: string; mins: number; maxMins: number; isToday: boolean;
}) {
  const theme = useTheme();
  const level = useAnimLevel();
  const target = Math.max(4, (mins / maxMins) * 56);
  const h = useSharedValue(target);
  React.useEffect(() => {
    h.value = level === 'none' ? target : withSpring(target, BAR_SPRING);
  }, [target, level]);
  const fillStyle = useAnimatedStyle(() => ({ height: h.value }));
  const fillColor = isToday ? C.accent : C.slate + '73';
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      {mins > 0 && (
        <Pop dep={mins}>
          <Text style={st.barValue}>{mins}</Text>
        </Pop>
      )}
      <View
        style={[
          st.barTrough,
          theme === 'minimal'
            ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border }
            : { backgroundColor: C.inset, ...neuInset('low') },
        ]}
      >
        <Animated.View
          style={[
            {
              width: '100%', borderRadius: 8, backgroundColor: fillColor,
              ...(theme === 'minimal' ? null : { boxShadow: '0 0 4px ' + fillColor }),
            },
            fillStyle,
          ]}
        />
      </View>
      <Text style={[st.barLabel, isToday && { color: C.accent, fontFamily: F.semi }]}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  blockBar: { width: 4, height: 34, borderRadius: 2, marginRight: 12 },
  // accent colours are applied inline at the call site: a StyleSheet freezes
  // C.accent at import time and would never follow an accent change
  tagPill: {
    borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 10,
  },
  tagText: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.2 },
  vDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.hairline, alignSelf: 'stretch', marginVertical: 12 },
  glanceValue: { fontFamily: F.bold, fontSize: 22, fontVariant: ['tabular-nums'], letterSpacing: -0.3 },
  glanceLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 11, marginTop: 3, letterSpacing: 0.4 },
  gridLabel: { color: C.text, fontFamily: F.med, fontSize: 12, marginTop: 7, letterSpacing: 0.1 },
  link: { fontFamily: F.semi, fontSize: 13 },
  journalNudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: S.radiusSm, marginTop: 6, marginBottom: 4,
  },
  journalNudgeText: { flex: 1, color: C.textDim, fontFamily: F.med, fontSize: 14 },
  taskText: { color: C.text, fontFamily: F.reg, fontSize: 15, marginLeft: 12, flex: 1, letterSpacing: 0.1 },
  taskDone: { color: C.textFaint, textDecorationLine: 'line-through' },
  missionPill: {
    backgroundColor: C.amber + '1C', borderColor: C.amber + '55', borderWidth: 1,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, marginLeft: 8,
  },
  missionPillText: { color: C.amber, fontFamily: F.bold, fontSize: 9.5, letterSpacing: 1 },
  barValue: { color: C.textFaint, fontFamily: F.med, fontSize: 9.5, marginBottom: 4, fontVariant: ['tabular-nums'] },
  barLabel: { color: C.textFaint, fontFamily: F.med, fontSize: 10.5, marginTop: 7 },
  barTrough: {
    width: 16, height: 56, borderRadius: 8,
    overflow: 'hidden', justifyContent: 'flex-end',
  },
  sheetSection: {
    color: C.textFaint, fontFamily: F.semi, fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 1.6, marginTop: 14, marginBottom: 8,
  },
});
