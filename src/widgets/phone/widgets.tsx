// The phone's home-screen widgets, drawn. Flat (a home-screen widget is a picture the launcher shows, and cannot carry
// the app's soft shadows), in the theme's colours and the app's faces, every tap a link into the app (sturoids://…).
// The pieces are plain functions the widget library calls once to build its tree: no hooks, no state, and none of them
// ever returns null (the library cannot build a tree from nothing).

import React from 'react';
import { FlexWidget, ImageWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import {
  AgendaModel, AiDockModel, AtAGlanceModel, ChecklistModel, ClockModel, CountdownModel, DayRingModel, DeadlinesModel,
  FocusWeekModel, Gate, HabitGridModel, MOOD_COLORS, MoodStripModel, NewNoteModel, NextUpModel, NotesModel, NowNextModel,
  OnThisDayModel, PhoneData, PhonePalette, PhoneWidgetName, QuickStartModel, ResultsModel, SessionModel, StreakModel,
  SubjectTrendModel, TodaysBlocksModel, VideosModel, WriteTodayModel, APP_LINK, gateOf, glyphSvg, hexOf, minText,
  modelFor, openLink, paletteOf, rgba, ringSvg, trendSvg,
} from './model';
import { CalcKey, CalcPad, EMPTY_PAD, padAnswer, showsAnswer } from './calc';

/** The widget's size on the home screen, in dp, as the launcher gives it. */
export interface PhoneBox { width: number; height: number }

/* ---------------------------------------------------------------- pieces */

const FACE = {
  reg: 'InterTight_400Regular',
  med: 'InterTight_500Medium',
  semi: 'InterTight_600SemiBold',
  num: 'InterTight_300Light',
  sm: 'SchibstedGrotesk_400Regular',
  smMed: 'SchibstedGrotesk_500Medium',
  head: 'SourceSerif4_500Medium',
} as const;
type Face = keyof typeof FACE;

const RADIUS = 22;
const PAD = 16;

/** A tap's link: the app's own (sturoids://…) or a website; '' opens the app as it is. */
function tap(uri: string): { clickAction: string; clickActionData?: Record<string, unknown> } {
  return uri ? { clickAction: 'OPEN_URI', clickActionData: { uri } } : { clickAction: 'OPEN_APP' };
}

interface TxtProps {
  text: string;
  size: number;
  face?: Face;
  color: ColorProp;
  lines?: number;
  align?: 'left' | 'center' | 'right';
  caps?: boolean;
  uri?: string;
  /** figures and labels that must keep their size: the launcher's own text scale would push them out of the box */
  fixed?: boolean;
  style?: Record<string, unknown>;
}

function Txt({ text, size, face = 'reg', color, lines = 1, align, caps, uri, fixed, style }: TxtProps) {
  return (
    <TextWidget
      text={caps ? text.toUpperCase() : text}
      maxLines={lines}
      truncate="END"
      allowFontScaling={!fixed}
      style={{
        fontFamily: FACE[face], fontSize: size, color,
        letterSpacing: caps ? 1.1 : 0,
        ...(align ? { textAlign: align } : null),
        ...(style || null),
      }}
      {...(uri !== undefined ? tap(uri) : null)}
    />
  );
}

/** A widget's small heading: Schibsted, in capitals, quiet. */
const Kicker = ({ text, p, color }: { text: string; p: PhonePalette; color?: ColorProp }) => (
  <Txt text={text} size={11} face="smMed" color={color || p.faint} caps fixed />
);

/** The widget's ground: one flat rounded surface, its tap the widget's own link. */
function Frame({ p, uri, children, pad = PAD, gap = 0 }: { p: PhonePalette; uri: string; children: any; pad?: number; gap?: number }) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent', width: 'match_parent', backgroundColor: p.bg, borderRadius: RADIUS,
        padding: pad, flexDirection: 'column', flexGap: gap,
      }}
      {...tap(uri)}
    >
      {children}
    </FlexWidget>
  );
}

const Spacer = () => <FlexWidget style={{ flex: 1 }} />;
const Row = ({ children, gap = 8, style }: { children: any; gap?: number; style?: Record<string, unknown> }) => (
  <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: gap, width: 'match_parent', ...(style || null) }}>{children}</FlexWidget>
);
const Glyph = ({ name, size, color, fill }: { name: string; size: number; color: string; fill?: boolean }) => (
  <SvgWidget svg={glyphSvg(name, size, color, fill)} style={{ width: size, height: size }} />
);

/** A round, flat well holding a glyph: the tick on Next up, the play on Quick start. */
function Disc({ size, color, glyph, glyphColor, uri, ring }: { size: number; color: ColorProp; glyph: string; glyphColor: string; uri?: string; ring?: ColorProp }) {
  return (
    <FlexWidget
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center',
        justifyContent: 'center', ...(ring ? { borderWidth: 1.5, borderColor: ring } : null),
      }}
      {...(uri !== undefined ? tap(uri) : null)}
    >
      <Glyph name={glyph} size={Math.round(size * 0.5)} color={glyphColor} />
    </FlexWidget>
  );
}

/** A flat pill: a D-n, a time, a preset. */
function Pill({ text, p, color, fill, uri }: { text: string; p: PhonePalette; color?: ColorProp; fill?: ColorProp; uri?: string }) {
  return (
    <FlexWidget
      style={{ paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, backgroundColor: fill || p.well }}
      {...(uri !== undefined ? tap(uri) : null)}
    >
      <Txt text={text} size={11} face="smMed" color={color || p.dim} fixed />
    </FlexWidget>
  );
}

/** A quiet empty state: a glyph, a line, a hint. */
function Empty({ p, glyph, title, body }: { p: PhonePalette; glyph: string; title: string; body: string }) {
  return (
    <FlexWidget style={{ flex: 1, flexDirection: 'column', justifyContent: 'center', flexGap: 6, width: 'match_parent' }}>
      <Glyph name={glyph} size={20} color={p.faint} />
      <Txt text={title} size={14} face="semi" color={p.text} lines={2} />
      <Txt text={body} size={12} face="sm" color={p.faint} lines={2} />
    </FlexWidget>
  );
}

/** A thin flat bar, `frac` filled. */
function Bar({ frac, color, track, height = 4 }: { frac: number; color: ColorProp; track: ColorProp; height?: number }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <FlexWidget style={{ flexDirection: 'row', width: 'match_parent', height, borderRadius: height / 2, backgroundColor: track }}>
      {f > 0 ? <FlexWidget style={{ flex: Math.max(1, Math.round(f * 1000)), height, borderRadius: height / 2, backgroundColor: color }} /> : null}
      {f < 1 ? <FlexWidget style={{ flex: Math.max(1, Math.round((1 - f) * 1000)), height }} /> : null}
    </FlexWidget>
  );
}

