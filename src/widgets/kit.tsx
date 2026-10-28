import React from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle } from 'react-native-svg';
import { C, CHROME_FONT_MAX, F, MIN, S, T, TRACK, neuInset, neuRaised, oneLine } from '../theme';
import type { WidgetSize } from '../store';
import { useStore } from '../store';
import { todayKey } from '../utils';
import { useTheme } from '../components/UI';
import { Bouncy, CountUp } from '../components/Motion';
import { heightOf } from './logic';
import type { ToolKey } from '../tools';

/* ---------------------------------------------------------------- the board's clock */

/**
 * The time Today's board shows, to the minute: the board reads it once (useNow) and hands it down, so twenty widgets
 * share one timer, and a minute turning re-renders only the widgets that read it.
 */
export const BoardNow = React.createContext<Date | null>(null);
export const useBoardNow = (): Date => React.useContext(BoardNow) ?? new Date();
export const useBoardToday = (): string => todayKey(useBoardNow());

/**
 * A figure that changed while Today was out of sight is held where it was, and moves to its new value once Today is back
 * in view: the count or the bar plays where it can be seen, not behind another tab.
 */
export function useWhenSeen<T>(value: T): T {
  const focused = useIsFocused();
  const held = React.useRef(value);
  if (focused) held.current = value;
  return held.current;
}

/** Whether a tool is archived: its widgets step out of Today. */
export const useArchived = (key: ToolKey) => useStore((s) => s.settings.archivedTools.includes(key));

/* ---------------------------------------------------------------- the tile */

/** a tile's text grows with the phone's font size only this far: a tile is a fixed height */
export const TILE_TEXT_MAX = CHROME_FONT_MAX;

/**
 * A widget's tile: a raised surface of the size's fixed height, its padding the cards' own. Pressable when it opens
 * something as a whole; its parts can still take their own taps.
 */
export function Tile({ size, onPress, label, hint, children, style, pad = S.cardPad }: {
  size: WidgetSize; onPress?: () => void; label?: string; hint?: string; children: React.ReactNode;
  style?: ViewStyle; pad?: number;
}) {
  const theme = useTheme();
  const surface: ViewStyle = theme === 'minimal'
    ? { backgroundColor: MIN.card, borderWidth: 1, borderColor: MIN.border }
    : { backgroundColor: C.card, ...neuRaised('mid') };
  const box = [kit.tile, surface, { height: heightOf(size), padding: pad }, style];
  if (!onPress) {
    return (
      <View style={box} accessible={label ? true : undefined} accessibilityLabel={label} accessibilityHint={hint}>
        {children}
      </View>
    );
  }
  return (
    <Bouncy onPress={onPress} radius={S.radius} scaleTo={0.985} style={box} accessibilityLabel={label} accessibilityHint={hint}>
      {children}
    </Bouncy>
  );
}

/** A tile's small heading, in its tool's colour when given. */
export function Kicker({ children, color, style }: { children: React.ReactNode; color?: string; style?: any }) {
  return (
    <Text style={[T.kicker, color ? { color } : null, style]} numberOfLines={1} maxFontSizeMultiplier={TILE_TEXT_MAX}>
      {children}
    </Text>
  );
}

/** A quiet line inside a tile with nothing to show yet. */
export function TileNote({ icon, title, body, color }: { icon: any; title: string; body?: string; color?: string }) {
  return (
    <View style={kit.note}>
      <Ionicons name={icon} size={20} color={color || C.textFaint} />
      <Text style={kit.noteTitle} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{title}</Text>
      {body ? <Text style={kit.noteBody} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{body}</Text> : null}
    </View>
  );
}

/** A locked tool's tile says only that it is locked; a tap opens the tool, which asks for the PIN. */
export function LockedNote({ what }: { what: string }) {
  return <TileNote icon="lock-closed-outline" title={what + ' locked'} body="Open it to unlock" />;
}

/* ---------------------------------------------------------------- marks */

/**
 * A ring of progress, 0 to 1, over its carved track: drawn still (a ring's sweep is not a transform), so it changes in
 * a step with the figure beside it.
 */
