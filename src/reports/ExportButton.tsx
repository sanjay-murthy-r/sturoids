import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK, CHROME_FONT_MAX } from '../theme';
import { useStore } from '../store';
import { Chip, IconBtn, ListCard, ListRow, PillButton, SectionTitle, Sheet, Toggle, ToolAction } from '../components/UI';
import { JournalCalendar } from '../components/JournalCalendar';
import { PinSheet } from '../components/LockGate';
import { toast } from '../components/Toast';
import { ALL_NOTES, markOpen } from '../lock';
import { useToday } from '../hooks/useNow';
import { tick } from '../haptics';
import { RangeKind, SectionKey, SECTION_LABEL, availableSections, fmtDate } from './build';
import {
  ExportFormat, KIND_INFO, SummaryKind, SummaryOpts, exportSummary, journalShut, kindTitle, needsPin, rangeFor,
  sectionsFor, shutParts,
} from './run';
import { ReportPreview, useLiveReport } from './Preview';

type OptsIn = SummaryOpts | (() => SummaryOpts);
const read = (o: OptsIn | undefined): SummaryOpts => (typeof o === 'function' ? o() : o || {});

/** The ranges every export offers; "Everything" joins them for a summary that starts there (Scores, a journal's all). */
const RANGES: { kind: RangeKind; label: string }[] = [
  { kind: 'week', label: 'This week' },
  { kind: 'lastweek', label: 'Last week' },
  { kind: 'month', label: 'This month' },
  { kind: '30d', label: 'Last 30 days' },
  { kind: 'custom', label: 'Custom' },
];
const ALL_RANGE = { kind: 'all' as RangeKind, label: 'Everything' };

/** The full report's parts ticked at first. */
const DEFAULT_SECTIONS: SectionKey[] = ['overview', 'tasks', 'habits', 'focus', 'journal', 'scores'];

/** How an export went, in a short status line. */
function sayResult(r: Awaited<ReturnType<typeof exportSummary>>) {
  if (r === 'unavailable') toast('Sharing is not available on this phone');
  else if (r === 'error') toast("Couldn't make the file");
}

interface Draft {
  kind: SummaryKind;
  range: RangeKind;
  from: string;
  to: string;
  sections: SectionKey[];
  withText: boolean;
}

/**
 * Every export's moving parts: one small sheet with the summary's name, its range (This week, Last week, This month,
 * Last 30 days, or Custom on the calendar; at first what the screen shows), a live preview, then Export PDF or Share
 * CSV; then the PIN when the journal or notes are shut; then the share sheet. The full report's sheet also ticks the
 * parts to put in. Options are read when the sheet opens, so a screen can pass a function that reads its current
 * range or filter; `kinds` names the summaries a screen offers (Tasks: ToDos or long-term tasks), the first at first.
 */