const small = (b: PhoneBox) => b.width < 150 || b.height < 150;

/* ---------------------------------------------------------------- the gate */

function GateWidget({ gate, p }: { gate: Gate; p: PhonePalette }) {
  return (
    <Frame p={p} uri={gate.uri}>
      <Kicker text={gate.kind === 'locked' ? 'Locked' : 'Archived'} p={p} />
      <FlexWidget style={{ flex: 1, flexDirection: 'column', justifyContent: 'center', flexGap: 6, width: 'match_parent' }}>
        <Glyph name={gate.kind === 'locked' ? 'lock' : 'archive'} size={22} color={p.accent} />
        <Txt text={gate.title} size={14} face="semi" color={p.text} lines={2} />
        <Txt text={gate.body} size={12} face="sm" color={p.faint} lines={2} />
      </FlexWidget>
    </Frame>
  );
}

/* ---------------------------------------------------------------- app */

function DayRing({ m, p }: { m: DayRingModel; p: PhonePalette }) {
  const goal = m.goalMin > 0;
  const ring = ringSvg({
    size: 96, stroke: 7, frac: m.total ? m.done / m.total : 0, color: p.accent, track: p.well,
    inner: goal ? { frac: m.focusMin / m.goalMin, color: p.green } : undefined,
  });
  return (
    <Frame p={p} uri={m.uri} pad={12}>
      <FlexWidget style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
        <OverlapWidget style={{ width: 96, height: 96 }}>
          <SvgWidget svg={ring} style={{ width: 96, height: 96 }} />
          <FlexWidget style={{ width: 96, height: 96, flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <Txt text={m.total ? String(m.left) : '0'} size={28} face="num" color={p.text} fixed />
            <Txt text={m.total ? (m.left === 1 ? 'left' : 'left') : 'nothing due'} size={11} face="sm" color={p.faint} fixed />
          </FlexWidget>
        </OverlapWidget>
      </FlexWidget>
      <Txt
        text={(m.total ? m.done + ' of ' + m.total + ' done' : 'A clear day') + (goal ? ' · ' + minText(m.focusMin) : '')}
        size={11} face="sm" color={p.faint} align="center" fixed style={{ width: 'match_parent' }}
      />
    </Frame>
  );
}

function BlockLine({ b, p }: { b: NonNullable<AtAGlanceModel['block']>; p: PhonePalette }) {
  const tint = hexOf(b.color, p);
  return (
    <FlexWidget style={{ flexDirection: 'column', flexGap: 5, width: 'match_parent' }} {...tap(b.uri)}>
      <Row gap={8}>
        <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: tint }} />
        <Txt text={b.tag === 'NOW' ? 'Now' : b.tag === 'NEXT UP' ? 'Next' : 'Tomorrow'} size={11} face="smMed" color={tint} caps fixed />
        <Txt text={b.range} size={11} face="sm" color={p.faint} fixed />
      </Row>
      <Txt text={b.subject} size={15} face="semi" color={p.text} />
      {b.tag === 'NOW' ? <Bar frac={b.progress} color={tint} track={p.well} /> : null}
    </FlexWidget>
  );
}

function TodoRow({ r, p, compact }: { r: { title: string; sub: string; uri: string; late?: boolean }; p: PhonePalette; compact?: boolean }) {
  return (
    <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 10, width: 'match_parent', paddingVertical: compact ? 2 : 4 }} {...tap(r.uri)}>
      <FlexWidget style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: r.late ? p.amber : p.faint }} />
      <Txt text={r.title} size={13} color={p.text} style={{ flex: 1 }} />
      {r.sub ? <Txt text={r.sub} size={11} face="sm" color={r.late ? p.amber : p.faint} fixed /> : null}
    </FlexWidget>
  );
}

function AtAGlance({ m, p }: { m: AtAGlanceModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <FlexWidget style={{ flexDirection: 'row', flex: 1, width: 'match_parent', flexGap: 14 }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 8 }}>
          {m.block ? <BlockLine b={m.block} p={p} /> : <Txt text="Nothing planned" size={13} face="sm" color={p.faint} />}
          <Spacer />
          {m.habits.length ? (
            <FlexWidget style={{ flexDirection: 'row', flexGap: 6 }}>
              {m.habits.map((h) => (
                <FlexWidget key={h.id} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: h.done ? p.green : p.well }} />
              ))}
            </FlexWidget>
          ) : null}
        </FlexWidget>
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 2 }}>
          <Kicker text={m.left ? m.left + ' to do' : 'ToDos'} p={p} />
          {m.todos.length
            ? m.todos.map((r) => <TodoRow key={r.id} r={r} p={p} compact />)
            : [<Txt key="none" text="All done" size={13} face="sm" color={p.faint} />]}
        </FlexWidget>
      </FlexWidget>
    </Frame>
  );
}

function Agenda({ m, p, box }: { m: AgendaModel; p: PhonePalette; box: PhoneBox }) {
  const room = Math.max(3, Math.floor((box.height - 80) / 34));
  // keep the rows around now in view: a few before, the rest after
  const from = Math.max(0, Math.min(m.nowAt - 1, m.rows.length - room));
  const rows = m.rows.slice(from, from + room);
  const nowAt = m.nowAt - from;
  const out: any[] = [];
  rows.forEach((r, i) => {
    if (i === nowAt) out.push(<NowLine key="now" p={p} />);
    const tint = r.kind === 'block' ? hexOf(r.color, p) : r.kind === 'exam' ? p.amber : p.slate;
    out.push(
      <FlexWidget key={r.id} style={{ flexDirection: 'row', alignItems: 'center', flexGap: 10, width: 'match_parent', paddingVertical: 4 }} {...tap(r.uri)}>
        <FlexWidget style={{ width: 3, height: 26, borderRadius: 2, backgroundColor: r.past ? p.line : tint }} />
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <Txt text={r.title} size={13} face={r.on ? 'semi' : 'reg'} color={r.past ? p.faint : p.text} />
          <Txt text={r.kind === 'exam' ? 'Exam · today' : r.time} size={11} face="sm" color={p.faint} fixed />
        </FlexWidget>
        {r.on ? <Pill text="Now" p={p} color={p.onAccent} fill={tint} /> : null}
      </FlexWidget>,
    );
  });
  if (rows.length && nowAt >= rows.length) out.push(<NowLine key="now" p={p} />);
  return (
    <Frame p={p} uri={m.uri} gap={8}>
      <Row>
        <Txt text={m.dateText} size={17} face="head" color={p.text} style={{ flex: 1 }} />
        <Kicker text="Agenda" p={p} />
      </Row>
      {m.rows.length ? (
        <FlexWidget style={{ flex: 1, flexDirection: 'column', width: 'match_parent' }}>{out}</FlexWidget>
      ) : (
        <Empty p={p} glyph="check" title="Nothing timed today" body="Blocks, timed ToDos and exams line up here" />
      )}
      {m.untimed ? <Txt text={'+ ' + m.untimed + (m.untimed === 1 ? ' ToDo' : ' ToDos') + ' without a time'} size={11} face="sm" color={p.faint} fixed /> : null}
    </Frame>
  );
}

