import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { C, F, S, T, TRACK, oneLine } from '../theme';
import { useStore } from '../store';
import { dayName, fmtClockTime, toMinutes } from '../utils';
import { Card, Row } from '../components/UI';
import { FadeSwap } from '../components/Motion';
import { openTool } from '../toolNav';
import { blockFocusParams } from '../blocks';
import { FlatLine, FlowPlaceholder, NudgeRow, kit, spokenMinutes, useBoardNow, LINK_SLOP } from './kit';
import { useNextBlock } from './data';
import { otherDaysPlanned } from './logic';
import type { WidgetProps } from './types';

/**
 * Next block: the block on now (or next, or tomorrow's first) as a card that opens the Planner, with a Start pill on a
 * block on now or next that opens Deep Work on its subject for its length (or what is left of it); a nudge to plan on a
 * day with nothing planned in a week that has plans; and, while a Deep Work session runs, one quiet line saying what and
 * for how long.
 */
export function PlanWidget({ editing }: WidgetProps) {
  const now = useBoardNow();
  const hidePlanner = useStore((s) => s.settings.archivedTools.includes('planner'));
  const hideFocus = useStore((s) => s.settings.archivedTools.includes('focus'));
  const hour24 = useStore((s) => s.settings.hour24);
  const planner = useStore((s) => s.planner);
  const nextBlock = useNextBlock();
  const nextBlockKey = nextBlock ? nextBlock.block.id + ':' + nextBlock.tag : '';
  const blocksToday = (planner[dayName(now)] || []).length;
  const weekHasOtherBlocks = React.useMemo(() => otherDaysPlanned(planner, now), [planner, dayName(now)]);
  // the Deep Work session in flight, to the minute
  const dwOn = useStore((s) => !!s.deepWork);
  const dwRunning = useStore((s) => !!s.deepWork?.running);
  const dwStartTs = useStore((s) => s.deepWork?.startTs ?? null);
  const dwAccumSec = useStore((s) => s.deepWork?.accumSec ?? 0);
  const dwCapSec = useStore((s) => (s.deepWork?.mode === 'countdown' ? s.deepWork.targetMin * 60 : Infinity));
  const dwSubject = useStore((s) => s.deepWork?.subject ?? '');
  const sessionMin = dwOn
    ? Math.floor(Math.min(dwCapSec, dwAccumSec + (dwRunning && dwStartTs ? Math.max(0, now.getTime() - dwStartTs) / 1000 : 0)) / 60)
    : 0;

  const planNudge = !hidePlanner && !nextBlock && !blocksToday && weekHasOtherBlocks;
  const showCard = !!nextBlock && !hidePlanner;
  const showSession = dwOn && !hideFocus;
  // a block on now or next can be started from here, unless a session is already going
  const canStart = showCard && !dwOn && !hideFocus && nextBlock!.tag !== 'TOMORROW';
  const startBlock = () => {
    if (!nextBlock) return;
    const p = blockFocusParams(nextBlock.block, nextBlock.tag === 'NOW', new Date());
    openTool('focus', { subject: p.subject, minutes: p.minutes });
  };

  if (!showCard && !planNudge && !showSession) {
    return editing ? <FlowPlaceholder title="Next block" note="Shows the block on now or next, and a session in flight." /> : null;
  }
  const sessionSaid = sessionMin > 0 ? sessionMin + ' min' : 'just started';
  return (
    <View>
      {showCard ? (
        <Card hero pad={S.cardPad} onPress={() => openTool('planner')}>
          {/* when one block ends and the next takes the card, the old one dips out and the new one comes up */}
          <FadeSwap swapKey={nextBlockKey}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row style={{ flex: 1 }}>
                <View style={[st.blockBar, { backgroundColor: nextBlock!.block.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={T.head} numberOfLines={1}>{nextBlock!.block.subject}</Text>
                  <Text style={[T.caption, st.blockSpan]}>
                    {/* a block that runs to the end of the day ends at midnight, as the Planner says */}
                    {fmtClockTime(toMinutes(nextBlock!.block.start), hour24)} – {toMinutes(nextBlock!.block.end) >= 1440 ? 'midnight' : fmtClockTime(toMinutes(nextBlock!.block.end), hour24)}
                  </Text>
                </View>
              </Row>
              {canStart ? (
                <Pressable
                  onPress={startBlock} hitSlop={LINK_SLOP}
                  accessibilityRole="button" accessibilityLabel={'Start ' + nextBlock!.block.subject}
                  accessibilityHint="Opens Deep Work for this block"
                  style={[st.startPill, { backgroundColor: C.accent }]}
                >
                  <Text style={[st.startText, { color: C.onAccent }]}>Start</Text>
                </Pressable>
              ) : null}
              <View style={[st.tagPill, { borderColor: C.accent + '55', backgroundColor: C.accent + '18' }]}>
                <Text style={[st.tagText, { color: C.accent }]}>{nextBlock!.tag}</Text>
              </View>
            </Row>
          </FadeSwap>
        </Card>
      ) : null}
      {planNudge ? (
        <NudgeRow
          icon="calendar-outline" iconColor={C.textFaint} text="No blocks planned today" action="Plan" actionColor={C.accent}
          onPress={() => openTool('planner')} style={{ marginTop: 0, marginBottom: S.gap }}
        />
      ) : null}
      {showSession ? (
        <FlatLine
          icon="hourglass-outline" onPress={() => openTool('focus')} hint="Opens the session"
          label={'Deep Work' + (dwSubject ? ', ' + dwSubject : '') + ', '
            + (sessionMin > 0 ? spokenMinutes(sessionMin) : 'just started') + (dwRunning ? '' : ', paused')}
        >
          <Text style={kit.flatEm}>Deep Work</Text>
          {(dwSubject ? ' · ' + dwSubject : '') + ' · ' + sessionSaid + (dwRunning ? '' : ' · paused')}
        </FlatLine>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  blockBar: { width: 4, height: 34, borderRadius: 2, marginRight: 12 },
  tagPill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4, marginLeft: 10 },
  tagText: { fontFamily: F.smSemi, fontSize: 11, letterSpacing: TRACK.caps },
  // the next block's times: tabular figures, so Inter Tight
  blockSpan: { marginTop: 2, fontFamily: F.reg, fontVariant: ['tabular-nums'] },
  startPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginLeft: 10 },
  startText: { fontFamily: F.smSemi, ...oneLine(12), letterSpacing: TRACK.small },
});
