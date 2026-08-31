import { describe, expect, it } from 'vitest';
import {
  analyzeBias,
  analyzeLinearity,
  analyzeStability,
  calculateCrossedGrr,
  calculateStandardUncertainty,
  calculateUncertaintyBudget,
  d2Constant,
  distributionDivisor,
  evaluateDecisionRule,
  getXbarRConstants,
  type GrrObservation,
} from './metrology';

describe('uncertainty distributions', () => {
  it('uses the ISO/GUM distribution divisors', () => {
    expect(distributionDivisor('normal')).toBe(1);
    expect(distributionDivisor('rectangular')).toBeCloseTo(Math.sqrt(3), 12);
    expect(distributionDivisor('triangular')).toBeCloseTo(Math.sqrt(6), 12);
    expect(distributionDivisor('u-shaped')).toBeCloseTo(Math.sqrt(2), 12);
  });

  it('allows an explicit divisor for quoted expanded uncertainties', () => {
    expect(calculateStandardUncertainty(0.04, 'normal', 2)).toBeCloseTo(
      0.02,
      12,
    );
  });

  it('rejects invalid magnitudes, divisors, and runtime distribution values', () => {
    expect(() => calculateStandardUncertainty(-1, 'normal')).toThrow(
      /greater than or equal/,
    );
    expect(() => calculateStandardUncertainty(1, 'normal', 0)).toThrow(
      /greater than zero/,
    );
    expect(() => distributionDivisor('uniform' as 'normal')).toThrow(
      /Unsupported/,
    );
  });
});

describe('uncertainty budget', () => {
  it('combines sensitivity-weighted contributors and evaluates Welch-Satterthwaite degrees of freedom', () => {
    const result = calculateUncertaintyBudget(
      [
        {
          name: 'Reference standard',
          uncertainty: 2,
          distribution: 'normal',
          divisor: 2,
          degreesOfFreedom: 10,
        },
        {
          name: 'Resolution',
          uncertainty: Math.sqrt(3),
          distribution: 'rectangular',
          sensitivityCoefficient: -2,
          degreesOfFreedom: 20,
        },
      ],
      { coverageFactor: 2 },
    );

    expect(result.contributors[0].standardUncertainty).toBeCloseTo(1, 12);
    expect(result.contributors[1].standardUncertainty).toBeCloseTo(1, 12);
    expect(result.contributors[1].signedStandardContribution).toBeCloseTo(
      -2,
      12,
    );
    expect(result.combinedStandardUncertainty).toBeCloseTo(Math.sqrt(5), 12);
    expect(result.expandedUncertainty).toBeCloseTo(2 * Math.sqrt(5), 12);
    expect(result.effectiveDegreesOfFreedom).toBeCloseTo(
      25 / (1 / 10 + 16 / 20),
      10,
    );
    expect(result.contributors[0].percentVarianceContribution).toBeCloseTo(
      20,
      10,
    );
    expect(result.contributors[1].percentVarianceContribution).toBeCloseTo(
      80,
      10,
    );
  });

  it('reports infinite effective degrees of freedom for Type B-only and zero budgets', () => {
    const typeB = calculateUncertaintyBudget([
      { name: 'Resolution', uncertainty: 0.1, distribution: 'rectangular' },
    ]);
    const zero = calculateUncertaintyBudget([
      {
        name: 'Exact in model',
        uncertainty: 0,
        distribution: 'normal',
        degreesOfFreedom: 2,
      },
    ]);
    expect(typeB.effectiveDegreesOfFreedom).toBe(Number.POSITIVE_INFINITY);
    expect(zero.effectiveDegreesOfFreedom).toBe(Number.POSITIVE_INFINITY);
    expect(zero.expandedUncertainty).toBe(0);
  });

  it('validates contributor identity and statistical parameters', () => {
    expect(() => calculateUncertaintyBudget([])).toThrow(/at least one/);
    expect(() =>
      calculateUncertaintyBudget([
        { name: ' ', uncertainty: 1, distribution: 'normal' },
      ]),
    ).toThrow(/non-empty/);
    expect(() =>
      calculateUncertaintyBudget([
        {
          name: 'Repeatability',
          uncertainty: 1,
          distribution: 'normal',
          degreesOfFreedom: 0,
        },
      ]),
    ).toThrow(/degrees of freedom/);
    expect(() =>
      calculateUncertaintyBudget(
        [{ name: 'A', uncertainty: 1, distribution: 'normal' }],
        {
          coverageFactor: Number.NaN,
        },
      ),
    ).toThrow(/finite/);
  });
});