const NowLine = ({ p }: { p: PhonePalette }) => (
  <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: 'match_parent', flexGap: 6, paddingVertical: 2 }}>
    <FlexWidget style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: p.danger }} />
    <FlexWidget style={{ flex: 1, height: 1, backgroundColor: p.danger }} />
  </FlexWidget>
);

/**
 * The Clock: the date in the serif, the greeting, what comes next and the ToDos left, round a ring that is the day
 * itself, filled as far as the day has gone, a dot where now is (redrawn as the day moves on; see the report's note:
 * a home-screen widget drawn this way cannot run a ticking clock or a continuous pulse).
 */
function Clock({ m, p, box }: { m: ClockModel; p: PhonePalette; box: PhoneBox }) {
  // the date keeps its room beside the ring: on a narrow widget the ring gives way first, then the date's size
  const narrow = box.width < 200;
  const ring = Math.max(40, Math.min(72, Math.round(Math.min(box.width - 28 - 10 - (narrow ? 80 : 96), box.height * 0.42))));
  const svg = ringSvg({ size: ring, stroke: 4, frac: m.dayFrac, color: rgba(p.accent, 0.85), track: p.well, dot: p.accent });
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={6}>
      <Row gap={10} style={{ alignItems: 'flex-start' }}>
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <Txt text={m.weekday} size={11} face="smMed" color={p.accent} caps fixed />
          <Txt text={m.day + ' ' + m.month} size={narrow ? 22 : 26} face="head" color={p.text} fixed />
        </FlexWidget>
        <SvgWidget svg={svg} style={{ width: ring, height: ring }} />
      </Row>
      <Spacer />
      <Txt text={m.greeting} size={12} face="sm" color={p.dim} />
      <Txt text={m.next || 'Nothing else planned'} size={13} face="med" color={p.text} lines={box.height < 200 ? 1 : 2} />
      <Txt
        text={m.left ? m.left + (m.left === 1 ? ' ToDo left' : ' ToDos left') : 'All ToDos done'}
        size={11} face="sm" color={p.faint} fixed
      />
    </Frame>
  );
}

function Search({ p }: { p: PhonePalette }) {
  return (
    <Frame p={p} uri={APP_LINK.search} pad={14}>
      <Kicker text="Sift" p={p} />
      <Spacer />
      <FlexWidget
        style={{ flexDirection: 'row', alignItems: 'center', flexGap: 8, width: 'match_parent', height: 40, borderRadius: 20, backgroundColor: p.well, paddingHorizontal: 12 }}
        {...tap(APP_LINK.search)}
      >
        <Glyph name="search" size={16} color={p.accent} />
        <Txt text="Sift through everything" size={12} face="sm" color={p.faint} style={{ flex: 1 }} />
      </FlexWidget>
    </Frame>
  );
}

/* ---------------------------------------------------------------- calculator */

/** The Calculator widget's keys, row by row: each fills its share of the widget, so the pad grows with it. */
const PAD_ROWS: CalcKey[][] = [
  ['C', '(', ')', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', 'DEL', '='],
];
/** below this height the widget is its display alone, a tap opening the Calculator */
const PAD_MIN_H = 230;

function CalcKeyWidget({ k, p, h }: { k: CalcKey; p: PhonePalette; h: number }) {
  const op = k === '+' || k === '−' || k === '×' || k === '÷' || k === '(' || k === ')';
  const eq = k === '=';
  const quiet = k === 'C' || k === 'DEL';
  const fill = eq ? p.accent : op ? rgba(p.accent, 0.13) : p.well;
  const ink = eq ? p.onAccent : op ? p.accent : quiet ? p.dim : p.text;
  const size = Math.max(15, Math.min(22, Math.round(h * 0.4)));
  return (
    <FlexWidget
      style={{ flex: 1, height: 'match_parent', borderRadius: Math.min(16, Math.round(h / 2.4)), backgroundColor: fill, alignItems: 'center', justifyContent: 'center' }}
      clickAction="CALC" clickActionData={{ key: k }}
    >
      {k === 'DEL'
        ? <Glyph name="del" size={Math.round(size * 1.05)} color={ink} />
        : <Txt text={k === 'C' ? 'AC' : k} size={k === 'C' ? Math.round(size * 0.72) : size} face={op || eq ? 'med' : 'reg'} color={ink} fixed />}
    </FlexWidget>
  );
}

function Calculator({ pad, p, box }: { pad: CalcPad; p: PhonePalette; box: PhoneBox }) {
  const answer = pad.done ? '' : showsAnswer(pad.expr) ? padAnswer(pad.expr) : '';
  const open = openLink('calculator', { expr: pad.expr || undefined });
  const compact = box.height < PAD_MIN_H;
  const display = (
    <FlexWidget
      style={{
        width: 'match_parent', borderRadius: 16, backgroundColor: p.well, paddingHorizontal: 14, paddingVertical: 10,
        flexDirection: 'column', flexGap: 2, ...(compact ? { flex: 1, justifyContent: 'center' } : null),
      }}
      {...tap(open)}
    >
      <Row>
        <Kicker text="Calculator" p={p} />
        <Spacer />
        {pad.done ? <Txt text="Answer" size={11} face="sm" color={p.accent} fixed /> : null}
      </Row>
      <Txt
        text={pad.expr || '0'} size={answer ? 15 : 26} face={answer ? 'reg' : 'num'} color={answer || !pad.expr ? p.dim : p.text}
        align="right" fixed style={{ width: 'match_parent' }}
      />
      {answer ? <Txt text={'= ' + answer} size={22} face="num" color={p.text} align="right" fixed style={{ width: 'match_parent' }} /> : null}
    </FlexWidget>
  );
  if (compact) {
    return (
      <Frame p={p} uri={open} pad={12} gap={8}>
        {display}
        <Txt text="Tap to open the keypad" size={11} face="sm" color={p.faint} align="center" fixed style={{ width: 'match_parent' }} />
      </Frame>
    );
  }
  const gap = box.width > 260 ? 7 : 5;
  const keyH = Math.max(28, (box.height - 24 - 86 - 10 - gap * 4) / 5);
  return (
    <Frame p={p} uri={open} pad={12} gap={10}>
      {display}
      <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'column', flexGap: gap }}>
        {PAD_ROWS.map((row, i) => (
          <FlexWidget key={i} style={{ flex: 1, width: 'match_parent', flexDirection: 'row', flexGap: gap }}>
            {row.map((k) => <CalcKeyWidget key={k} k={k} p={p} h={keyH} />)}
          </FlexWidget>
        ))}
      </FlexWidget>
    </Frame>
  );
}

