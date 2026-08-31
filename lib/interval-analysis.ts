import type { CalibrationRecord, GaugeRecord } from './model';

export interface IntervalRecommendation {
  gaugeId: string;
  currentMonths: number;
  recommendedMonths: number;
  direction: 'shorten' | 'retain' | 'extend';
  confidence: 'low' | 'medium' | 'high';
  evidenceCount: number;
  passStreak: number;
  explanation: string;
}

export function recommendCalibrationInterval(
  gauge: GaugeRecord,
  records: readonly CalibrationRecord[],
): IntervalRecommendation {
  const history = records
    .filter((record) => record.gaugeId === gauge.id)
    .sort((a, b) => b.performedOn.localeCompare(a.performedOn));
  const passStreak = history.findIndex((record) => record.result !== 'pass');
  const effectivePassStreak = passStreak === -1 ? history.length : passStreak;
  const recent = history.slice(0, 6);
  const failures = recent.filter((record) => record.result === 'fail').length;
  const conditional = recent.filter(
    (record) => record.result === 'conditional',
  ).length;
  const confidence =
    history.length >= 8 ? 'high' : history.length >= 4 ? 'medium' : 'low';

  if (failures > 0) {
    const factor = gauge.criticality === 'critical' ? 0.5 : 0.75;
    return {
      gaugeId: gauge.id,
      currentMonths: gauge.intervalMonths,
      recommendedMonths: Math.max(1, Math.floor(gauge.intervalMonths * factor)),
      direction: 'shorten',
      confidence,
      evidenceCount: history.length,
      passStreak: effectivePassStreak,
      explanation: `${failures} failure${failures === 1 ? '' : 's'} occurred in the latest ${recent.length} completed events; investigate cause before approving a shorter interval.`,
    };
  }
  if (conditional > 0) {
    return {
      gaugeId: gauge.id,
      currentMonths: gauge.intervalMonths,
      recommendedMonths: Math.max(1, Math.floor(gauge.intervalMonths * 0.8)),
      direction: 'shorten',
      confidence,
      evidenceCount: history.length,
      passStreak: effectivePassStreak,
      explanation:
        'A recent conditional release indicates boundary risk; retain or shorten only after technical review.',
    };
  }
  if (
    effectivePassStreak >= 5 &&
    gauge.criticality !== 'critical' &&
    gauge.lifecycle === 'active'
  ) {
    const factor = gauge.criticality === 'high' ? 1.1 : 1.25;
    return {
      gaugeId: gauge.id,
      currentMonths: gauge.intervalMonths,
      recommendedMonths: Math.min(
        60,
        Math.max(
          gauge.intervalMonths + 1,
          Math.round(gauge.intervalMonths * factor),
        ),
      ),
      direction: 'extend',
      confidence,
      evidenceCount: history.length,
      passStreak: effectivePassStreak,
      explanation: `${effectivePassStreak} consecutive passes support evaluating a controlled extension; consider drift, use intensity, risk, manufacturer guidance, and governing procedures.`,
    };
  }
  return {
    gaugeId: gauge.id,
    currentMonths: gauge.intervalMonths,
    recommendedMonths: gauge.intervalMonths,
    direction: 'retain',
    confidence,
    evidenceCount: history.length,
    passStreak: effectivePassStreak,
    explanation:
      history.length < 3
        ? 'Too little completed history for a defensible interval change.'
        : 'Recent history does not support a change under the conservative screening rule.',
  };
}