describe('decision rules', () => {
  it('applies simple acceptance inclusively and supports one-sided limits', () => {
    expect(
      evaluateDecisionRule({
        rule: 'simple-acceptance',
        measuredValue: 10,
        lowerLimit: 10,
        upperLimit: 12,
      }).outcome,
    ).toBe('pass');
    expect(
      evaluateDecisionRule({
        rule: 'simple-acceptance',
        measuredValue: 5.1,
        upperLimit: 5,
      }).outcome,
    ).toBe('fail');
  });

  it('distinguishes guard-band acceptance, review, and rejection zones', () => {
    const base = {
      rule: 'guard-banded' as const,
      lowerLimit: 9,
      upperLimit: 11,
      guardBand: 0.2,
    };
    expect(evaluateDecisionRule({ ...base, measuredValue: 10 }).outcome).toBe(
      'pass',
    );
    expect(evaluateDecisionRule({ ...base, measuredValue: 9.1 }).outcome).toBe(
      'conditional',
    );
    expect(evaluateDecisionRule({ ...base, measuredValue: 8.99 }).outcome).toBe(
      'fail',
    );
    expect(
      evaluateDecisionRule({ ...base, measuredValue: 9.1 }).acceptanceInterval,
    ).toEqual({
      lower: 9.2,
      upper: 10.8,
    });
  });

  it('classifies uncertainty-aware results without hiding boundary risk', () => {
    const base = {
      rule: 'uncertainty-aware' as const,
      lowerLimit: 9,
      upperLimit: 11,
      expandedUncertainty: 0.5,
    };
    expect(evaluateDecisionRule({ ...base, measuredValue: 10 }).outcome).toBe(
      'pass',
    );
    expect(evaluateDecisionRule({ ...base, measuredValue: 9.2 }).outcome).toBe(
      'conditional',
    );
    expect(evaluateDecisionRule({ ...base, measuredValue: 8.8 }).outcome).toBe(
      'indeterminate',
    );
    expect(evaluateDecisionRule({ ...base, measuredValue: 8 }).outcome).toBe(
      'fail',
    );
    expect(
      evaluateDecisionRule({ ...base, measuredValue: 8.8 }).uncertaintyInterval,
    ).toEqual({
      lower: 8.3,
      upper: 9.3,
    });
  });

  it('rejects missing or inverted limits and impossible guard bands', () => {
    expect(() =>
      evaluateDecisionRule({ rule: 'simple-acceptance', measuredValue: 1 }),
    ).toThrow(/At least one/);
    expect(() =>
      evaluateDecisionRule({
        rule: 'simple-acceptance',
        measuredValue: 1,
        lowerLimit: 2,
        upperLimit: 1,
      }),
    ).toThrow(/greater/);
    expect(() =>
      evaluateDecisionRule({
        rule: 'guard-banded',
        measuredValue: 5,
        lowerLimit: 0,
        upperLimit: 10,
        guardBand: 6,
      }),
    ).toThrow(/too large/);
  });
});

function balancedStudy(): GrrObservation[] {
  return [
    { part: 'P1', appraiser: 'A', trial: 1, value: 9.9 },
    { part: 'P1', appraiser: 'A', trial: 2, value: 10.1 },
    { part: 'P1', appraiser: 'B', trial: 1, value: 10.4 },
    { part: 'P1', appraiser: 'B', trial: 2, value: 10.6 },
    { part: 'P2', appraiser: 'A', trial: 1, value: 19.9 },
    { part: 'P2', appraiser: 'A', trial: 2, value: 20.1 },
    { part: 'P2', appraiser: 'B', trial: 1, value: 20.4 },
    { part: 'P2', appraiser: 'B', trial: 2, value: 20.6 },
  ];
}