/* ---------------------------------------------------------------- tasks */

function NextUp({ m, p }: { m: NextUpModel; p: PhonePalette }) {
  if (!m.item) {
    return (
      <Frame p={p} uri={APP_LINK.addTodo}>
        <Kicker text="Next up" p={p} />
        <Empty p={p} glyph="check" title="All done" body="Tap to add a ToDo" />
      </Frame>
    );
  }
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Row>
        <Kicker text="Next up" p={p} color={m.item.late ? p.amber : undefined} />
        <Spacer />
        <Txt text={m.left + ' left'} size={11} face="sm" color={p.faint} fixed />
      </Row>
      <Spacer />
      <Txt text={m.item.title} size={15} face="semi" color={p.text} lines={3} />
      {m.item.sub ? <Txt text={m.item.sub} size={12} face="sm" color={m.item.late ? p.amber : p.faint} fixed /> : null}
      <Spacer />
      <Row>
        <Spacer />
        <Disc size={40} color={rgba(p.accent, 0.16)} glyph="check" glyphColor={p.accent} uri={m.uri} />
      </Row>
    </Frame>
  );
}

function Checklist({ m, p }: { m: ChecklistModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={4}>
      <Row>
        <Kicker text={m.left ? 'ToDos · ' + m.left + ' left' : 'ToDos'} p={p} />
        <Spacer />
        <Disc size={26} color={p.well} glyph="plus" glyphColor={p.accent} uri={APP_LINK.addTodo} />
      </Row>
      {m.rows.length
        ? m.rows.map((r) => <TodoRow key={r.id} r={r} p={p} compact />)
        : [<Empty key="e" p={p} glyph="check" title={m.done ? 'All done for today' : 'Nothing due today'} body="Tap + to add one" />]}
    </Frame>
  );
}

function Deadlines({ m, p }: { m: DeadlinesModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={6}>
      <Row>
        <Kicker text="Deadlines" p={p} />
        <Spacer />
        {m.more ? <Txt text={'+' + m.more + ' more'} size={11} face="sm" color={p.faint} fixed /> : null}
      </Row>
      {m.rows.length
        ? m.rows.map((r) => (
          <FlexWidget key={r.id} style={{ flexDirection: 'column', flexGap: 4, width: 'match_parent' }} {...tap(r.uri)}>
            <Row>
              <Txt text={r.title} size={13} color={p.text} style={{ flex: 1 }} />
              {r.steps ? <Txt text={r.steps} size={11} face="sm" color={p.faint} fixed /> : null}
              <Pill text={r.pill} p={p} color={r.late || r.days <= 1 ? p.amber : p.dim} />
            </Row>
            {r.steps ? <Bar frac={r.stepFrac} color={p.slate} track={p.well} height={3} /> : null}
          </FlexWidget>
        ))
        : [<Empty key="e" p={p} glyph="check" title="No deadlines" body="Long-term tasks show here with their days left" />]}
    </Frame>
  );
}

/* ---------------------------------------------------------------- deep work */

function QuickStart({ m, p }: { m: QuickStartModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Kicker text="Deep Work" p={p} />
      <FlexWidget style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
        <Disc size={56} color={p.accent} glyph={m.running ? 'pause' : 'play'} glyphColor={p.onAccent} uri={m.uri} />
      </FlexWidget>
      <Txt text={m.running ? 'Running · ' + minText(m.runningMin) : 'Start ' + minText(m.minutes)} size={13} face="semi" color={p.text} align="center" fixed style={{ width: 'match_parent' }} />
      <Txt text={minText(m.todayMin) + ' today'} size={11} face="sm" color={p.faint} align="center" fixed style={{ width: 'match_parent' }} />
    </Frame>
  );
}

function Session({ m, p }: { m: SessionModel; p: PhonePalette }) {
  if (m.live) {
    const l = m.live;
    return (
      <Frame p={p} uri={m.uri} pad={14} gap={6}>
        <Row>
          <Kicker text={l.paused ? 'Paused' : 'In session'} p={p} color={l.paused ? p.amber : p.accent} />
          <Spacer />
          {l.endsAt ? <Txt text={'Ends ' + l.endsAt} size={11} face="sm" color={p.faint} fixed /> : null}
        </Row>
        <Row gap={12}>
          <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
            <Txt text={minText(l.elapsedMin) + (l.countdown && l.targetMin ? ' of ' + minText(l.targetMin) : '')} size={26} face="num" color={p.text} fixed />
            <Txt text={l.subject || 'No subject'} size={12} face="sm" color={p.dim} />
          </FlexWidget>
          <Disc size={44} color={rgba(p.accent, 0.16)} glyph={l.paused ? 'play' : 'pause'} glyphColor={p.accent} uri={m.uri} />
        </Row>
        <Spacer />
        {l.countdown ? <Bar frac={l.frac} color={p.accent} track={p.well} /> : null}
      </Frame>
    );
  }
  const goal = m.goalMin > 0;
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={8}>
      <Row>
        <Kicker text="Deep Work" p={p} />
        <Spacer />
        <Txt text={minText(m.todayMin) + (goal ? ' of ' + minText(m.goalMin) : ' today')} size={11} face="sm" color={p.faint} fixed />
      </Row>
      {goal ? <Bar frac={m.todayMin / m.goalMin} color={p.green} track={p.well} /> : null}
      <Spacer />
      <Row gap={8}>
        {m.presets.map((x) => (
          <FlexWidget
            key={String(x.minutes)}
            style={{ flex: 1, height: 44, borderRadius: 14, backgroundColor: p.well, alignItems: 'center', justifyContent: 'center' }}
            {...tap(x.uri)}
          >
            <Txt text={String(x.minutes)} size={17} face="med" color={p.text} fixed />
            <Txt text="min" size={11} face="sm" color={p.faint} fixed />
          </FlexWidget>
        ))}
      </Row>
    </Frame>
  );
}

