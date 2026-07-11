import React from 'react';
import {
  View, Text, StyleSheet, Pressable, TextInput, Modal, ViewStyle,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { C, S, T } from '../theme';
import { useStore } from '../store';

/** Ambient background: deep navy + soft colour glows the glass refracts against. */
export function ScreenBG({ children }: { children: React.ReactNode }) {
  const intensity = useStore((s) => s.settings.glassIntensity);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {intensity !== 'off' && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <View style={[st.glow, { backgroundColor: '#2A4A9E', top: -130, left: -110, opacity: 0.38 }]} />
          <View style={[st.glow, { backgroundColor: '#5B3A9E', top: 230, right: -150, opacity: 0.26 }]} />
          <View style={[st.glow, { backgroundColor: '#1E6E72', bottom: -90, left: -70, opacity: 0.26 }]} />
          <LinearGradient
            colors={['rgba(10,15,30,0.10)', 'rgba(10,15,30,0.72)']}
            style={StyleSheet.absoluteFill}
          />
        </View>
      )}
      {children}
    </View>
  );
}

/** Frosted glass card. Intensity comes from Settings (off / subtle / full). */
export function GlassCard({
  children, style, pad = S.cardPad, onPress, hero = false,
}: {
  children: React.ReactNode; style?: ViewStyle | ViewStyle[]; pad?: number;
  onPress?: () => void; hero?: boolean;
}) {
  const intensity = useStore((s) => s.settings.glassIntensity);
  const Wrapper: any = onPress ? Pressable : View;
  const wrapProps = onPress
    ? {
        onPress,
        android_ripple: { color: 'rgba(255,255,255,0.07)', foreground: true },
        style: ({ pressed }: any) => [
          st.cardBase,
          intensity === 'off' ? { backgroundColor: C.bgCardSolid } : st.cardGlass,
          pressed && { transform: [{ scale: 0.985 }], opacity: 0.92 },
          style,
        ],
      }
    : { style: [st.cardBase, intensity === 'off' ? { backgroundColor: C.bgCardSolid } : st.cardGlass, style] };

  return (
    <Wrapper {...wrapProps}>
      {intensity === 'full' && (
        <BlurView
          intensity={hero ? 40 : 20}
          tint="dark"
          experimentalBlurMethod="dimezisBlurView"
          style={StyleSheet.absoluteFill}
        />
      )}
      {intensity !== 'off' && (
        <>
          <LinearGradient
            colors={
              hero
                ? ['rgba(255,255,255,0.15)', 'rgba(255,255,255,0.04)', 'rgba(255,255,255,0.09)']
                : ['rgba(255,255,255,0.085)', 'rgba(255,255,255,0.02)']
            }
            start={{ x: 0.1, y: 0 }} end={{ x: 0.7, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={st.topHighlight} />
        </>
      )}
      <View style={{ padding: pad }}>{children}</View>
    </Wrapper>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={st.sectionRow}>
      <Text style={T.kicker}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({
  label, active, color = C.accent, onPress, small,
}: { label: string; active?: boolean; color?: string; onPress?: () => void; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        st.chip, small && { paddingVertical: 5, paddingHorizontal: 11 },
        active && { backgroundColor: color + '2E', borderColor: color + 'AA' },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[st.chipText, small && { fontSize: 12 }, active && { color, fontWeight: '700' }]}>{label}</Text>
    </Pressable>
  );
}

export function PillButton({
  label, onPress, color = C.accent, icon, outline, style, small,
}: {
  label: string; onPress: () => void; color?: string; icon?: any; outline?: boolean;
  style?: ViewStyle; small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        st.pill,
        small && { paddingVertical: 8, paddingHorizontal: 14 },
        outline
          ? { borderColor: color + '99', borderWidth: 1, backgroundColor: 'transparent' }
          : { backgroundColor: color + '2A', borderColor: color + '55', borderWidth: 1 },
        pressed && { opacity: 0.75 },
        style,
      ]}
    >
      {icon ? <Ionicons name={icon} size={small ? 14 : 16} color={color} style={{ marginRight: 7 }} /> : null}
      <Text style={{ color, fontWeight: '700', fontSize: small ? 13 : 15, letterSpacing: 0.1 }}>{label}</Text>
    </Pressable>
  );
}

export function IconBtn({ name, onPress, color = C.textDim, size = 22, style }: {
  name: any; onPress?: () => void; color?: string; size?: number; style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10} style={({ pressed }) => [{ padding: 4 }, pressed && { opacity: 0.6 }, style]}>
      <Ionicons name={name} size={size} color={color} />
    </Pressable>
  );
}

