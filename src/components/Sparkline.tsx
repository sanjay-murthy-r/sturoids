import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { C } from '../theme';

const PAD = 5;

/**
 * A group's trend: one line through its latest results, oldest on the left, the newest a dot. A goal shows as a
 * dashed line. The scale always spans at least ten points, so two close results never look like a cliff.
 */
export function Sparkline({ values, target, height = 56, color }: {
  values: number[]; target?: number; height?: number; color?: string;
}) {
  const [w, setW] = React.useState(0);
  const c = color || C.accent;
  const all = target != null ? [...values, target] : values;
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  if (hi - lo < 10) {
    const mid = (hi + lo) / 2;
    lo = mid - 5;
    hi = mid + 5;
  }
  const y = (v: number) => PAD + ((hi - v) / (hi - lo)) * (height - PAD * 2);
  const x = (i: number) => (values.length < 2 ? w / 2 : PAD + (i * (w - PAD * 2)) / (values.length - 1));
  const d = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const last = values.length - 1;
  return (
    <View style={{ height }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessible={false}>
      {w > 0 && values.length ? (
        <Svg width={w} height={height}>
          {target != null ? (
            <Line
              x1={0} x2={w} y1={y(target)} y2={y(target)}
              stroke={C.textFaint} strokeOpacity={0.55} strokeWidth={1} strokeDasharray="3 5"
            />
          ) : null}
          {values.length > 1 ? (
            <Path d={d} fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          <Circle cx={x(last)} cy={y(values[last])} r={3.5} fill={c} />
        </Svg>
      ) : null}
    </View>
  );
}