function FocusWeek({ m, p, box }: { m: FocusWeekModel; p: PhonePalette; box: PhoneBox }) {
  const barH = Math.max(60, Math.min(150, box.height - 150));
  return (
    <Frame p={p} uri={m.uri} gap={10}>
      <Row>
        <Kicker text="Focus week" p={p} />
        <Spacer />
        <Txt text={minText(m.totalMin)} size={13} face="med" color={p.text} fixed />
      </Row>
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', width: 'match_parent', height: barH + 18, flexGap: 8 }}>
        {m.days.map((d, i) => {
          const h = Math.round((d.min / m.maxMin) * barH);
          return (
            <FlexWidget key={String(i)} style={{ flex: 1, flexDirection: 'column', alignItems: 'center', flexGap: 4 }}>
              <FlexWidget style={{ width: 'match_parent', height: Math.max(3, h), borderRadius: 5, backgroundColor: d.min ? undefined : p.well, flexDirection: 'column', overflow: 'hidden' }}>
                {d.min ? d.parts.map((x, j) => (
                  <FlexWidget key={String(j)} style={{ width: 'match_parent', flex: Math.max(1, x.min), backgroundColor: x.color as ColorProp }} />
                )) : null}
              </FlexWidget>
              <Txt text={d.label} size={11} face={d.today ? 'smMed' : 'sm'} color={d.today ? p.text : p.faint} fixed />
            </FlexWidget>
          );
        })}
      </FlexWidget>
      <Row gap={10}>
        {m.subjects.map((s) => (
          <Row key={s.name} gap={5} style={{ width: 'wrap_content' }}>
            <FlexWidget style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s.color as ColorProp }} />
            <Txt text={s.name} size={11} face="sm" color={p.dim} fixed />
          </Row>
        ))}
      </Row>
      <Spacer />
      <Row>
        <Txt text={m.streak ? m.streak + (m.streak === 1 ? '-day streak' : '-day streak') : 'No streak yet'} size={12} face="sm" color={p.dim} style={{ flex: 1 }} />
        {m.best ? <Txt text={'Best ' + m.best} size={12} face="sm" color={p.faint} fixed /> : null}
      </Row>
    </Frame>
  );
}

/* ---------------------------------------------------------------- planner */

function NowNext({ m, p }: { m: NowNextModel; p: PhonePalette }) {
  const b = m.block;
  if (!b) {
    return (
      <Frame p={p} uri={m.uri}>
        <Kicker text="Planner" p={p} />
        <Empty p={p} glyph="check" title="Nothing planned" body="Blocks you plan show here" />
      </Frame>
    );
  }
  const tint = hexOf(b.color, p);
  const on = b.tag === 'NOW';
  const svg = ringSvg({ size: 64, stroke: 6, frac: on ? b.progress : 0, color: tint, track: p.well });
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Kicker text={on ? 'Now' : b.tag === 'NEXT UP' ? 'Next' : 'Tomorrow'} p={p} color={tint} />
      <FlexWidget style={{ flex: 1, width: 'match_parent', alignItems: 'center', justifyContent: 'center' }}>
        <OverlapWidget style={{ width: 64, height: 64 }}>
          <SvgWidget svg={svg} style={{ width: 64, height: 64 }} />
          <FlexWidget style={{ width: 64, height: 64, alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <Txt text={on ? String(b.minLeft) : '·'} size={on ? 18 : 22} face="num" color={p.text} fixed />
            {on ? <Txt text="min" size={11} face="sm" color={p.faint} fixed /> : null}
          </FlexWidget>
        </OverlapWidget>
      </FlexWidget>
      <Txt text={b.subject} size={14} face="semi" color={p.text} />
      <Txt text={b.range} size={11} face="sm" color={p.faint} fixed />
    </Frame>
  );
}

function TodaysBlocks({ m, p, box }: { m: TodaysBlocksModel; p: PhonePalette; box: PhoneBox }) {
  const w = Math.max(120, Math.round(box.width - PAD * 2));
  const h = 30;
  let rects = '';
  for (const b of m.blocks) {
    const x = (b.from * w).toFixed(1);
    const bw = Math.max(3, (b.to - b.from) * w - 2).toFixed(1);
    rects += `<rect x="${x}" y="${b.on ? 0 : 4}" width="${bw}" height="${b.on ? h : h - 8}" rx="6" fill="${hexOf(b.color, p)}" fill-opacity="${b.on ? 1 : 0.7}"/>`;
  }
  if (m.nowAt >= 0) {
    const x = (m.nowAt * w).toFixed(1);
    rects += `<rect x="${x}" y="0" width="2" height="${h}" rx="1" fill="${p.text}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="12" width="${w}" height="6" rx="3" fill="${p.well}"/>${rects}</svg>`;
  const on = m.blocks.find((b) => b.on);
  const next = m.blocks.find((b) => b.from >= Math.max(0, m.nowAt) && !b.on);
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={8}>
      <Row>
        <Kicker text="Today's blocks" p={p} />
        <Spacer />
        <Txt text={m.blocks.length + (m.blocks.length === 1 ? ' block' : ' blocks')} size={11} face="sm" color={p.faint} fixed />
      </Row>
      {m.blocks.length ? (
        <FlexWidget style={{ flexDirection: 'column', flexGap: 4, width: 'match_parent' }}>
          <SvgWidget svg={svg} style={{ width: w, height: h }} />
          <Row>
            <Txt text={m.startLabel} size={11} face="sm" color={p.faint} fixed />
            <Spacer />
            <Txt text={m.endLabel} size={11} face="sm" color={p.faint} fixed />
          </Row>
        </FlexWidget>
      ) : (
        <Txt text="Nothing planned today" size={13} face="sm" color={p.faint} />
      )}
      <Spacer />
      {on || next ? (
        <Row>
          <Txt text={(on ? 'Now · ' : 'Next · ') + (on || next)!.subject} size={13} face="med" color={p.text} style={{ flex: 1 }} uri={(on || next)!.uri} />
          <Txt text={(on || next)!.time} size={11} face="sm" color={p.faint} fixed />
        </Row>
      ) : null}
    </Frame>
  );
}

function HabitGrid({ m, p }: { m: HabitGridModel; p: PhonePalette }) {
  const cell = 14;
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={5}>
      <Row gap={6}>
        <Kicker text="Habits" p={p} />
        <Spacer />
        {m.days.map((d, i) => (
          <FlexWidget key={String(i)} style={{ width: cell, alignItems: 'center' }}>
            <Txt text={d.label} size={11} face={d.today ? 'smMed' : 'sm'} color={d.today ? p.text : p.faint} fixed />
          </FlexWidget>
        ))}
      </Row>
      {m.habits.length
        ? m.habits.map((h) => (
          <Row key={h.id} gap={6}>
            <Txt text={h.title} size={13} color={p.text} style={{ flex: 1 }} />
            {h.cells.map((c, i) => (
              <FlexWidget
                key={String(i)}
                style={{
                  width: cell, height: cell, borderRadius: 4,
                  backgroundColor: c === 'done' ? p.green : c === 'rest' ? p.bg : p.well,
                  ...(c === 'open' ? { borderWidth: 1.5, borderColor: p.green } : c === 'rest' ? { borderWidth: 1, borderColor: p.line } : null),
                }}
                {...(i === h.cells.length - 1 ? tap(h.uri) : null)}
              />
            ))}
          </Row>
        ))
        : [<Empty key="e" p={p} glyph="check" title="No habits yet" body="Add one in the Planner" />]}
      {m.more ? <Txt text={'+' + m.more + ' more'} size={11} face="sm" color={p.faint} fixed /> : null}
    </Frame>
  );
}

