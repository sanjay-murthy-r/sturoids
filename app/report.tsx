import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, F, S, T, TRACK } from '../src/theme';
import { useStore } from '../src/store';
import { ListCard, ListRow, ScreenBG, SectionTitle, useToolHeader } from '../src/components/UI';
import { Enter } from '../src/components/Motion';
import { useSubjects } from '../src/subjects';
import { READ_MAX, frame } from '../src/layout';
import { KIND_INFO, SINGLE_KINDS, SummaryKind, useExportFlow } from '../src/reports';

/** Subjects listed before "More subjects" opens the rest. */
const SUBJECTS_SHOWN = 6;

/**
 * Reports and exports: the full progress report (every part, one PDF) first, then each summary on its own, then a
 * subject's. Each opens the same small sheet: the summary's name, its range, a live preview, then Export PDF or
 * Share CSV. An archived tool's summary is not listed.
 */
export default function ReportPage() {
  const insets = useSafeAreaInsets();
  const archived: readonly string[] = useStore((s) => s.settings.archivedTools) || [];
  const subjects = useSubjects();
  const [allSubjects, setAllSubjects] = React.useState(false);
  const flow = useExportFlow('report');

  const tool = useToolHeader({ title: 'Reports & exports', mode: 'page' });

  const kinds = SINGLE_KINDS.filter((k) => !KIND_INFO[k].tool || !archived.includes(KIND_INFO[k].tool!));
  const shown = allSubjects ? subjects : subjects.slice(0, SUBJECTS_SHOWN);

  let enter = 0;
  return (
    <ScreenBG>
      {tool.bar}
      <Animated.ScrollView
        {...tool.scrollProps}
        contentContainerStyle={[frame(READ_MAX), { padding: S.pad, paddingTop: tool.padTop, paddingBottom: 48 + insets.bottom }]}
      >
        <Enter index={enter++}>
          {tool.hero}
          <ListCard>
            <Row kind="report" onPress={() => flow.open('report')} />
          </ListCard>
        </Enter>

        <Enter index={enter++}>
          <SectionTitle>One summary</SectionTitle>
          <ListCard>
            {kinds.map((k) => <Row key={k} kind={k} onPress={() => flow.open(k)} />)}
          </ListCard>
        </Enter>

        {subjects.length ? (
          <Enter index={enter++}>
            <SectionTitle>A subject</SectionTitle>
            <ListCard>
              {shown.map((name) => (
                <Row key={name} kind="subject" title={name} onPress={() => flow.open('subject', { subject: name })} />
              ))}
              {subjects.length > SUBJECTS_SHOWN && !allSubjects ? (
                <ListRow key="more" style={st.row} onPress={() => setAllSubjects(true)} accessibilityRole="button" accessibilityLabel="More subjects">
                  <Text style={[T.label, { flex: 1 }]}>{'More subjects (' + (subjects.length - SUBJECTS_SHOWN) + ')'}</Text>
                  <Ionicons name="chevron-down" size={17} color={C.textFaint} />
                </ListRow>
              ) : null}
            </ListCard>
          </Enter>
        ) : null}

        <Enter index={enter++}>
          <Text style={[T.caption, { marginTop: S.section, textAlign: 'center' }]}>
            Made on this phone from this profile's data. Nothing is sent anywhere until you choose where to share it.
          </Text>
        </Enter>
      </Animated.ScrollView>
      {flow.sheet}
    </ScreenBG>
  );
}

function Row({ kind, title, onPress }: { kind: SummaryKind; title?: string; onPress: () => void }) {
  const info = KIND_INFO[kind];
  const name = title || (kind === 'report' ? 'Full progress report' : info.short);
  return (
    <ListRow style={st.row} onPress={onPress} accessibilityRole="button" accessibilityLabel={name + ', ' + info.sub}>
      <Ionicons name={info.icon as React.ComponentProps<typeof Ionicons>['name']} size={20} color={C.accent} />
      <View style={{ flex: 1, marginHorizontal: 14 }}>
        <Text style={st.title} numberOfLines={1}>{name}</Text>
        <Text style={T.caption} numberOfLines={2}>{info.sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={17} color={C.textFaint} />
    </ListRow>
  );
}

const st = StyleSheet.create({
  row: { paddingVertical: 15, minHeight: 60, flexDirection: 'row', alignItems: 'center' },
  title: { color: C.text, fontFamily: F.semi, fontSize: 16, letterSpacing: TRACK.title },
});