export function CheckCircle({ done, onPress, color = C.green, size = 26 }: {
  done: boolean; onPress: () => void; color?: string; size?: number;
}) {
  return (
    <Pressable onPress={onPress} hitSlop={10}>
      <Ionicons
        name={done ? 'checkmark-circle' : 'ellipse-outline'}
        size={size}
        color={done ? color : C.textFaint}
      />
    </Pressable>
  );
}

export function Field(props: React.ComponentProps<typeof TextInput> & { style?: any }) {
  return (
    <TextInput
      placeholderTextColor={C.textFaint}
      selectionColor={C.accent}
      {...props}
      style={[st.field, props.style]}
    />
  );
}

export function EmptyText({ children }: { children: React.ReactNode }) {
  return <Text style={st.empty}>{children}</Text>;
}

export function ProgressBar({ value, color = C.accent, height = 6 }: { value: number; color?: string; height?: number }) {
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, height, borderRadius: height / 2, backgroundColor: color }} />
    </View>
  );
}

/** Hairline separator for list rows inside cards. */
export function Hairline() {
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.hairline, marginVertical: 2 }} />;
}

/** Bottom-sheet style modal used by every add/edit flow. */
export function Sheet({
  visible, onClose, title, children,
}: { visible: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={st.sheetOverlay} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={st.sheet}>
          <View style={st.sheetHandle} />
          {title ? <Text style={st.sheetTitle}>{title}</Text> : null}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export const textStyles = StyleSheet.create({
  h1: T.h1 as any,
  body: T.body as any,
  dim: { color: C.textDim, fontSize: 13 },
});

const st = StyleSheet.create({
  glow: {
    position: 'absolute', width: 400, height: 400, borderRadius: 200,
    transform: [{ scale: 1.2 }],
  },
  cardBase: {
    borderRadius: S.radius,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: S.gap,
  },
  cardGlass: {
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  topHighlight: {
    position: 'absolute', top: 0, left: 14, right: 14, height: 1,
    backgroundColor: 'rgba(255,255,255,0.20)',
  },
  sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: S.section, marginBottom: 12, paddingHorizontal: 2,
  },
  chip: {
    paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999,
    borderWidth: 1, borderColor: C.border, backgroundColor: 'rgba(255,255,255,0.045)',
    marginRight: 8, marginBottom: 8,
  },
  chipText: { color: C.textDim, fontSize: 13, fontWeight: '500', letterSpacing: 0.1 },
  pill: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 12, paddingHorizontal: 18, borderRadius: 999,
  },
  field: {
    backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: C.border,
    borderRadius: S.radiusSm, color: C.text, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 15, marginBottom: 10,
  },
  empty: {
    color: C.textFaint, textAlign: 'center', marginVertical: 26,
    fontSize: 13.5, lineHeight: 20, paddingHorizontal: 10,
  },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(2,4,10,0.6)' },
  sheet: {
    backgroundColor: '#0F1730', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 22, paddingBottom: 36, borderTopWidth: 1, borderColor: C.borderBright,
  },
  sheetHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)', marginBottom: 16,
  },
  sheetTitle: { color: C.text, fontSize: 18, fontWeight: '800', letterSpacing: -0.2, marginBottom: 14 },
});