function Streak({ m, p }: { m: StreakModel | null; p: PhonePalette }) {
  if (!m || m.current === 0) {
    return (
      <Frame p={p} uri={m?.uri || 'sturoids://open?tool=planner'}>
        <Kicker text="Streak" p={p} />
        <Empty p={p} glyph="flame" title={m ? 'Start a new run' : 'No habits yet'} body={m ? 'Best so far: ' + m.best + (m.best === 1 ? ' day' : ' days') : 'Add one in the Planner'} />
      </Frame>
    );
  }
  const tint = m.atRisk ? p.amber : p.gold;
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Kicker text={m.atRisk ? 'Due today' : 'Streak'} p={p} color={m.atRisk ? p.amber : undefined} />
      <Spacer />
      <Row gap={6}>
        <Glyph name="flame" size={26} color={tint} fill={!m.atRisk} />
        <Txt text={String(m.current)} size={34} face="num" color={p.text} fixed />
      </Row>
      <Txt text={m.title} size={13} face="semi" color={p.text} />
      <Txt text={m.current === m.best ? 'Your best run' : 'Best ' + m.best} size={11} face="sm" color={p.faint} fixed />
    </Frame>
  );
}

/* ---------------------------------------------------------------- notes */

function NewNote({ m, p }: { m: NewNoteModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Row>
        <Kicker text="Notes" p={p} />
        <Spacer />
        <Disc size={36} color={p.green} glyph="plus" glyphColor={p.onAccent} uri={m.uri} />
      </Row>
      <Spacer />
      <Txt text="New note" size={15} face="semi" color={p.text} />
      {m.last ? (
        <Txt text={'Last: ' + m.last.title} size={12} face="sm" color={p.faint} uri={m.last.uri} />
      ) : (
        <Txt text="Capture a thought" size={12} face="sm" color={p.faint} />
      )}
    </Frame>
  );
}

function NoteCard({ n, p, wide }: { n: NotesModel['rows'][number]; p: PhonePalette; wide?: boolean }) {
  return (
    <FlexWidget
      style={{ flex: wide ? undefined : 1, width: wide ? 'match_parent' : undefined, flexDirection: 'column', flexGap: 3, backgroundColor: p.well, borderRadius: 14, padding: 10 }}
      {...tap(n.uri)}
    >
      <Row gap={6}>
        {n.locked ? <Glyph name="lock" size={12} color={p.faint} /> : null}
        <Txt text={n.title} size={13} face="semi" color={p.text} style={{ flex: 1 }} />
        {wide && n.when ? <Txt text={n.when} size={11} face="sm" color={p.faint} fixed /> : null}
      </Row>
      {n.excerpt ? <Txt text={n.excerpt} size={12} face="sm" color={p.dim} lines={wide ? 1 : 3} /> : null}
      {wide && n.folder ? <Txt text={n.folder} size={11} face="sm" color={p.faint} fixed /> : null}
    </FlexWidget>
  );
}

function Pinned({ m, p }: { m: NotesModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={8}>
      <Kicker text="Pinned" p={p} />
      {m.rows.length ? (
        <FlexWidget style={{ flexDirection: 'row', flex: 1, width: 'match_parent', flexGap: 8 }}>
          {m.rows.map((n) => <NoteCard key={n.id} n={n} p={p} />)}
        </FlexWidget>
      ) : (
        <Empty p={p} glyph="note" title="No pinned notes" body="Pin a note to keep it here" />
      )}
    </Frame>
  );
}

function RecentNotes({ m, p, box }: { m: NotesModel; p: PhonePalette; box: PhoneBox }) {
  const room = Math.max(2, Math.floor((box.height - 60) / 64));
  return (
    <Frame p={p} uri={m.uri} gap={8}>
      <Row>
        <Kicker text="Recent notes" p={p} />
        <Spacer />
        <Disc size={26} color={p.well} glyph="plus" glyphColor={p.green} uri={APP_LINK.newNote} />
      </Row>
      {m.rows.length
        ? m.rows.slice(0, room).map((n) => <NoteCard key={n.id} n={n} p={p} wide />)
        : [<Empty key="e" p={p} glyph="note" title="No notes yet" body="Tap + to write one" />]}
    </Frame>
  );
}

/* ---------------------------------------------------------------- journal */

function WriteToday({ m, p }: { m: WriteTodayModel; p: PhonePalette }) {
  const written = m.words > 0;
  return (
    <Frame p={p} uri={m.uri} pad={14}>
      <Row>
        <Kicker text={m.yesterday ? 'Last night' : 'Today'} p={p} color={p.gold} />
        <Spacer />
        <Glyph name="pen" size={16} color={p.gold} />
      </Row>
      <Spacer />
      {written ? (
        <FlexWidget style={{ flexDirection: 'column', flexGap: 2 }}>
          <Txt text={String(m.words)} size={30} face="num" color={p.text} fixed />
          <Txt text={(m.words === 1 ? 'word' : 'words') + (m.goal ? ' of ' + m.goal : '')} size={11} face="sm" color={p.faint} fixed />
        </FlexWidget>
      ) : (
        <FlexWidget style={{ flexDirection: 'column', flexGap: 4 }}>
          <Txt text="Not written yet" size={14} face="semi" color={p.text} />
          {m.prompt ? <Txt text={m.prompt} size={12} face="sm" color={p.dim} lines={3} /> : null}
        </FlexWidget>
      )}
      <Spacer />
      {m.goal && written ? <Bar frac={m.words / m.goal} color={p.gold} track={p.well} /> : null}
      {m.streak ? <Txt text={m.streak + '-day run'} size={11} face="sm" color={p.faint} fixed /> : null}
    </Frame>
  );
}