export function useExportFlow(kinds: SummaryKind | readonly SummaryKind[], opts?: OptsIn) {
  const list = (typeof kinds === 'string' ? [kinds] : kinds) as readonly SummaryKind[];
  const today = useToday();
  const archived = useStore((s) => s.settings.archivedTools);
  const [open, setOpen] = React.useState(false);
  const [pin, setPin] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [picking, setPicking] = React.useState<'from' | 'to' | null>(null);
  // the screen's own options (a subject, an exam, a scope) as they were when the sheet opened
  const [seed, setSeed] = React.useState<SummaryOpts>({});
  const [choices, setChoices] = React.useState<readonly SummaryKind[]>(list);
  const [d, setD] = React.useState<Draft>(() => ({
    kind: list[0], range: KIND_INFO[list[0]].range, from: today, to: today, sections: DEFAULT_SECTIONS, withText: false,
  }));
  // what waits for the sheet to finish closing, so the PIN pad or the share sheet never rides under it
  const pending = React.useRef<{ format: ExportFormat; kind: SummaryKind; opts: SummaryOpts } | 'unlock' | null>(null);
  const optsRef = React.useRef(opts);
  optsRef.current = opts;
  const listKey = list.join(',');

  const effective = (x: Draft = d, s: SummaryOpts = seed): SummaryOpts => ({
    ...s,
    range: x.range,
    ...(x.range === 'custom' ? { from: x.from, to: x.to } : { from: x.range === 'day' ? s.from : undefined, to: undefined }),
    sections: x.kind === 'report' ? x.sections : undefined,
    includeJournalText: x.withText && sectionsFor(x.kind, { sections: x.sections }).includes('journal') && !journalShut(),
  });

  const run = React.useCallback(async (kind: SummaryKind, o: SummaryOpts, format: ExportFormat) => {
    setBusy(true);
    try {
      sayResult(await exportSummary(kind, { ...o, format }));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Exports now, or after the PIN when what it covers is shut. */
  const go = React.useCallback((kind: SummaryKind, o: SummaryOpts, format: ExportFormat) => {
    if (busy) return;
    if (needsPin(kind, o)) {
      pending.current = { format, kind, opts: o };
      setPin(true);
      return;
    }
    void run(kind, o, format);
  }, [busy, run]);

  /** Opens the sheet on a summary (the first the screen offers, unless named), with the range the screen shows. */
  const openSheet = React.useCallback((kindIn?: SummaryKind, optsIn?: SummaryOpts) => {
    tick();
    const o = optsIn ?? read(optsRef.current);
    const kind = kindIn ?? (listKey.split(',')[0] as SummaryKind);
    const range = o.range ?? (o.from && o.to ? 'custom' : KIND_INFO[kind].range);
    const span = rangeFor(kind, { ...o, range: range === 'custom' ? 'custom' : range });
    setSeed({ subject: o.subject, examId: o.examId, examIds: o.examIds, scopeLabel: o.scopeLabel, title: o.title, from: o.from });
    setChoices(kindIn ? [kindIn] : (listKey.split(',') as SummaryKind[]));
    setD((cur) => ({
      kind, range,
      from: range === 'custom' ? span.from : cur.range === 'custom' ? cur.from : span.from,
      to: range === 'custom' ? span.to : cur.range === 'custom' ? cur.to : span.to,
      sections: o.sections ?? cur.sections, withText: o.includeJournalText ?? false,
    }));
    setPicking(null);
    setOpen(true);
  }, [listKey]);

  const pickFormat = (format: ExportFormat) => {
    if (busy) return;
    if (d.kind === 'report' && !d.sections.length) { toast('Pick at least one part'); return; }
    tick();
    pending.current = { format, kind: d.kind, opts: effective() };
    setOpen(false);
  };

  const info = KIND_INFO[d.kind];
  // one exam is one exam whatever the range
  const ranged = info.ranged && !seed.examId;
  const ranges = [...RANGES, ...(KIND_INFO[d.kind].range === 'all' || d.range === 'all' ? [ALL_RANGE] : [])];
  const available = availableSections(archived || []);
  const hasJournal = d.kind !== 'day' && sectionsFor(d.kind, { sections: d.sections }).includes('journal');
  const locked = open ? shutParts(d.kind, effective()) : [];

  const sheet = (
    <>
      <Sheet
        visible={open} onClose={() => setOpen(false)} title={picking ? (picking === 'from' ? 'From' : 'To') : kindTitle(d.kind, seed)}
        onClosed={() => {
          const p = pending.current;
          // an unlock stays pending through the PIN pad, which reads it to know where to go back to
          if (p === 'unlock') { setPin(true); return; }
          pending.current = null;
          if (p) go(p.kind, p.opts, p.format);
        }}
      >
        {open && picking ? (
          <>
            <JournalCalendar
              value={picking === 'from' ? d.from : d.to}
              maxKey={picking === 'from' ? d.to : today}
              minKey={picking === 'to' ? d.from : undefined}
              onPick={(k) => {
                tick();
                setD((cur) => (picking === 'from' ? { ...cur, from: k } : { ...cur, to: k }));
                setPicking(null);
              }}
            />
            <View style={st.back}>
              <Chip small label="Back" icon="chevron-back" onPress={() => { tick(); setPicking(null); }} />
            </View>
          </>
        ) : open ? (
          <>
            {choices.length > 1 ? (
              <View style={[st.chips, { marginBottom: S.gap }]}>
                {choices.map((k) => (
                  <Chip
                    key={k} label={KIND_INFO[k].short} active={d.kind === k}
                    onPress={() => { tick(); setD((cur) => ({ ...cur, kind: k })); }}
                    accessibilityRole="radio" accessibilityState={{ selected: d.kind === k }}
                  />
                ))}
              </View>
            ) : null}
            {ranged ? (
              <>
                <Text style={st.label}>Range</Text>
                <View style={st.chips}>
                  {ranges.map((r) => (
                    <Chip
                      key={r.kind} label={r.label} active={d.range === r.kind} small
                      onPress={() => { tick(); setD((cur) => ({ ...cur, range: r.kind })); }}
                      accessibilityRole="radio" accessibilityState={{ selected: d.range === r.kind }}
                    />
                  ))}
                </View>
                {d.range === 'custom' ? (
                  <ListCard style={{ marginTop: S.gap }}>
                    <ListRow onPress={() => { tick(); setPicking('from'); }} style={st.row} accessibilityLabel={'From ' + fmtDate(d.from)} accessibilityRole="button">
                      <Text style={[T.body, { flex: 1 }]}>From</Text>
                      <Text style={st.value}>{fmtDate(d.from)}</Text>
                      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
                    </ListRow>
                    <ListRow onPress={() => { tick(); setPicking('to'); }} style={st.row} accessibilityLabel={'To ' + fmtDate(d.to)} accessibilityRole="button">
                      <Text style={[T.body, { flex: 1 }]}>To</Text>
                      <Text style={st.value}>{fmtDate(d.to)}</Text>
                      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
                    </ListRow>
                  </ListCard>
                ) : null}
              </>
            ) : null}
            {d.kind === 'report' ? (
              <>
                <Text style={[st.label, { marginTop: S.gap + 4 }]}>Put in</Text>
                <View style={st.chips}>
                  {available.map((k) => {
                    const on = d.sections.includes(k);
                    return (
                      <Chip
                        key={k} small label={SECTION_LABEL[k]} active={on}
                        onPress={() => { tick(); setD((cur) => ({ ...cur, sections: on ? cur.sections.filter((x) => x !== k) : [...cur.sections, k] })); }}
                        accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                      />
                    );
                  })}
                </View>
              </>
            ) : null}
            {hasJournal && !journalShut() ? (
              <View style={st.toggleRow}>
                <View style={{ flex: 1, marginRight: 14 }}>
                  <Text style={T.body}>Include journal text</Text>
                  <Text style={T.caption}>Off, only moods, ratings and counts go in. On, your entries' own words do too.</Text>
                </View>
                <Toggle value={d.withText} onChange={(v) => { tick(); setD((cur) => ({ ...cur, withText: v })); }} label="Include journal text" />
              </View>
            ) : null}
            {locked.length ? (
              <View style={st.toggleRow}>
                <Ionicons name="lock-closed-outline" size={18} color={C.textFaint} />
                <Text style={[T.label, { flex: 1, marginHorizontal: 12 }]}>
                  {cap(locked.join(' and ')) + (locked.length > 1 || locked[0] !== 'the journal' ? ' are' : ' is') + ' locked, so left out'}
                </Text>
                <Chip small label="Unlock" icon="key-outline" onPress={() => { tick(); pending.current = 'unlock'; setOpen(false); }} />
              </View>
            ) : null}
            <SectionTitle>Preview</SectionTitle>
            <LivePreview kind={d.kind} opts={effective()} />
            <View style={st.actions}>
              <PillButton label={busy ? 'Making the file' : 'Export PDF'} icon="document-text-outline" onPress={() => pickFormat('pdf')} />
              <PillButton outline label="Share CSV" icon="grid-outline" onPress={() => pickFormat('csv')} />
            </View>
            <Text style={[T.caption, { marginTop: S.gap, textAlign: 'center' }]}>
              Made on this phone from this profile's data, then shared where you choose.
            </Text>
          </>
        ) : null}
      </Sheet>
      <PinSheet
        visible={pin} mode="enter"
        onClose={() => {
          // a cancelled unlock goes back to the sheet that asked for it; a cancelled export simply stops
          const back = pending.current === 'unlock';
          pending.current = null;
          setPin(false);
          if (back) setTimeout(() => setOpen(true), 380);
        }}
        onDone={() => {
          const s = useStore.getState().settings;
          if (s.journalLocked) markOpen('journal');
          if (s.notesLocked) markOpen('notes');
          markOpen(ALL_NOTES);
          const p = pending.current;
          pending.current = null;
          setPin(false);
          // once the keypad has gone down: export, or back to the sheet that asked to unlock
          setTimeout(() => {
            if (p && p !== 'unlock') void run(p.kind, p.opts, p.format);
            else setOpen(true);
          }, 380);
        }}
      />
    </>
  );
  return { open: openSheet, go, busy, sheet };
}

/** The preview inside the sheet: mounted only while the sheet is up, so no screen rebuilds a report it is not showing. */
function LivePreview({ kind, opts }: { kind: SummaryKind; opts: SummaryOpts }) {
  const report = useLiveReport(kind, opts);
  return <ReportPreview report={report} />;
}

/**
 * For a header's tray: `action` goes in useToolHeader's actions, `sheet` anywhere in the screen.
 *
 *   const exp = useExport(['todos', 'longterm'], { range: 'week' });
 *   useToolHeader({ ..., actions: [..., exp.action] });  …  {exp.sheet}
 */
export function useExport(kinds: SummaryKind | readonly SummaryKind[], opts?: OptsIn): { action: ToolAction; sheet: React.ReactNode } {
  const flow = useExportFlow(kinds, opts);
  return {
    action: { icon: 'share-outline', label: 'Export', onPress: () => flow.open() },
    sheet: flow.sheet,
  };
}

/**
 * The Export control on a summary card: a flat share icon that opens the export sheet. `inline` sets PDF and CSV out
 * in place instead, for a summary that is itself in a sheet (a second sheet over it would stack) and covers one fixed
 * span (the journal's day record).
 */
export function ExportButton({ kind, opts, inline = false, label = 'Export' }: {
  kind: SummaryKind | readonly SummaryKind[]; opts?: OptsIn; inline?: boolean; label?: string;
}) {
  const flow = useExportFlow(kind, opts);
  const first = (typeof kind === 'string' ? kind : kind[0]) as SummaryKind;
  if (inline) {
    return (
      <View style={st.inline}>
        <Ionicons name="share-outline" size={17} color={C.textFaint} />
        <Text style={[T.label, { flex: 1, marginLeft: 10 }]} maxFontSizeMultiplier={CHROME_FONT_MAX}>{label}</Text>
        <Chip small label="PDF" onPress={() => { tick(); flow.go(first, read(opts), 'pdf'); }} accessibilityLabel={label + ' as PDF'} />
        <Chip small label="CSV" onPress={() => { tick(); flow.go(first, read(opts), 'csv'); }} accessibilityLabel={label + ' as CSV'} style={{ marginLeft: 8 }} />
        {flow.sheet}
      </View>
    );
  }
  return (
    <>
      <IconBtn name="share-outline" size={20} color={C.textDim} onPress={() => flow.open()} accessibilityLabel={label} />
      {flow.sheet}
    </>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { ...T.label, marginBottom: 10 },
  row: { paddingVertical: 14, minHeight: 52 },
  value: { color: C.textDim, fontFamily: F.med, fontSize: 15, letterSpacing: TRACK.body, marginRight: 8 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: S.gap + 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', marginTop: S.gap + 6 },
  back: { flexDirection: 'row', marginTop: S.gap },
  inline: { flexDirection: 'row', alignItems: 'center', marginTop: S.section - 10, minHeight: 44 },
});