describe('crossed average-and-range Gage R&R', () => {
  it('uses tabulated d2 values and calculates larger-study constants numerically', () => {
    expect(d2Constant(2)).toBe(1.128);
    expect(d2Constant(10)).toBe(3.078);
    expect(d2Constant(30)).toBeGreaterThan(d2Constant(25));
    expect(d2Constant(30)).toBeLessThan(4.2);
    expect(() => d2Constant(1)).toThrow(/at least 2/);
  });

  it('calculates repeatability, corrected reproducibility, GRR, part variation, and ndc', () => {
    const result = calculateCrossedGrr(balancedStudy(), {
      lowerSpecificationLimit: 0,
      upperSpecificationLimit: 30,
    });
    const ev = 0.2 / 1.128;
    const av = Math.sqrt((0.5 / 1.128) ** 2 - ev ** 2 / 4);
    const pv = 10 / 1.128;
    const grr = Math.hypot(ev, av);
    const total = Math.hypot(grr, pv);

    expect(result.design).toEqual({
      partCount: 2,
      appraiserCount: 2,
      trialsPerCell: 2,
      observationCount: 8,
      balanced: true,
    });
    expect(result.descriptive.grandMean).toBeCloseTo(15.25, 12);
    expect(result.descriptive.averageCellRange).toBeCloseTo(0.2, 12);
    expect(result.descriptive.appraiserMeanRange).toBeCloseTo(0.5, 12);
    expect(result.descriptive.partMeanRange).toBeCloseTo(10, 12);
    expect(result.components.repeatability.standardDeviation).toBeCloseTo(
      ev,
      12,
    );
    expect(result.components.reproducibility.standardDeviation).toBeCloseTo(
      av,
      12,
    );
    expect(result.components.gaugeRr.standardDeviation).toBeCloseTo(grr, 12);
    expect(result.components.partToPart.standardDeviation).toBeCloseTo(pv, 12);
    expect(result.components.total.standardDeviation).toBeCloseTo(total, 12);
    expect(result.numberOfDistinctCategories).toBe(
      Math.floor(1.41 * (pv / grr)),
    );
    expect(result.components.gaugeRr.percentTolerance).toBeCloseTo(
      (6 * grr * 100) / 30,
      12,
    );
    expect(result.classification).toBe('acceptable');
  });

  it('truncates a negative corrected appraiser variance and reports that assumption', () => {
    const noAppraiserShift = balancedStudy().map((observation) => ({
      ...observation,
      value:
        observation.appraiser === 'B'
          ? observation.value - 0.5
          : observation.value,
    }));
    const result = calculateCrossedGrr(noAppraiserShift);
    expect(result.components.reproducibility.standardDeviation).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/truncated to zero/);
    expect(result.assumptions.join(' ')).toMatch(
      /interaction is not estimated/,
    );
  });

  it('marks constant studies indeterminate rather than inventing capability', () => {
    const study = balancedStudy().map((observation) => ({
      ...observation,
      value: 5,
    }));
    const result = calculateCrossedGrr(study);
    expect(result.components.total.standardDeviation).toBe(0);
    expect(result.numberOfDistinctCategories).toBe(0);
    expect(result.classification).toBe('indeterminate');
    expect(result.warnings.join(' ')).toMatch(/No variation/);
  });

  it('rejects duplicate, missing, and unbalanced study cells', () => {
    const duplicate = [...balancedStudy(), balancedStudy()[0]];
    expect(() => calculateCrossedGrr(duplicate)).toThrow(
      /Duplicate observation/,
    );

    const missingCell = balancedStudy().filter(
      (observation) =>
        !(observation.part === 'P2' && observation.appraiser === 'B'),
    );
    expect(() => calculateCrossedGrr(missingCell)).toThrow(
      /Missing observations/,
    );

    const missingTrial = balancedStudy().filter(
      (observation) =>
        !(
          observation.part === 'P2' &&
          observation.appraiser === 'B' &&
          observation.trial === 2
        ),
    );
    expect(() => calculateCrossedGrr(missingTrial)).toThrow(
      /Unbalanced trials/,
    );
  });

  it('requires a usable crossed design and coherent options', () => {
    expect(() => calculateCrossedGrr([])).toThrow(/requires observations/);
    expect(() =>
      calculateCrossedGrr(balancedStudy(), { studyVariationMultiplier: 0 }),
    ).toThrow(/greater than zero/);
    expect(() =>
      calculateCrossedGrr(balancedStudy(), { lowerSpecificationLimit: 0 }),
    ).toThrow(/both specification limits/);
    expect(() =>
      calculateCrossedGrr(balancedStudy(), {
        lowerSpecificationLimit: 10,
        upperSpecificationLimit: 10,
      }),
    ).toThrow(/greater/);
    expect(() =>
      calculateCrossedGrr(
        balancedStudy().filter(({ appraiser }) => appraiser === 'A'),
      ),
    ).toThrow(/at least two appraisers/);
  });
});