function MoodStrip({ m, p }: { m: MoodStripModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={8}>
      <Row>
        <Kicker text="Mood · 14 days" p={p} />
        <Spacer />
        <Txt text={m.streak ? m.streak + '-day run' : m.written + ' of 14 written'} size={11} face="sm" color={p.faint} fixed />
      </Row>
      <Spacer />
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'flex-end', width: 'match_parent', flexGap: 4, height: 54 }}>
        {m.days.map((d, i) => (
          <FlexWidget key={String(i)} style={{ flex: 1, flexDirection: 'column', alignItems: 'center', flexGap: 4 }}>
            <FlexWidget
              style={{
                width: 'match_parent', height: d.mood ? 10 + d.mood * 6 : 6, borderRadius: 4,
                backgroundColor: d.mood ? (MOOD_COLORS[d.mood - 1] as ColorProp) : p.well,
                ...(d.today ? { borderWidth: 1.5, borderColor: p.text } : null),
              }}
            />
            {d.rating ? <FlexWidget style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: p.gold }} /> : <FlexWidget style={{ width: 4, height: 4 }} />}
          </FlexWidget>
        ))}
      </FlexWidget>
    </Frame>
  );
}

function OnThisDay({ m, p }: { m: OnThisDayModel; p: PhonePalette }) {
  const e = m.entry;
  return (
    <Frame p={p} uri={e ? e.uri : m.uri} pad={14} gap={6}>
      <Kicker text={e ? 'On this day · ' + e.when : 'On this day'} p={p} color={p.gold} />
      {e ? (
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 4, width: 'match_parent' }}>
          <Txt text={e.title} size={16} face="head" color={p.text} />
          {e.excerpt ? <Txt text={e.excerpt} size={12} face="sm" color={p.dim} lines={3} /> : null}
        </FlexWidget>
      ) : (
        <Empty p={p} glyph="pen" title="Nothing from this day yet" body="A month from now, today's page shows here" />
      )}
    </Frame>
  );
}

/* ---------------------------------------------------------------- scores */

function Countdown({ m, p }: { m: CountdownModel; p: PhonePalette }) {
  const e = m.exam;
  if (!e) {
    return (
      <Frame p={p} uri={m.uri}>
        <Kicker text="Next exam" p={p} />
        <Empty p={p} glyph="check" title="No exams ahead" body="A dated exam counts down here" />
      </Frame>
    );
  }
  const soon = e.days <= 1;
  return (
    <Frame p={p} uri={e.uri} pad={14}>
      <Kicker text="Next exam" p={p} color={soon ? p.amber : p.accent} />
      <Spacer />
      <Txt text={e.days <= 0 ? 'Today' : String(e.days)} size={e.days <= 0 ? 30 : 40} face="num" color={p.text} fixed />
      {e.days > 0 ? <Txt text={e.days === 1 ? 'day to go' : 'days to go'} size={11} face="sm" color={p.faint} fixed /> : null}
      <Spacer />
      <Txt text={e.title} size={13} face="semi" color={p.text} />
      <Txt text={e.date} size={11} face="sm" color={p.faint} fixed />
    </Frame>
  );
}

function Move({ move, p }: { move: 'up' | 'down' | 'level' | 'none'; p: PhonePalette }) {
  if (move === 'none') return <FlexWidget style={{ width: 14, height: 14 }} />;
  return <Glyph name={move} size={14} color={move === 'up' ? p.green : move === 'down' ? p.danger : p.faint} />;
}

function Results({ m, p }: { m: ResultsModel; p: PhonePalette }) {
  return (
    <Frame p={p} uri={m.uri} pad={14} gap={6}>
      <Kicker text="Results" p={p} />
      {m.rows.length
        ? m.rows.map((r) => (
          <Row key={r.id} gap={10} style={{ paddingVertical: 3 }}>
            <Txt text={r.title} size={13} color={p.text} style={{ flex: 1 }} uri={r.uri} />
            <Txt text={r.pct} size={14} face="med" color={p.text} fixed />
            <Move move={r.move} p={p} />
          </Row>
        ))
        : [<Empty key="e" p={p} glyph="check" title="No results yet" body="Marked exams show here with how they moved" />]}
    </Frame>
  );
}

function SubjectTrend({ m, p, box }: { m: SubjectTrendModel | null; p: PhonePalette; box: PhoneBox }) {
  if (!m) {
    return (
      <Frame p={p} uri="sturoids://open?tool=scores">
        <Kicker text="Subject trend" p={p} />
        <Empty p={p} glyph="up" title="No subject results yet" body="Mark an exam's subjects and the latest one's trend draws here" />
      </Frame>
    );
  }
  const w = Math.max(120, Math.round(box.width - PAD * 2));
  const h = Math.max(70, Math.min(180, Math.round(box.height - 150)));
  const tint = m.move === 'up' ? p.green : m.move === 'down' ? p.danger : p.faint;
  return (
    <Frame p={p} uri={m.uri} gap={8}>
      <Row>
        <Kicker text="Subject trend" p={p} />
        <Spacer />
        <Pill text={m.subject} p={p} color={p.text} />
      </Row>
      <Row gap={10}>
        <Txt text={m.last} size={32} face="num" color={p.text} fixed />
        {m.delta ? <Txt text={m.delta} size={12} face="sm" color={tint} fixed /> : null}
      </Row>
      <SvgWidget svg={trendSvg(m.values, w, h, p.accent, p.faint)} style={{ width: w, height: h }} />
      <Spacer />
      <Txt text={m.note} size={11} face="sm" color={p.faint} />
    </Frame>
  );
}

/* ---------------------------------------------------------------- vault */

function Thumb({ v, p, w, h }: { v: VideosModel['rows'][number]; p: PhonePalette; w: number; h: number }) {
  return (
    <OverlapWidget style={{ width: w, height: h }} {...tap(v.uri)}>
      <FlexWidget style={{ width: w, height: h, borderRadius: 10, backgroundColor: p.well, alignItems: 'center', justifyContent: 'center' }}>
        <Glyph name="play" size={18} color={p.pink} />
      </FlexWidget>
      <ImageWidget image={v.thumb as `https:${string}`} imageWidth={w} imageHeight={h} radius={10} />
    </OverlapWidget>
  );
}

