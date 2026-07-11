import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { useStore } from '../store';

const SIZE = 184;

/** The one refractive hero of the dashboard. Tap to flip digital ⇄ analogue. */
export function ClockOrb({ size = SIZE }: { size?: number }) {
  const clockStyle = useStore((s) => s.settings.clockStyle);
  const hour24 = useStore((s) => s.settings.hour24);
  const glass = useStore((s) => s.settings.glassIntensity);
  const setSetting = useStore((s) => s.setSetting);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const h = now.getHours();
  const m = now.getMinutes();
  const sec = now.getSeconds();
  const hh = hour24 ? String(h).padStart(2, '0') : String(h % 12 || 12);
  const ampm = h >= 12 ? 'PM' : 'AM';

  return (
    <View style={{ alignItems: 'center', marginVertical: 14 }}>
      {/* soft halo behind the orb */}
      <View style={[st.halo, { width: size * 1.25, height: size * 1.25, borderRadius: (size * 1.25) / 2 }]} />
      <Pressable
        onPress={() => setSetting('clockStyle', clockStyle === 'digital' ? 'analog' : 'digital')}
        style={[st.orb, { width: size, height: size, borderRadius: size / 2 }]}
      >
        {glass === 'full' && (
          <BlurView intensity={45} tint="dark" experimentalBlurMethod="dimezisBlurView" style={StyleSheet.absoluteFill} />
        )}
        <LinearGradient
          colors={['rgba(160,190,255,0.26)', 'rgba(255,255,255,0.03)', 'rgba(120,150,230,0.16)']}
          start={{ x: 0.2, y: 0 }} end={{ x: 0.8, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        {/* curved highlight arc */}
        <View style={[st.arc, { width: size * 0.82, height: size * 0.82, borderRadius: size * 0.41, top: size * 0.045, left: size * 0.09 }]} />
        {/* inner ring */}
        <View style={[st.innerRing, { width: size - 18, height: size - 18, borderRadius: (size - 18) / 2 }]} />
        {clockStyle === 'digital' ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={st.time}>
              {hh}
              <Text style={{ color: C.accent }}>:</Text>
              {String(m).padStart(2, '0')}
            </Text>
            <Text style={st.sub}>
              {hour24 ? '' : `${ampm}  ·  `}
              <Text style={{ color: C.accent }}>{String(sec).padStart(2, '0')}</Text>s
            </Text>
          </View>
        ) : (
          <AnalogFace size={size * 0.74} h={h} m={m} s={sec} />
        )}
      </Pressable>
    </View>
  );
}

function AnalogFace({ size, h, m, s }: { size: number; h: number; m: number; s: number }) {
  const hourDeg = ((h % 12) + m / 60) * 30;
  const minDeg = (m + s / 60) * 6;
  const secDeg = s * 6;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
      {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => (
        <View key={deg} style={{ position: 'absolute', width: size, height: size, transform: [{ rotate: `${deg}deg` }], alignItems: 'center' }}>
          <View
            style={{
              width: deg % 90 === 0 ? 2.5 : 1.5,
              height: deg % 90 === 0 ? 9 : 5,
              backgroundColor: deg % 90 === 0 ? C.textDim : C.textFaint,
              marginTop: 3, borderRadius: 1,
            }}
          />
        </View>
      ))}
      <Hand deg={hourDeg} len={size * 0.24} w={4} color={C.text} />
      <Hand deg={minDeg} len={size * 0.34} w={2.5} color={C.accent} />
      <Hand deg={secDeg} len={size * 0.38} w={1.5} color={C.pink} />
      <View style={{ position: 'absolute', width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.text }} />
      <View style={{ position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: C.bg }} />
    </View>
  );
}

function Hand({ deg, len, w, color }: { deg: number; len: number; w: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute',
        width: w,
        height: len * 2,
        alignItems: 'center',
        transform: [{ rotate: `${deg}deg` }],
      }}
      pointerEvents="none"
    >
      <View style={{ width: w, height: len, backgroundColor: color, borderRadius: w / 2 }} />
    </View>
  );
}

const st = StyleSheet.create({
  halo: {
    position: 'absolute',
    top: -14,
    backgroundColor: 'rgba(143,180,255,0.10)',
  },
  orb: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(140,170,255,0.05)',
    shadowColor: '#8FB4FF',
    shadowOpacity: 0.35,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  arc: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.26)',
    borderBottomColor: 'transparent',
    borderRightColor: 'transparent',
    transform: [{ rotate: '45deg' }],
  },
  innerRing: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  time: {
    color: C.text, fontSize: 46, fontWeight: '800',
    fontVariant: ['tabular-nums'], letterSpacing: 0.5,
  },
  sub: { color: C.textDim, fontSize: 13, marginTop: 3, fontVariant: ['tabular-nums'], letterSpacing: 1 },
});