describe('bias analysis', () => {
  it('calculates mean bias, sample spread, standard error, t statistic, and a t interval', () => {
    const result = analyzeBias([10.1, 10.2, 10.0, 10.1, 10.3], 10);
    const expectedStandardDeviation = Math.sqrt(0.052 / 4);
    const expectedStandardError = expectedStandardDeviation / Math.sqrt(5);

    expect(result.meanMeasurement).toBeCloseTo(10.14, 12);
    expect(result.meanBias).toBeCloseTo(0.14, 12);
    expect(result.sampleStandardDeviation).toBeCloseTo(
      expectedStandardDeviation,
      12,
    );
    expect(result.standardError).toBeCloseTo(expectedStandardError, 12);
    expect(result.tStatistic).toBeCloseTo(0.14 / expectedStandardError, 12);
    expect(result.criticalT95).toBe(2.776);
    expect(result.confidenceInterval95.lower).toBeCloseTo(
      0.14 - 2.776 * expectedStandardError,
      12,
    );
    expect(result.confidenceInterval95.upper).toBeCloseTo(
      0.14 + 2.776 * expectedStandardError,
      12,
    );
    expect(result.statisticallySignificantAt95Percent).toBe(false);
    expect(result.individualBiases).toHaveLength(5);
  });

  it('handles identical observations explicitly instead of producing NaN', () => {
    const unbiased = analyzeBias([5, 5, 5], 5);
    const biased = analyzeBias([5.1, 5.1, 5.1], 5);
    expect(unbiased.tStatistic).toBe(0);
    expect(unbiased.confidenceInterval95).toEqual({ lower: 0, upper: 0 });
    expect(unbiased.statisticallySignificantAt95Percent).toBe(false);
    expect(biased.tStatistic).toBe(Number.POSITIVE_INFINITY);
    expect(biased.statisticallySignificantAt95Percent).toBe(true);
    expect(biased.warnings.join(' ')).toMatch(/degenerate/);
  });

  it('validates the reference and repeated measurements', () => {
    expect(() => analyzeBias([1], 1)).toThrow(/at least two/);
    expect(() => analyzeBias([1, Number.NaN], 1)).toThrow(/finite/);
    expect(() => analyzeBias([1, 2], Number.POSITIVE_INFINITY)).toThrow(
      /finite/,
    );
  });
});

describe('linearity analysis', () => {
  it('fits bias against reference value and exposes fitted levels and residuals', () => {
    const observations = [
      { referenceValue: 0, measuredValue: 1 },
      { referenceValue: 0, measuredValue: 1 },
      { referenceValue: 10, measuredValue: 13 },
      { referenceValue: 10, measuredValue: 13 },
      { referenceValue: 20, measuredValue: 25 },
      { referenceValue: 20, measuredValue: 25 },
    ];
    const result = analyzeLinearity(observations);

    expect(result.slope).toBeCloseTo(0.2, 12);
    expect(result.intercept).toBeCloseTo(1, 12);
    expect(result.rSquared).toBe(1);
    expect(result.fittedBiasChangeAcrossRange).toBeCloseTo(4, 12);
    expect(result.referenceRange).toEqual({
      minimum: 0,
      maximum: 20,
      span: 20,
    });
    expect(result.fittedLevels.map(({ fittedBias }) => fittedBias)).toEqual([
      1, 3, 5,
    ]);
    expect(
      result.fittedObservations.every(
        ({ residual }) => Math.abs(residual) < 1e-12,
      ),
    ).toBe(true);
    expect(result.slopeTStatistic).toBe(Number.POSITIVE_INFINITY);
    expect(result.statisticallySignificantSlopeAt95Percent).toBe(true);
  });

  it('reports undefined R-squared for a constant-bias study', () => {
    const result = analyzeLinearity([
      { referenceValue: 0, measuredValue: 0.5 },
      { referenceValue: 10, measuredValue: 10.5 },
      { referenceValue: 20, measuredValue: 20.5 },
    ]);
    expect(result.slope).toBeCloseTo(0, 12);
    expect(result.intercept).toBeCloseTo(0.5, 12);
    expect(result.rSquared).toBeNull();
    expect(result.slopeTStatistic).toBe(0);
    expect(result.warnings.join(' ')).toMatch(/R-squared is undefined/);
  });

  it('warns about unequal replication and validates usable reference levels', () => {
    const unbalanced = analyzeLinearity([
      { referenceValue: 0, measuredValue: 0 },
      { referenceValue: 0, measuredValue: 0.1 },
      { referenceValue: 10, measuredValue: 10.1 },
      { referenceValue: 20, measuredValue: 20.2 },
    ]);
    expect(unbalanced.warnings.join(' ')).toMatch(/unequal replication/);
    expect(unbalanced.warnings.join(' ')).toMatch(/no replication/);
    expect(() =>
      analyzeLinearity([
        { referenceValue: 0, measuredValue: 0 },
        { referenceValue: 0, measuredValue: 0.1 },
        { referenceValue: 1, measuredValue: 1 },
      ]),
    ).toThrow(/three distinct/);
    expect(() =>
      analyzeLinearity([
        { referenceValue: 0, measuredValue: 0 },
        { referenceValue: 1, measuredValue: Number.NaN },
        { referenceValue: 2, measuredValue: 2 },
      ]),
    ).toThrow(/finite/);
  });
});