function ContinueWatching({ m, p, box }: { m: VideosModel; p: PhonePalette; box: PhoneBox }) {
  const v = m.rows[0];
  if (!v) {
    return (
      <Frame p={p} uri={m.uri}>
        <Kicker text="Continue watching" p={p} />
        <Empty p={p} glyph="play" title="No videos yet" body="Add a YouTube link to the Vault" />
      </Frame>
    );
  }
  const th = Math.max(56, Math.min(90, box.height - PAD * 2 - 24));
  const tw = Math.round((th * 16) / 9);
  return (
    <Frame p={p} uri={v.uri} pad={14} gap={8}>
      <Kicker text="Continue watching" p={p} color={p.pink} />
      <Row gap={12} style={{ alignItems: 'flex-start' }}>
        <Thumb v={v} p={p} w={tw} h={th} />
        <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 4 }}>
          <Txt text={v.title} size={13} face="semi" color={p.text} lines={2} />
          <Txt text={v.left} size={11} face="sm" color={p.faint} fixed />
        </FlexWidget>
      </Row>
    </Frame>
  );
}

function WatchList({ m, p, box }: { m: VideosModel; p: PhonePalette; box: PhoneBox }) {
  const th = Math.max(44, Math.min(64, Math.floor((box.height - 60) / 3) - 12));
  const tw = Math.round((th * 16) / 9);
  return (
    <Frame p={p} uri={m.uri} gap={10}>
      <Kicker text="Watch list" p={p} color={p.pink} />
      {m.rows.length
        ? m.rows.map((v) => (
          <Row key={v.id} gap={12} style={{ alignItems: 'flex-start' }}>
            <Thumb v={v} p={p} w={tw} h={th} />
            <FlexWidget style={{ flex: 1, flexDirection: 'column', flexGap: 3 }} {...tap(v.uri)}>
              <Txt text={v.title} size={13} face="semi" color={p.text} lines={2} />
              <Txt text={v.left} size={11} face="sm" color={p.faint} fixed />
            </FlexWidget>
          </Row>
        ))
        : [<Empty key="e" p={p} glyph="play" title="No videos yet" body="Add a YouTube link to the Vault" />]}
    </Frame>
  );
}

/* ---------------------------------------------------------------- ai */

function AiDock({ m, p }: { m: AiDockModel; p: PhonePalette }) {
  const tile = (l: AiDockModel['links'][number]) => (
    <FlexWidget
      key={l.id}
      style={{ flex: 1, height: 'match_parent', borderRadius: 14, backgroundColor: p.well, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', flexGap: 2 }}
      {...tap(l.uri)}
    >
      <Txt text={l.initial} size={17} face="semi" color={p.accent} fixed />
      <Txt text={l.label} size={11} face="sm" color={p.dim} fixed />
    </FlexWidget>
  );
  if (!m.links.length) {
    return (
      <Frame p={p} uri={m.uri}>
        <Kicker text="AI dock" p={p} />
        <Empty p={p} glyph="arrow" title="No AI links" body="Add them in AI Quick-Links" />
      </Frame>
    );
  }
  const top = m.links.slice(0, 2);
  const bottom = m.links.slice(2, 4);
  return (
    <Frame p={p} uri={m.uri} pad={10} gap={8}>
      <FlexWidget style={{ flexDirection: 'row', flex: 1, width: 'match_parent', flexGap: 8 }}>{top.map(tile)}</FlexWidget>
      {bottom.length ? <FlexWidget style={{ flexDirection: 'row', flex: 1, width: 'match_parent', flexGap: 8 }}>{bottom.map(tile)}</FlexWidget> : null}
    </Frame>
  );
}

/* ---------------------------------------------------------------- one widget */

/**
 * A widget drawn from the saved data: its gate (archived or locked) when there is one, else its content.
 * `model` may be passed when it was worked out already (the app's updater compares models before it draws).
 */
export function renderPhoneWidget(name: PhoneWidgetName, d: PhoneData, box: PhoneBox, now: Date, model?: unknown): React.JSX.Element {
  const p = paletteOf(d.settings);
  const gate = gateOf(name, d);
  if (gate) return <GateWidget gate={gate} p={p} />;
  const m: any = model !== undefined ? model : modelFor(name, d, now);
  switch (name) {
    case 'DayRing': return <DayRing m={m} p={p} />;
    case 'AtAGlance': return <AtAGlance m={m} p={p} />;
    case 'Agenda': return <Agenda m={m} p={p} box={box} />;
    case 'Clock': return <Clock m={m} p={p} box={box} />;
    case 'Search': return <Search p={p} />;
    case 'NextUp': return <NextUp m={m} p={p} />;
    case 'Checklist': return <Checklist m={m} p={p} />;
    case 'Deadlines': return <Deadlines m={m} p={p} />;
    case 'QuickStart': return <QuickStart m={m} p={p} />;
    case 'Session': return <Session m={m} p={p} />;
    case 'FocusWeek': return <FocusWeek m={m} p={p} box={box} />;
    case 'NowNext': return <NowNext m={m} p={p} />;
    case 'TodaysBlocks': return <TodaysBlocks m={m} p={p} box={box} />;
    case 'HabitGrid': return <HabitGrid m={m} p={p} />;
    case 'Streak': return <Streak m={m} p={p} />;
    case 'NewNote': return <NewNote m={m} p={p} />;
    case 'Pinned': return <Pinned m={m} p={p} />;
    case 'RecentNotes': return <RecentNotes m={m} p={p} box={box} />;
    case 'WriteToday': return <WriteToday m={m} p={p} />;
    case 'MoodStrip': return <MoodStrip m={m} p={p} />;
    case 'OnThisDay': return <OnThisDay m={m} p={p} />;
    case 'Countdown': return <Countdown m={m} p={p} />;
    case 'Results': return <Results m={m} p={p} />;
    case 'SubjectTrend': return <SubjectTrend m={m} p={p} box={box} />;
    case 'ContinueWatching': return <ContinueWatching m={m} p={p} box={box} />;
    case 'WatchList': return <WatchList m={m} p={p} box={box} />;
    case 'AiDock': return <AiDock m={m} p={p} />;
    case 'Calculator': return <Calculator pad={(m as CalcPad | null) || EMPTY_PAD} p={p} box={box} />;
  }
}

/** A widget that could not be drawn from its data: a calm card that opens the app, never a blank or broken one. */
export function fallbackWidget(): React.JSX.Element {
  const p = paletteOf({ theme: 'default', accent: '#9588F9' });
  return (
    <Frame p={p} uri="">
      <Kicker text="Sturoids" p={p} />
      <Empty p={p} glyph="arrow" title="Open Sturoids" body="This widget fills in once the app has run" />
    </Frame>
  );
}