export function Ring({ size, stroke, value, color, track = true }: {
  size: number; stroke: number; value: number; color: string; track?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
      {track ? <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.inset} strokeWidth={stroke} fill="none" /> : null}
      {p > 0 ? (
        <Circle
          cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${c} ${c}`} strokeDashoffset={c * (1 - p)}
        />
      ) : null}
    </Svg>
  );
}

/** A slim carved track with its fill: a widget's progress bar. */
export function Track({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const theme = useTheme();
  const p = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View
      style={[
        { height, borderRadius: height / 2, overflow: 'hidden' },
        theme === 'minimal' ? { backgroundColor: MIN.inset } : { backgroundColor: C.inset, ...neuInset('hairline') },
      ]}
    >
      <View style={{ width: `${Math.round(p * 1000) / 10}%`, height: '100%', borderRadius: height / 2, backgroundColor: color || C.accent }} />
    </View>
  );
}

/** "D-3" (or "Today") in a small tinted pill: how many days off something is. */
export function DayPill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[kit.pill, { backgroundColor: color + '1C', borderColor: color + '55' }]}>
      <Text style={[kit.pillText, { color }]} maxFontSizeMultiplier={TILE_TEXT_MAX}>{label}</Text>
    </View>
  );
}

/** A small round tick for a row inside a tile: outlined open, filled once done; reaches 44 dp with its slop. */
export function MiniTick({ done, color, onPress, label }: { done: boolean; color: string; onPress?: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress} hitSlop={12} disabled={!onPress} accessible={!!onPress}
      importantForAccessibility={onPress ? 'auto' : 'no-hide-descendants'}
      accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={label}
      style={[kit.tick, done ? { backgroundColor: color, borderColor: color } : { borderColor: C.borderBright }]}
    >
      {done ? <Ionicons name="checkmark" size={12} color={C.onAccent} /> : null}
    </Pressable>
  );
}

/**
 * What one of Today's own sections shows while the board is edited and it has nothing to say today (no blocks, the
 * page written): a quiet outline with its name, so it can still be moved or taken away.
 */
export function FlowPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <View style={[kit.placeholder, { borderColor: C.borderBright }]}>
      <Text style={kit.placeholderTitle} maxFontSizeMultiplier={TILE_TEXT_MAX}>{title}</Text>
      <Text style={kit.placeholderNote} numberOfLines={2} maxFontSizeMultiplier={TILE_TEXT_MAX}>{note}</Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Today's own sections */

/** a 13 pt text link reaches a 44 dp target without moving anything around it */
export const LINK_SLOP = { top: 14, bottom: 14, left: 10, right: 10 };

/** "3 hours 20 minutes", for a screen reader */
export function spokenMinutes(m: number) {
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const parts = [h ? h + (h === 1 ? ' hour' : ' hours') : '', rest ? rest + (rest === 1 ? ' minute' : ' minutes') : ''];
  return parts.filter(Boolean).join(' ') || '0 minutes';
}

/** A count that waits for Today to be in view before it moves to a new figure. */
export function SeenCount(props: React.ComponentProps<typeof CountUp>) {
  const value = useWhenSeen(props.value);
  return <CountUp {...props} value={value} />;
}

/**
 * One quiet line on Today, with no surface of its own: an icon, a line of words that opens something, and a chevron.
 * The words run to one line.
 */
export function FlatLine({ icon, onPress, label, hint, children }: {
  icon: React.ComponentProps<typeof Ionicons>['name']; onPress: () => void; label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress} style={({ pressed }) => [kit.flatRow, pressed && { opacity: 0.6 }]}
      accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    >
      <Ionicons name={icon} size={16} color={C.textFaint} style={kit.flatIcon} />
      <Text style={[kit.flatText, { flex: 1 }]} numberOfLines={1}>{children}</Text>
      <Ionicons name="chevron-forward" size={15} color={C.textFaint} />
    </Pressable>
  );
}

/** A carved line that asks for one thing (plan today, write today's page), with its word in the tool's colour. */
export function NudgeRow({ icon, iconColor, text, action, actionColor, onPress, style }: {
  icon: any; iconColor: string; text: string; action: string; actionColor: string; onPress: () => void; style?: ViewStyle;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress} accessibilityRole="button" accessibilityLabel={text + ', ' + action}
      style={[
        kit.nudge,
        theme === 'minimal' ? { backgroundColor: MIN.inset, borderWidth: 1, borderColor: MIN.border } : { backgroundColor: C.inset, ...neuInset('low') },
        style,
      ]}
    >
      <Ionicons name={icon} size={17} color={iconColor} />
      <Text style={kit.nudgeText}>{text}</Text>
      <Text style={[kit.link, { color: actionColor }]}>{action}</Text>
    </Pressable>
  );
}

export const kit = StyleSheet.create({
  link: { fontFamily: F.semi, fontSize: 13, letterSpacing: TRACK.small },
  nudge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 14, paddingHorizontal: 16, borderRadius: S.radiusSm, marginTop: 18, marginBottom: 4,
  },
  nudgeText: { flex: 1, color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small },
  // a quiet line with no surface (Coming up, the session in flight): under a card, nearer it than the next section
  flatRow: { flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: S.gap - 4, paddingVertical: 8, paddingHorizontal: 4 },
  flatIcon: { marginRight: 10 },
  flatText: { color: C.textDim, fontFamily: F.smMed, fontSize: 13, letterSpacing: TRACK.small },
  flatEm: { color: C.text, fontFamily: F.smSemi },
  tile: { borderRadius: S.radius, overflow: 'visible' },
  note: { flex: 1, justifyContent: 'center', gap: 6 },
  noteTitle: { color: C.textDim, fontFamily: F.med, fontSize: 14, lineHeight: 19, letterSpacing: TRACK.small },
  noteBody: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 16, letterSpacing: TRACK.fine },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 },
  pillText: { fontFamily: F.smSemi, ...oneLine(11), letterSpacing: TRACK.fine },
  tick: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  placeholder: {
    borderWidth: 1, borderStyle: 'dashed', borderRadius: S.radiusSm, paddingVertical: 14, paddingHorizontal: 16,
    marginBottom: S.gap,
  },
  placeholderTitle: { color: C.textDim, fontFamily: F.med, fontSize: 14, letterSpacing: TRACK.small },
  placeholderNote: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 16, letterSpacing: TRACK.fine, marginTop: 3 },
  /** a row's words inside a tile */
  rowText: { flex: 1, color: C.text, fontFamily: F.reg, fontSize: 14, letterSpacing: TRACK.small },
  /** a quiet line under a figure */
  sub: { color: C.textFaint, fontFamily: F.sm, fontSize: 12, lineHeight: 16, letterSpacing: TRACK.fine },
  /** a tile's main words */
  name: { color: C.text, fontFamily: F.semi, fontSize: 16, lineHeight: 21, letterSpacing: TRACK.title },
  /** a big counting figure */
  big: { color: C.text, fontFamily: F.num, fontSize: 34, lineHeight: 40, fontVariant: ['tabular-nums'] },
  /** a small counting figure, in a row */
  fig: { color: C.text, fontFamily: F.med, fontSize: 14, fontVariant: ['tabular-nums'] },
});