function stabilitySubgroups(
  means: readonly number[],
  ranges: readonly number[] = means.map(() => 0.2),
) {
  return means.map((mean, index) => ({
    id: `S${index + 1}`,
    timestamp: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    measurements: [mean - ranges[index] / 2, mean + ranges[index] / 2],
  }));
}

describe('Xbar/R stability analysis', () => {
  it('uses standard chart constants and calculates balanced limits', () => {
    expect(getXbarRConstants(2)).toEqual({
      subgroupSize: 2,
      a2: 1.88,
      d3: 0,
      d4: 3.267,
    });
    expect(getXbarRConstants(10)).toEqual({
      subgroupSize: 10,
      a2: 0.308,
      d3: 0.223,
      d4: 1.777,
    });
    expect(() => getXbarRConstants(1)).toThrow(/at least 2/);
    expect(() => getXbarRConstants(26)).toThrow(/2 through 25/);

    const result = analyzeStability(stabilitySubgroups([10, 10, 10, 10]));
    expect(result.centerLines.xbar).toBeCloseTo(10, 12);
    expect(result.centerLines.range).toBeCloseTo(0.2, 12);
    expect(result.controlLimits.xbar.lower).toBeCloseTo(10 - 1.88 * 0.2, 12);
    expect(result.controlLimits.xbar.upper).toBeCloseTo(10 + 1.88 * 0.2, 12);
    expect(result.controlLimits.range.lower).toBe(0);
    expect(result.controlLimits.range.upper).toBeCloseTo(3.267 * 0.2, 12);
    expect(result.outOfControl).toBe(false);
  });

  it('detects Xbar and range points outside their control limits', () => {
    const means = [10, 10, 10, 10, 10, 10, 10, 10, 12, 10];
    const ranges = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 2];
    const result = analyzeStability(stabilitySubgroups(means, ranges));
    expect(
      result.signals.some(({ rule }) => rule === 'xbar-beyond-control-limit'),
    ).toBe(true);
    expect(
      result.signals.some(({ rule }) => rule === 'range-beyond-control-limit'),
    ).toBe(true);
    expect(result.outOfControl).toBe(true);
    expect(result.warnings.join(' ')).toMatch(/R chart/);
  });

  it('detects six-point trends even when all points remain inside limits', () => {
    const result = analyzeStability(
      stabilitySubgroups([10, 10.01, 10.02, 10.03, 10.04, 10.05]),
    );
    expect(
      result.signals.some(({ rule }) => rule === 'xbar-six-point-trend'),
    ).toBe(true);
  });

  it('detects an eight-point shift on one side of the center line', () => {
    const result = analyzeStability(
      stabilitySubgroups([
        9.9, 9.9, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1, 10.1,
      ]),
    );
    expect(
      result.signals.some(({ rule }) => rule === 'xbar-eight-on-one-side'),
    ).toBe(true);
  });

  it('rejects unbalanced, unordered, duplicate, or malformed subgroups', () => {
    const balanced = stabilitySubgroups([10, 10, 10]);
    expect(() => analyzeStability([balanced[0]])).toThrow(/at least two/);
    expect(() =>
      analyzeStability([
        { ...balanced[0], measurements: null as unknown as number[] },
        balanced[1],
      ]),
    ).toThrow(/must be an array/);
    expect(() =>
      analyzeStability([
        balanced[0],
        { ...balanced[1], measurements: [9.9, 10, 10.1] },
        balanced[2],
      ]),
    ).toThrow(/balanced/);
    expect(() => analyzeStability([balanced[1], balanced[0]])).toThrow(
      /chronological/,
    );
    expect(() =>
      analyzeStability([
        { ...balanced[0] },
        { ...balanced[1], id: balanced[0].id },
      ]),
    ).toThrow(/Duplicate/);
    expect(() =>
      analyzeStability([
        balanced[0],
        { ...balanced[1], timestamp: 'not-a-date' },
      ]),
    ).toThrow(/valid date/);
  });
});
