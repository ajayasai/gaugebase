/**
 * Dependency-free metrology calculations.
 *
 * The functions in this module deliberately return unrounded values. Rounding is
 * a presentation concern and must not feed back into subsequent calculations.
 */

export type UncertaintyDistribution =
  | 'normal'
  | 'rectangular'
  | 'triangular'
  | 'u-shaped';

export interface UncertaintyContributor {
  /** Stable caller-owned identifier, when one exists. */
  id?: string;
  name: string;
  /**
   * Non-negative quoted uncertainty or distribution half-width, in the input
   * quantity's units. It is divided by `divisor` before sensitivity is applied.
   */
  uncertainty: number;
  distribution: UncertaintyDistribution;
  /**
   * Overrides the distribution default. For example, use 2 when a normally
   * distributed input is supplied as an expanded uncertainty with k = 2.
   */
  divisor?: number;
  /** dy/dx for the measurement model. Defaults to 1. */
  sensitivityCoefficient?: number;
  /** Finite positive value for Type A inputs; omitted means effectively infinite. */
  degreesOfFreedom?: number;
}

export interface EvaluatedUncertaintyContributor extends Required<
  Pick<UncertaintyContributor, 'name' | 'uncertainty' | 'distribution'>
> {
  id?: string;
  divisor: number;
  sensitivityCoefficient: number;
  degreesOfFreedom: number;
  standardUncertainty: number;
  signedStandardContribution: number;
  standardContribution: number;
  varianceContribution: number;
  percentVarianceContribution: number;
}

export interface UncertaintyBudgetOptions {
  /** Multiplier applied to combined standard uncertainty. Defaults to 2. */
  coverageFactor?: number;
}

export interface UncertaintyBudgetResult {
  contributors: EvaluatedUncertaintyContributor[];
  combinedStandardUncertainty: number;
  effectiveDegreesOfFreedom: number;
  coverageFactor: number;
  expandedUncertainty: number;
}

const DISTRIBUTION_DIVISORS: Readonly<Record<UncertaintyDistribution, number>> =
  {
    normal: 1,
    rectangular: Math.sqrt(3),
    triangular: Math.sqrt(6),
    'u-shaped': Math.sqrt(2),
  };

const UNCERTAINTY_DISTRIBUTIONS = new Set<UncertaintyDistribution>([
  'normal',
  'rectangular',
  'triangular',
  'u-shaped',
]);

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number.`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value < 0) {
    throw new RangeError(`${label} must be greater than or equal to zero.`);
  }
}

function assertPositiveFinite(value: number, label: string): void {
  assertFiniteNumber(value, label);
  if (value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
}

function nonEmptyLabel(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

export function distributionDivisor(
  distribution: UncertaintyDistribution,
): number {
  if (!UNCERTAINTY_DISTRIBUTIONS.has(distribution)) {
    throw new RangeError(
      `Unsupported uncertainty distribution: ${String(distribution)}.`,
    );
  }
  return DISTRIBUTION_DIVISORS[distribution];
}

/**
 * Reduces a quoted uncertainty to a standard uncertainty. This does not apply a
 * sensitivity coefficient; `calculateUncertaintyBudget` does that separately.
 */
export function calculateStandardUncertainty(
  uncertainty: number,
  distribution: UncertaintyDistribution,
  divisor = distributionDivisor(distribution),
): number {
  assertNonNegativeFinite(uncertainty, 'Uncertainty');
  distributionDivisor(distribution);
  assertPositiveFinite(divisor, 'Uncertainty divisor');
  const result = uncertainty / divisor;
  if (!Number.isFinite(result)) {
    throw new RangeError(
      'Calculated standard uncertainty is outside the supported numeric range.',
    );
  }
  return result;
}

/**
 * Combines independent standard-uncertainty contributions by root-sum-square.
 * Correlated inputs must be transformed into independent contributors by the
 * caller; covariance terms are intentionally not inferred.
 */
export function calculateUncertaintyBudget(
  contributors: readonly UncertaintyContributor[],
  options: UncertaintyBudgetOptions = {},
): UncertaintyBudgetResult {
  if (!Array.isArray(contributors) || contributors.length === 0) {
    throw new RangeError(
      'An uncertainty budget requires at least one contributor.',
    );
  }

  const coverageFactor = options.coverageFactor ?? 2;
  assertPositiveFinite(coverageFactor, 'Coverage factor');

  const evaluated = contributors.map((contributor, index) => {
    const prefix = `Contributor ${index + 1}`;
    const name = nonEmptyLabel(contributor.name, `${prefix} name`);
    const divisor =
      contributor.divisor ?? distributionDivisor(contributor.distribution);
    const standardUncertainty = calculateStandardUncertainty(
      contributor.uncertainty,
      contributor.distribution,
      divisor,
    );
    const sensitivityCoefficient = contributor.sensitivityCoefficient ?? 1;
    assertFiniteNumber(
      sensitivityCoefficient,
      `${prefix} sensitivity coefficient`,
    );

    const degreesOfFreedom =
      contributor.degreesOfFreedom ?? Number.POSITIVE_INFINITY;
    if (degreesOfFreedom !== Number.POSITIVE_INFINITY) {
      assertPositiveFinite(degreesOfFreedom, `${prefix} degrees of freedom`);
    }

    const signedStandardContribution =
      standardUncertainty * sensitivityCoefficient;
    if (!Number.isFinite(signedStandardContribution)) {
      throw new RangeError(
        `${prefix} standard contribution is outside the supported numeric range.`,
      );
    }
    const standardContribution = Math.abs(signedStandardContribution);

    return {
      id: contributor.id,
      name,
      uncertainty: contributor.uncertainty,
      distribution: contributor.distribution,
      divisor,
      sensitivityCoefficient,
      degreesOfFreedom,
      standardUncertainty,
      signedStandardContribution,
      standardContribution,
      varianceContribution: standardContribution ** 2,
      percentVarianceContribution: 0,
    } satisfies EvaluatedUncertaintyContributor;
  });

  const combinedStandardUncertainty = Math.hypot(
    ...evaluated.map((contributor) => contributor.standardContribution),
  );
  if (!Number.isFinite(combinedStandardUncertainty)) {
    throw new RangeError(
      'Combined standard uncertainty is outside the supported numeric range.',
    );
  }

  const combinedVariance = combinedStandardUncertainty ** 2;
  for (const contributor of evaluated) {
    contributor.percentVarianceContribution =
      combinedVariance === 0
        ? 0
        : (contributor.varianceContribution / combinedVariance) * 100;
  }

  // Welch-Satterthwaite, written using normalized contributions to avoid u_c^4 overflow.
  let welchDenominator = 0;
  if (combinedStandardUncertainty > 0) {
    for (const contributor of evaluated) {
      if (
        contributor.standardContribution > 0 &&
        contributor.degreesOfFreedom !== Number.POSITIVE_INFINITY
      ) {
        const normalized =
          contributor.standardContribution / combinedStandardUncertainty;
        welchDenominator += normalized ** 4 / contributor.degreesOfFreedom;
      }
    }
  }
  const effectiveDegreesOfFreedom =
    combinedStandardUncertainty === 0 || welchDenominator === 0
      ? Number.POSITIVE_INFINITY
      : 1 / welchDenominator;
  const expandedUncertainty = combinedStandardUncertainty * coverageFactor;
  if (!Number.isFinite(expandedUncertainty)) {
    throw new RangeError(
      'Expanded uncertainty is outside the supported numeric range.',
    );
  }

  return {
    contributors: evaluated,
    combinedStandardUncertainty,
    effectiveDegreesOfFreedom,
    coverageFactor,
    expandedUncertainty,
  };
}

export type DecisionOutcome = 'pass' | 'fail' | 'conditional' | 'indeterminate';
export type DecisionRuleKind =
  | 'simple-acceptance'
  | 'guard-banded'
  | 'uncertainty-aware';

interface DecisionRuleBase {
  measuredValue: number;
  lowerLimit?: number;
  upperLimit?: number;
}

export type DecisionRuleInput =
  | (DecisionRuleBase & { rule: 'simple-acceptance' })
  | (DecisionRuleBase & { rule: 'guard-banded'; guardBand: number })
  | (DecisionRuleBase & {
      rule: 'uncertainty-aware';
      expandedUncertainty: number;
    });

export interface NumericInterval {
  lower?: number;
  upper?: number;
}

export interface DecisionRuleResult {
  rule: DecisionRuleKind;
  outcome: DecisionOutcome;
  measuredValue: number;
  specificationInterval: NumericInterval;
  acceptanceInterval: NumericInterval;
  uncertaintyInterval?: Required<NumericInterval>;
  /** Positive inside specification, zero on a limit, and negative outside. */
  marginToNearestSpecificationLimit: number;
  explanation: string;
}

function validateSpecificationLimits(
  lowerLimit?: number,
  upperLimit?: number,
): void {
  if (lowerLimit === undefined && upperLimit === undefined) {
    throw new RangeError('At least one specification limit is required.');
  }
  if (lowerLimit !== undefined)
    assertFiniteNumber(lowerLimit, 'Lower specification limit');
  if (upperLimit !== undefined)
    assertFiniteNumber(upperLimit, 'Upper specification limit');
  if (
    lowerLimit !== undefined &&
    upperLimit !== undefined &&
    lowerLimit >= upperLimit
  ) {
    throw new RangeError(
      'Upper specification limit must be greater than lower specification limit.',
    );
  }
}

function isInside(value: number, lower?: number, upper?: number): boolean {
  return (
    (lower === undefined || value >= lower) &&
    (upper === undefined || value <= upper)
  );
}

function specificationMargin(
  value: number,
  lower?: number,
  upper?: number,
): number {
  const margins: number[] = [];
  if (lower !== undefined) margins.push(value - lower);
  if (upper !== undefined) margins.push(upper - value);
  return Math.min(...margins);
}

/**
 * Applies an explicit decision rule. No rule is silently selected and no
 * uncertainty is silently substituted for a guard band.
 */
export function evaluateDecisionRule(
  input: DecisionRuleInput,
): DecisionRuleResult {
  assertFiniteNumber(input.measuredValue, 'Measured value');
  validateSpecificationLimits(input.lowerLimit, input.upperLimit);

  const specificationInterval = {
    lower: input.lowerLimit,
    upper: input.upperLimit,
  };
  const marginToNearestSpecificationLimit = specificationMargin(
    input.measuredValue,
    input.lowerLimit,
    input.upperLimit,
  );

  if (input.rule === 'simple-acceptance') {
    const outcome: DecisionOutcome = isInside(
      input.measuredValue,
      input.lowerLimit,
      input.upperLimit,
    )
      ? 'pass'
      : 'fail';
    return {
      rule: input.rule,
      outcome,
      measuredValue: input.measuredValue,
      specificationInterval,
      acceptanceInterval: specificationInterval,
      marginToNearestSpecificationLimit,
      explanation:
        outcome === 'pass'
          ? 'The measured value is within the stated specification limits.'
          : 'The measured value is outside the stated specification limits.',
    };
  }

  if (input.rule === 'guard-banded') {
    assertNonNegativeFinite(input.guardBand, 'Guard band');
    const acceptanceLower =
      input.lowerLimit === undefined
        ? undefined
        : input.lowerLimit + input.guardBand;
    const acceptanceUpper =
      input.upperLimit === undefined
        ? undefined
        : input.upperLimit - input.guardBand;
    if (
      acceptanceLower !== undefined &&
      acceptanceUpper !== undefined &&
      acceptanceLower > acceptanceUpper
    ) {
      throw new RangeError(
        'Guard band is too large for the specification interval.',
      );
    }
    if (
      (acceptanceLower !== undefined && !Number.isFinite(acceptanceLower)) ||
      (acceptanceUpper !== undefined && !Number.isFinite(acceptanceUpper))
    ) {
      throw new RangeError(
        'Guard-banded acceptance limits are outside the supported numeric range.',
      );
    }

    const withinSpecification = isInside(
      input.measuredValue,
      input.lowerLimit,
      input.upperLimit,
    );
    const withinAcceptance = isInside(
      input.measuredValue,
      acceptanceLower,
      acceptanceUpper,
    );
    const outcome: DecisionOutcome = !withinSpecification
      ? 'fail'
      : withinAcceptance
        ? 'pass'
        : 'conditional';
    const explanations: Record<DecisionOutcome, string> = {
      pass: 'The measured value is within the guard-banded acceptance interval.',
      conditional:
        'The measured value is within specification but inside the guard band; authorized review is required.',
      fail: 'The measured value is outside the stated specification limits.',
      indeterminate: '',
    };
    return {
      rule: input.rule,
      outcome,
      measuredValue: input.measuredValue,
      specificationInterval,
      acceptanceInterval: { lower: acceptanceLower, upper: acceptanceUpper },
      marginToNearestSpecificationLimit,
      explanation: explanations[outcome],
    };
  }

  if (input.rule !== 'uncertainty-aware') {
    throw new RangeError(
      `Unsupported decision rule: ${String((input as { rule?: unknown }).rule)}.`,
    );
  }
  assertNonNegativeFinite(input.expandedUncertainty, 'Expanded uncertainty');
  const uncertaintyLower = input.measuredValue - input.expandedUncertainty;
  const uncertaintyUpper = input.measuredValue + input.expandedUncertainty;
  if (
    !Number.isFinite(uncertaintyLower) ||
    !Number.isFinite(uncertaintyUpper)
  ) {
    throw new RangeError(
      'Measurement uncertainty interval is outside the supported numeric range.',
    );
  }

  const intervalInside =
    (input.lowerLimit === undefined || uncertaintyLower >= input.lowerLimit) &&
    (input.upperLimit === undefined || uncertaintyUpper <= input.upperLimit);
  const intervalWhollyOutside =
    (input.lowerLimit !== undefined && uncertaintyUpper < input.lowerLimit) ||
    (input.upperLimit !== undefined && uncertaintyLower > input.upperLimit);
  const measuredValueInside = isInside(
    input.measuredValue,
    input.lowerLimit,
    input.upperLimit,
  );

  const outcome: DecisionOutcome = intervalInside
    ? 'pass'
    : intervalWhollyOutside
      ? 'fail'
      : measuredValueInside
        ? 'conditional'
        : 'indeterminate';
  const explanations: Record<DecisionOutcome, string> = {
    pass: 'The complete expanded-uncertainty interval is within specification.',
    fail: 'The complete expanded-uncertainty interval is outside specification.',
    conditional:
      'The measured value is in specification, but its expanded-uncertainty interval crosses a specification limit.',
    indeterminate:
      'The measured value is outside specification, but its expanded-uncertainty interval overlaps the conforming region.',
  };
  return {
    rule: input.rule,
    outcome,
    measuredValue: input.measuredValue,
    specificationInterval,
    acceptanceInterval: specificationInterval,
    uncertaintyInterval: { lower: uncertaintyLower, upper: uncertaintyUpper },
    marginToNearestSpecificationLimit,
    explanation: explanations[outcome],
  };
}

export interface GrrObservation {
  part: string;
  appraiser: string;
  trial: string | number;
  value: number;
}

export interface CrossedGrrOptions {
  /** Six sigma is the default study variation. Set 5.15 for legacy 99% studies. */
  studyVariationMultiplier?: number;
  /** Both limits are required when percent-of-tolerance values are wanted. */
  lowerSpecificationLimit?: number;
  upperSpecificationLimit?: number;
}

export interface GrrVariationComponent {
  standardDeviation: number;
  variance: number;
  studyVariation: number;
  percentStudyVariation: number | null;
  percentContribution: number | null;
  percentTolerance: number | null;
}

export type GrrClassification =
  | 'acceptable'
  | 'conditionally-acceptable'
  | 'unacceptable'
  | 'indeterminate';

export interface CrossedGrrResult {
  method: 'average-and-range';
  design: {
    partCount: number;
    appraiserCount: number;
    trialsPerCell: number;
    observationCount: number;
    balanced: true;
  };
  constants: {
    repeatabilityD2: number;
    reproducibilityD2: number;
    partD2: number;
    studyVariationMultiplier: number;
  };
  descriptive: {
    grandMean: number;
    averageCellRange: number;
    appraiserMeanRange: number;
    partMeanRange: number;
    partMeans: Array<{ part: string; mean: number }>;
    appraiserMeans: Array<{ appraiser: string; mean: number }>;
  };
  components: {
    repeatability: GrrVariationComponent;
    reproducibility: GrrVariationComponent;
    gaugeRr: GrrVariationComponent;
    partToPart: GrrVariationComponent;
    total: GrrVariationComponent;
  };
  numberOfDistinctCategories: number;
  classification: GrrClassification;
  summary: string;
  warnings: string[];
  assumptions: string[];
}

const D2_CONSTANTS: Readonly<Record<number, number>> = {
  2: 1.128,
  3: 1.693,
  4: 2.059,
  5: 2.326,
  6: 2.534,
  7: 2.704,
  8: 2.847,
  9: 2.97,
  10: 3.078,
  11: 3.173,
  12: 3.258,
  13: 3.336,
  14: 3.407,
  15: 3.472,
  16: 3.532,
  17: 3.588,
  18: 3.64,
  19: 3.689,
  20: 3.735,
  21: 3.778,
  22: 3.819,
  23: 3.858,
  24: 3.895,
  25: 3.931,
};

const calculatedD2 = new Map<number, number>();

// Stable normal CDF approximation; its maximum error is below 8e-8.
function normalCdf(value: number): number {
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.2316419 * absolute);
  const density = 0.3989422804014327 * Math.exp((-absolute * absolute) / 2);
  const tail =
    density *
    t *
    (0.31938153 +
      t *
        (-0.356563782 +
          t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return value >= 0 ? 1 - tail : tail;
}

/** Expected range of n independent standard-normal observations. */
export function d2Constant(sampleSize: number): number {
  if (!Number.isSafeInteger(sampleSize) || sampleSize < 2) {
    throw new RangeError(
      'd2 sample size must be a safe integer of at least 2.',
    );
  }
  const tabulated = D2_CONSTANTS[sampleSize];
  if (tabulated !== undefined) return tabulated;
  const cached = calculatedD2.get(sampleSize);
  if (cached !== undefined) return cached;

  // E(range) = 2 integral_0^inf [1 - Phi(x)^n - (1-Phi(x))^n] dx.
  // Composite Simpson integration to 8 sigma is effectively the full integral.
  const steps = 4096;
  const upper = 8;
  const width = upper / steps;
  let sum = 0;
  for (let index = 0; index <= steps; index += 1) {
    const x = index * width;
    const probability = normalCdf(x);
    const integrand =
      2 * (1 - probability ** sampleSize - (1 - probability) ** sampleSize);
    const weight = index === 0 || index === steps ? 1 : index % 2 === 0 ? 2 : 4;
    sum += weight * integrand;
  }
  const result = (sum * width) / 3;
  calculatedD2.set(sampleSize, result);
  return result;
}

interface NormalizedGrrObservation {
  part: string;
  appraiser: string;
  trial: string;
  value: number;
}

function normalizeTrial(value: string | number, index: number): string {
  if (typeof value === 'number') {
    assertFiniteNumber(value, `Observation ${index + 1} trial`);
  }
  const result = String(value).trim();
  if (result.length === 0) {
    throw new TypeError(`Observation ${index + 1} trial must not be empty.`);
  }
  return result;
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function range(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function sameStringSet(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}

function component(
  standardDeviation: number,
  totalStandardDeviation: number,
  tolerance: number | null,
  studyVariationMultiplier: number,
): GrrVariationComponent {
  const studyVariation = standardDeviation * studyVariationMultiplier;
  const variance = standardDeviation ** 2;
  const totalVariance = totalStandardDeviation ** 2;
  return {
    standardDeviation,
    variance,
    studyVariation,
    percentStudyVariation:
      totalStandardDeviation === 0
        ? null
        : (standardDeviation / totalStandardDeviation) * 100,
    percentContribution:
      totalVariance === 0 ? null : (variance / totalVariance) * 100,
    percentTolerance:
      tolerance === null ? null : (studyVariation / tolerance) * 100,
  };
}

/**
 * Balanced crossed Gage R&R using the average-and-range method.
 *
 * The method estimates repeatability from the average within-cell range,
 * reproducibility from the range of appraiser grand means (corrected for
 * repeatability), and part variation from the range of part grand means.
 */
export function calculateCrossedGrr(
  observations: readonly GrrObservation[],
  options: CrossedGrrOptions = {},
): CrossedGrrResult {
  if (!Array.isArray(observations) || observations.length === 0) {
    throw new RangeError('A Gage R&R study requires observations.');
  }
  const studyVariationMultiplier = options.studyVariationMultiplier ?? 6;
  assertPositiveFinite(studyVariationMultiplier, 'Study variation multiplier');

  const hasLower = options.lowerSpecificationLimit !== undefined;
  const hasUpper = options.upperSpecificationLimit !== undefined;
  if (hasLower !== hasUpper) {
    throw new RangeError('Provide both specification limits or neither.');
  }
  let tolerance: number | null = null;
  if (hasLower && hasUpper) {
    assertFiniteNumber(
      options.lowerSpecificationLimit as number,
      'Lower specification limit',
    );
    assertFiniteNumber(
      options.upperSpecificationLimit as number,
      'Upper specification limit',
    );
    if (
      (options.upperSpecificationLimit as number) <=
      (options.lowerSpecificationLimit as number)
    ) {
      throw new RangeError(
        'Upper specification limit must be greater than lower specification limit.',
      );
    }
    tolerance =
      (options.upperSpecificationLimit as number) -
      (options.lowerSpecificationLimit as number);
  }

  const normalized: NormalizedGrrObservation[] = observations.map(
    (observation, index) => {
      const part = nonEmptyLabel(
        observation.part,
        `Observation ${index + 1} part`,
      );
      const appraiser = nonEmptyLabel(
        observation.appraiser,
        `Observation ${index + 1} appraiser`,
      );
      const trial = normalizeTrial(observation.trial, index);
      assertFiniteNumber(observation.value, `Observation ${index + 1} value`);
      return { part, appraiser, trial, value: observation.value };
    },
  );

  const partIds = [
    ...new Set(normalized.map((observation) => observation.part)),
  ].sort();
  const appraiserIds = [
    ...new Set(normalized.map((observation) => observation.appraiser)),
  ].sort();
  const trialIds = new Set(normalized.map((observation) => observation.trial));
  if (partIds.length < 2)
    throw new RangeError(
      'A crossed Gage R&R study requires at least two parts.',
    );
  if (appraiserIds.length < 2) {
    throw new RangeError(
      'A crossed Gage R&R study requires at least two appraisers.',
    );
  }
  if (trialIds.size < 2) {
    throw new RangeError(
      'A crossed Gage R&R study requires at least two trials per cell.',
    );
  }

  const cells = new Map<string, Map<string, Map<string, number>>>();
  for (const observation of normalized) {
    let byAppraiser = cells.get(observation.part);
    if (!byAppraiser) {
      byAppraiser = new Map();
      cells.set(observation.part, byAppraiser);
    }
    let byTrial = byAppraiser.get(observation.appraiser);
    if (!byTrial) {
      byTrial = new Map();
      byAppraiser.set(observation.appraiser, byTrial);
    }
    if (byTrial.has(observation.trial)) {
      throw new RangeError(
        `Duplicate observation for part "${observation.part}", appraiser "${observation.appraiser}", trial "${observation.trial}".`,
      );
    }
    byTrial.set(observation.trial, observation.value);
  }

  const cellRanges: number[] = [];
  for (const part of partIds) {
    const byAppraiser = cells.get(part);
    for (const appraiser of appraiserIds) {
      const byTrial = byAppraiser?.get(appraiser);
      if (!byTrial) {
        throw new RangeError(
          `Missing observations for part "${part}" and appraiser "${appraiser}".`,
        );
      }
      const cellTrials = new Set(byTrial.keys());
      if (!sameStringSet(cellTrials, trialIds)) {
        throw new RangeError(
          `Unbalanced trials for part "${part}" and appraiser "${appraiser}"; every cell must use the same trials.`,
        );
      }
      cellRanges.push(range([...byTrial.values()]));
    }
  }

  const expectedObservationCount =
    partIds.length * appraiserIds.length * trialIds.size;
  if (normalized.length !== expectedObservationCount) {
    throw new RangeError(
      'The Gage R&R design must be a complete, balanced crossed study.',
    );
  }

  const partMeans = partIds.map((part) => ({
    part,
    mean: average(
      normalized
        .filter((observation) => observation.part === part)
        .map(({ value }) => value),
    ),
  }));
  const appraiserMeans = appraiserIds.map((appraiser) => ({
    appraiser,
    mean: average(
      normalized
        .filter((observation) => observation.appraiser === appraiser)
        .map(({ value }) => value),
    ),
  }));

  const repeatabilityD2 = d2Constant(trialIds.size);
  const reproducibilityD2 = d2Constant(appraiserIds.length);
  const partD2 = d2Constant(partIds.length);
  const averageCellRange = average(cellRanges);
  const appraiserMeanRange = range(appraiserMeans.map(({ mean }) => mean));
  const partMeanRange = range(partMeans.map(({ mean }) => mean));

  const repeatability = averageCellRange / repeatabilityD2;
  const uncorrectedReproducibility = appraiserMeanRange / reproducibilityD2;
  const reproducibilityVariance =
    uncorrectedReproducibility ** 2 -
    repeatability ** 2 / (partIds.length * trialIds.size);
  const reproducibility = Math.sqrt(Math.max(0, reproducibilityVariance));
  const gaugeRr = Math.hypot(repeatability, reproducibility);
  const partToPart = partMeanRange / partD2;
  const total = Math.hypot(gaugeRr, partToPart);

  const numberOfDistinctCategories =
    gaugeRr === 0
      ? partToPart === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : Math.floor(1.41 * (partToPart / gaugeRr));

  const gaugeRrPercent = total === 0 ? null : (gaugeRr / total) * 100;
  let classification: GrrClassification;
  if (gaugeRrPercent === null) {
    classification = 'indeterminate';
  } else if (gaugeRrPercent <= 10 && numberOfDistinctCategories >= 5) {
    classification = 'acceptable';
  } else if (gaugeRrPercent <= 30 && numberOfDistinctCategories >= 2) {
    classification = 'conditionally-acceptable';
  } else {
    classification = 'unacceptable';
  }

  const warnings: string[] = [];
  if (reproducibilityVariance < 0) {
    warnings.push(
      'The corrected reproducibility variance was negative and has been truncated to zero, as required by the average-and-range method.',
    );
  }
  if (total === 0) {
    warnings.push(
      'No variation was observed; study adequacy cannot be determined from constant data.',
    );
  }
  if (numberOfDistinctCategories < 5) {
    warnings.push(
      'Fewer than five distinct categories indicates inadequate measurement discrimination.',
    );
  }
  if (gaugeRrPercent !== null && gaugeRrPercent > 30) {
    warnings.push('Gage R&R exceeds 30% of total study variation.');
  }
  if (tolerance === null) {
    warnings.push(
      'Specification limits were not supplied, so percent-of-tolerance metrics are unavailable.',
    );
  }

  const summaryByClassification: Record<GrrClassification, string> = {
    acceptable:
      'The measurement system is acceptable by the common <=10% study-variation and >=5-category screening criteria.',
    'conditionally-acceptable':
      'The measurement system may be acceptable for some applications; review risk, cost, use, and discrimination before approval.',
    unacceptable:
      'The measurement system does not meet common Gage R&R screening criteria and should be improved before use.',
    indeterminate:
      'The study contains no observable variation, so measurement-system capability is indeterminate.',
  };

  return {
    method: 'average-and-range',
    design: {
      partCount: partIds.length,
      appraiserCount: appraiserIds.length,
      trialsPerCell: trialIds.size,
      observationCount: normalized.length,
      balanced: true,
    },
    constants: {
      repeatabilityD2,
      reproducibilityD2,
      partD2,
      studyVariationMultiplier,
    },
    descriptive: {
      grandMean: average(normalized.map(({ value }) => value)),
      averageCellRange,
      appraiserMeanRange,
      partMeanRange,
      partMeans,
      appraiserMeans,
    },
    components: {
      repeatability: component(
        repeatability,
        total,
        tolerance,
        studyVariationMultiplier,
      ),
      reproducibility: component(
        reproducibility,
        total,
        tolerance,
        studyVariationMultiplier,
      ),
      gaugeRr: component(gaugeRr, total, tolerance, studyVariationMultiplier),
      partToPart: component(
        partToPart,
        total,
        tolerance,
        studyVariationMultiplier,
      ),
      total: component(total, total, tolerance, studyVariationMultiplier),
    },
    numberOfDistinctCategories,
    classification,
    summary: summaryByClassification[classification],
    warnings,
    assumptions: [
      'The design is balanced and fully crossed: every appraiser measures every part for every trial.',
      'Parts represent the intended process range, appraisers follow one defined method, and repeated readings are independent.',
      'The average-and-range method assumes approximately normal, stable measurement error.',
      'Part-by-appraiser interaction is not estimated by this method; use an ANOVA Gage R&R when interaction matters.',
      `Study variation is ${studyVariationMultiplier} times the estimated standard deviation.`,
    ],
  };
}

export interface BiasAnalysisResult {
  referenceValue: number;
  measurementCount: number;
  degreesOfFreedom: number;
  meanMeasurement: number;
  meanBias: number;
  percentBiasOfReference: number | null;
  sampleStandardDeviation: number;
  standardError: number;
  tStatistic: number;
  criticalT95: number;
  confidenceInterval95: { lower: number; upper: number };
  statisticallySignificantAt95Percent: boolean;
  individualBiases: number[];
  warnings: string[];
  assumptions: string[];
}

const T_CRITICAL_95: Readonly<Record<number, number>> = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  11: 2.201,
  12: 2.179,
  13: 2.16,
  14: 2.145,
  15: 2.131,
  16: 2.12,
  17: 2.11,
  18: 2.101,
  19: 2.093,
  20: 2.086,
  21: 2.08,
  22: 2.074,
  23: 2.069,
  24: 2.064,
  25: 2.06,
  26: 2.056,
  27: 2.052,
  28: 2.048,
  29: 2.045,
  30: 2.042,
};

/** Two-sided 95% Student-t critical value. */
function criticalT95(degreesOfFreedom: number): number {
  const tabulated = T_CRITICAL_95[degreesOfFreedom];
  if (tabulated !== undefined) return tabulated;

  // Cornish-Fisher expansion around z(.975), accurate for df > 30.
  const z = 1.959963984540054;
  const df = degreesOfFreedom;
  return (
    z +
    (z ** 3 + z) / (4 * df) +
    (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3)
  );
}

function sampleStandardDeviation(
  values: readonly number[],
  mean: number,
): number {
  const sumOfSquares = values.reduce(
    (sum, value) => sum + (value - mean) ** 2,
    0,
  );
  return Math.sqrt(sumOfSquares / (values.length - 1));
}

function tStatisticFor(estimate: number, standardError: number): number {
  if (standardError > 0) return estimate / standardError;
  if (estimate === 0) return 0;
  return Math.sign(estimate) * Number.POSITIVE_INFINITY;
}

/**
 * Estimates measurement-system bias from repeated measurements of one reference.
 * Reference-standard uncertainty is not folded into the confidence interval.
 */
export function analyzeBias(
  measurements: readonly number[],
  referenceValue: number,
): BiasAnalysisResult {
  if (!Array.isArray(measurements) || measurements.length < 2) {
    throw new RangeError(
      'Bias analysis requires at least two repeated measurements.',
    );
  }
  assertFiniteNumber(referenceValue, 'Reference value');
  measurements.forEach((measurement, index) =>
    assertFiniteNumber(measurement, `Measurement ${index + 1}`),
  );

  const meanMeasurement = average(measurements);
  const individualBiases = measurements.map(
    (measurement) => measurement - referenceValue,
  );
  const meanBias = meanMeasurement - referenceValue;
  const standardDeviation = sampleStandardDeviation(
    measurements,
    meanMeasurement,
  );
  const standardError = standardDeviation / Math.sqrt(measurements.length);
  const degreesOfFreedom = measurements.length - 1;
  const critical = criticalT95(degreesOfFreedom);
  const halfWidth = critical * standardError;
  const lower = meanBias - halfWidth;
  const upper = meanBias + halfWidth;
  const tStatistic = tStatisticFor(meanBias, standardError);
  const significant = lower > 0 || upper < 0;

  const warnings = [
    'Reference-standard uncertainty is not included; include it in a separate uncertainty budget when it is material.',
  ];
  if (measurements.length < 10) {
    warnings.push(
      'Fewer than ten repetitions produces a low-power bias estimate and a wide t interval.',
    );
  }
  if (standardDeviation === 0) {
    warnings.push(
      'All repeated measurements are identical; the estimated repeatability is zero and the t inference is degenerate.',
    );
  }
  if (significant) {
    warnings.push(
      'The approximate 95% confidence interval excludes zero bias.',
    );
  }

  return {
    referenceValue,
    measurementCount: measurements.length,
    degreesOfFreedom,
    meanMeasurement,
    meanBias,
    percentBiasOfReference:
      referenceValue === 0 ? null : (meanBias / Math.abs(referenceValue)) * 100,
    sampleStandardDeviation: standardDeviation,
    standardError,
    tStatistic,
    criticalT95: critical,
    confidenceInterval95: { lower, upper },
    statisticallySignificantAt95Percent: significant,
    individualBiases,
    warnings,
    assumptions: [
      'Repeated measurements are independent and collected while the measurement system is stable.',
      'The repeated-measurement distribution is approximately normal, especially for small samples.',
      'The reference value is suitable for the intended range and its uncertainty is negligible for this t interval.',
      'The interval is a two-sided Student-t interval for mean bias at approximately 95% confidence.',
    ],
  };
}

export interface LinearityObservation {
  id?: string;
  referenceValue: number;
  measuredValue: number;
}

export interface LinearityFittedLevel {
  referenceValue: number;
  measurementCount: number;
  observedMeanBias: number;
  fittedBias: number;
  residualMeanBias: number;
}

export interface LinearityFittedObservation extends LinearityObservation {
  bias: number;
  fittedBias: number;
  residual: number;
}

export interface LinearityAnalysisResult {
  observationCount: number;
  referenceLevelCount: number;
  referenceRange: { minimum: number; maximum: number; span: number };
  slope: number;
  intercept: number;
  rSquared: number | null;
  residualStandardDeviation: number;
  degreesOfFreedom: number;
  slopeStandardError: number;
  interceptStandardError: number;
  slopeTStatistic: number;
  criticalT95: number;
  slopeConfidenceInterval95: { lower: number; upper: number };
  statisticallySignificantSlopeAt95Percent: boolean;
  fittedBiasChangeAcrossRange: number;
  fittedLevels: LinearityFittedLevel[];
  fittedObservations: LinearityFittedObservation[];
  warnings: string[];
  assumptions: string[];
}

/**
 * Regresses individual bias (measured - reference) on reference value using OLS.
 * A non-zero slope is evidence that bias changes over the studied range.
 */
export function analyzeLinearity(
  observations: readonly LinearityObservation[],
): LinearityAnalysisResult {
  if (!Array.isArray(observations) || observations.length < 3) {
    throw new RangeError(
      'Linearity analysis requires observations at three or more reference levels.',
    );
  }

  const normalized = observations.map((observation, index) => {
    assertFiniteNumber(
      observation.referenceValue,
      `Observation ${index + 1} reference value`,
    );
    assertFiniteNumber(
      observation.measuredValue,
      `Observation ${index + 1} measured value`,
    );
    if (observation.id !== undefined) {
      nonEmptyLabel(observation.id, `Observation ${index + 1} id`);
    }
    return {
      ...observation,
      bias: observation.measuredValue - observation.referenceValue,
    };
  });
  const referenceLevels = [
    ...new Set(normalized.map(({ referenceValue }) => referenceValue)),
  ].sort((left, right) => left - right);
  if (referenceLevels.length < 3) {
    throw new RangeError(
      'Linearity analysis requires at least three distinct reference levels.',
    );
  }

  const referenceValues = normalized.map(
    ({ referenceValue }) => referenceValue,
  );
  const biases = normalized.map(({ bias }) => bias);
  const meanReference = average(referenceValues);
  const meanBias = average(biases);
  const centeredReference = referenceValues.map(
    (value) => value - meanReference,
  );
  const centeredBias = biases.map((value) => value - meanBias);
  const sumSquaresReference = centeredReference.reduce(
    (sum, value) => sum + value ** 2,
    0,
  );
  const sumProducts = centeredReference.reduce(
    (sum, value, index) => sum + value * centeredBias[index],
    0,
  );
  if (sumSquaresReference === 0 || !Number.isFinite(sumSquaresReference)) {
    throw new RangeError(
      'Reference values do not provide a numerically usable range.',
    );
  }

  const slope = sumProducts / sumSquaresReference;
  const intercept = meanBias - slope * meanReference;
  if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
    throw new RangeError(
      'Linearity regression is outside the supported numeric range.',
    );
  }

  const fittedObservations: LinearityFittedObservation[] = normalized.map(
    (observation) => {
      const fittedBias = intercept + slope * observation.referenceValue;
      return {
        id: observation.id,
        referenceValue: observation.referenceValue,
        measuredValue: observation.measuredValue,
        bias: observation.bias,
        fittedBias,
        residual: observation.bias - fittedBias,
      };
    },
  );
  const residualSumSquares = fittedObservations.reduce(
    (sum, observation) => sum + observation.residual ** 2,
    0,
  );
  const totalSumSquares = centeredBias.reduce(
    (sum, value) => sum + value ** 2,
    0,
  );
  const degreesOfFreedom = observations.length - 2;
  const residualStandardDeviation = Math.sqrt(
    residualSumSquares / degreesOfFreedom,
  );
  const slopeStandardError =
    residualStandardDeviation / Math.sqrt(sumSquaresReference);
  const interceptStandardError =
    residualStandardDeviation *
    Math.sqrt(
      1 / observations.length + meanReference ** 2 / sumSquaresReference,
    );
  const slopeTStatistic = tStatisticFor(slope, slopeStandardError);
  const critical = criticalT95(degreesOfFreedom);
  const slopeHalfWidth = critical * slopeStandardError;
  const slopeConfidenceInterval95 = {
    lower: slope - slopeHalfWidth,
    upper: slope + slopeHalfWidth,
  };
  const significantSlope =
    slopeConfidenceInterval95.lower > 0 || slopeConfidenceInterval95.upper < 0;
  const minimum = referenceLevels[0];
  const maximum = referenceLevels[referenceLevels.length - 1];
  const span = maximum - minimum;

  const levelGroups = new Map<number, number[]>();
  for (const observation of normalized) {
    const group = levelGroups.get(observation.referenceValue) ?? [];
    group.push(observation.bias);
    levelGroups.set(observation.referenceValue, group);
  }
  const fittedLevels = referenceLevels.map((referenceValue) => {
    const levelBiases = levelGroups.get(referenceValue) as number[];
    const observedMeanBias = average(levelBiases);
    const fittedBias = intercept + slope * referenceValue;
    return {
      referenceValue,
      measurementCount: levelBiases.length,
      observedMeanBias,
      fittedBias,
      residualMeanBias: observedMeanBias - fittedBias,
    };
  });

  const warnings: string[] = [
    'Reference-standard uncertainty is not included in this ordinary least-squares model.',
  ];
  const levelCounts = new Set(
    fittedLevels.map(({ measurementCount }) => measurementCount),
  );
  if (levelCounts.size > 1) {
    warnings.push(
      'Reference levels have unequal replication, so levels with more observations receive more weight in the fit.',
    );
  }
  if (
    Math.min(...fittedLevels.map(({ measurementCount }) => measurementCount)) <
    2
  ) {
    warnings.push(
      'At least one reference level has no replication, limiting lack-of-fit assessment.',
    );
  }
  if (observations.length < 10) {
    warnings.push(
      'The regression has fewer than ten observations; slope inference has limited power.',
    );
  }
  if (totalSumSquares === 0) {
    warnings.push(
      'All observed biases are identical, so R-squared is undefined.',
    );
  }
  if (significantSlope) {
    warnings.push(
      'The approximate 95% slope confidence interval excludes zero.',
    );
  }

  return {
    observationCount: observations.length,
    referenceLevelCount: referenceLevels.length,
    referenceRange: { minimum, maximum, span },
    slope,
    intercept,
    rSquared:
      totalSumSquares === 0
        ? null
        : Math.max(0, Math.min(1, 1 - residualSumSquares / totalSumSquares)),
    residualStandardDeviation,
    degreesOfFreedom,
    slopeStandardError,
    interceptStandardError,
    slopeTStatistic,
    criticalT95: critical,
    slopeConfidenceInterval95,
    statisticallySignificantSlopeAt95Percent: significantSlope,
    fittedBiasChangeAcrossRange: slope * span,
    fittedLevels,
    fittedObservations,
    warnings,
    assumptions: [
      'Individual bias is modeled as a linear function of reference value using unweighted ordinary least squares.',
      'Residuals are independent, approximately normal, and have constant variance across the reference range.',
      'Reference values span the intended operating range and their uncertainties are negligible for this regression.',
      'A non-significant slope does not prove linearity; it means the study did not detect a changing bias.',
    ],
  };
}

export interface StabilitySubgroup {
  id?: string;
  /** Parseable timestamp; subgroups must be supplied in strictly increasing order. */
  timestamp: string;
  measurements: readonly number[];
}

export interface XbarRConstants {
  subgroupSize: number;
  a2: number;
  d3: number;
  d4: number;
}

export type StabilitySignalRule =
  | 'xbar-beyond-control-limit'
  | 'range-beyond-control-limit'
  | 'xbar-eight-on-one-side'
  | 'xbar-six-point-trend';

export interface StabilitySignal {
  subgroupIndex: number;
  subgroupId?: string;
  timestamp: string;
  chart: 'xbar' | 'range';
  rule: StabilitySignalRule;
  message: string;
}

export interface StabilitySubgroupResult {
  subgroupIndex: number;
  id?: string;
  timestamp: string;
  mean: number;
  range: number;
  xbarBeyondControlLimits: boolean;
  rangeBeyondControlLimits: boolean;
}

export interface StabilityAnalysisResult {
  subgroupSize: number;
  subgroupCount: number;
  constants: XbarRConstants;
  centerLines: { xbar: number; range: number };
  controlLimits: {
    xbar: { lower: number; upper: number };
    range: { lower: number; upper: number };
  };
  subgroups: StabilitySubgroupResult[];
  signals: StabilitySignal[];
  outOfControl: boolean;
  warnings: string[];
  assumptions: string[];
}

const XBAR_R_CONSTANTS: Readonly<
  Record<number, Omit<XbarRConstants, 'subgroupSize'>>
> = {
  2: { a2: 1.88, d3: 0, d4: 3.267 },
  3: { a2: 1.023, d3: 0, d4: 2.574 },
  4: { a2: 0.729, d3: 0, d4: 2.282 },
  5: { a2: 0.577, d3: 0, d4: 2.114 },
  6: { a2: 0.483, d3: 0, d4: 2.004 },
  7: { a2: 0.419, d3: 0.076, d4: 1.924 },
  8: { a2: 0.373, d3: 0.136, d4: 1.864 },
  9: { a2: 0.337, d3: 0.184, d4: 1.816 },
  10: { a2: 0.308, d3: 0.223, d4: 1.777 },
  11: { a2: 0.285, d3: 0.256, d4: 1.744 },
  12: { a2: 0.266, d3: 0.283, d4: 1.717 },
  13: { a2: 0.249, d3: 0.307, d4: 1.693 },
  14: { a2: 0.235, d3: 0.328, d4: 1.672 },
  15: { a2: 0.223, d3: 0.347, d4: 1.653 },
  16: { a2: 0.212, d3: 0.363, d4: 1.637 },
  17: { a2: 0.203, d3: 0.378, d4: 1.622 },
  18: { a2: 0.194, d3: 0.391, d4: 1.608 },
  19: { a2: 0.187, d3: 0.403, d4: 1.597 },
  20: { a2: 0.18, d3: 0.415, d4: 1.585 },
  21: { a2: 0.173, d3: 0.425, d4: 1.575 },
  22: { a2: 0.167, d3: 0.434, d4: 1.566 },
  23: { a2: 0.162, d3: 0.443, d4: 1.557 },
  24: { a2: 0.157, d3: 0.451, d4: 1.548 },
  25: { a2: 0.153, d3: 0.459, d4: 1.541 },
};

export function getXbarRConstants(subgroupSize: number): XbarRConstants {
  if (!Number.isSafeInteger(subgroupSize) || subgroupSize < 2) {
    throw new RangeError(
      'Xbar/R subgroup size must be a safe integer of at least 2.',
    );
  }
  const constants = XBAR_R_CONSTANTS[subgroupSize];
  if (!constants) {
    throw new RangeError(
      'Xbar/R constants are available for practical subgroup sizes from 2 through 25.',
    );
  }
  return { subgroupSize, ...constants };
}

function addStabilitySignal(
  signals: StabilitySignal[],
  subgroup: StabilitySubgroupResult,
  chart: 'xbar' | 'range',
  rule: StabilitySignalRule,
  message: string,
): void {
  signals.push({
    subgroupIndex: subgroup.subgroupIndex,
    subgroupId: subgroup.id,
    timestamp: subgroup.timestamp,
    chart,
    rule,
    message,
  });
}

/**
 * Builds classical Xbar/R control limits from chronological, balanced rational
 * subgroups and identifies limit, run, and trend signals.
 */
export function analyzeStability(
  subgroups: readonly StabilitySubgroup[],
): StabilityAnalysisResult {
  if (!Array.isArray(subgroups) || subgroups.length < 2) {
    throw new RangeError(
      'Stability analysis requires at least two chronological subgroups.',
    );
  }
  if (!Array.isArray(subgroups[0].measurements)) {
    throw new TypeError('Stability subgroup measurements must be an array.');
  }
  const subgroupSize = subgroups[0].measurements.length;
  const constants = getXbarRConstants(subgroupSize);
  const ids = new Set<string>();
  let previousTimestamp = Number.NEGATIVE_INFINITY;

  const calculated: StabilitySubgroupResult[] = subgroups.map(
    (subgroup, index) => {
      if (
        !Array.isArray(subgroup.measurements) ||
        subgroup.measurements.length !== subgroupSize
      ) {
        throw new RangeError(
          'Stability analysis requires balanced subgroups of equal size.',
        );
      }
      subgroup.measurements.forEach(
        (measurement: number, measurementIndex: number) =>
          assertFiniteNumber(
            measurement,
            `Subgroup ${index + 1} measurement ${measurementIndex + 1}`,
          ),
      );
      if (subgroup.id !== undefined) {
        const id = nonEmptyLabel(subgroup.id, `Subgroup ${index + 1} id`);
        if (ids.has(id))
          throw new RangeError(`Duplicate stability subgroup id: "${id}".`);
        ids.add(id);
      }
      const timestamp = nonEmptyLabel(
        subgroup.timestamp,
        `Subgroup ${index + 1} timestamp`,
      );
      const epoch = Date.parse(timestamp);
      if (!Number.isFinite(epoch)) {
        throw new RangeError(
          `Subgroup ${index + 1} timestamp must be a valid date and time.`,
        );
      }
      if (epoch <= previousTimestamp) {
        throw new RangeError(
          'Stability subgroups must be in strictly increasing chronological order.',
        );
      }
      previousTimestamp = epoch;
      return {
        subgroupIndex: index,
        id: subgroup.id?.trim(),
        timestamp,
        mean: average(subgroup.measurements),
        range: range(subgroup.measurements),
        xbarBeyondControlLimits: false,
        rangeBeyondControlLimits: false,
      } satisfies StabilitySubgroupResult;
    },
  );

  const xbarCenter = average(calculated.map(({ mean }) => mean));
  const rangeCenter = average(calculated.map((subgroup) => subgroup.range));
  const xbarLimits = {
    lower: xbarCenter - constants.a2 * rangeCenter,
    upper: xbarCenter + constants.a2 * rangeCenter,
  };
  const rangeLimits = {
    lower: constants.d3 * rangeCenter,
    upper: constants.d4 * rangeCenter,
  };
  const signals: StabilitySignal[] = [];

  for (const subgroup of calculated) {
    subgroup.xbarBeyondControlLimits =
      subgroup.mean < xbarLimits.lower || subgroup.mean > xbarLimits.upper;
    subgroup.rangeBeyondControlLimits =
      subgroup.range < rangeLimits.lower || subgroup.range > rangeLimits.upper;
    if (subgroup.xbarBeyondControlLimits) {
      addStabilitySignal(
        signals,
        subgroup,
        'xbar',
        'xbar-beyond-control-limit',
        `Subgroup mean ${subgroup.mean} is outside Xbar limits [${xbarLimits.lower}, ${xbarLimits.upper}].`,
      );
    }
    if (subgroup.rangeBeyondControlLimits) {
      addStabilitySignal(
        signals,
        subgroup,
        'range',
        'range-beyond-control-limit',
        `Subgroup range ${subgroup.range} is outside R limits [${rangeLimits.lower}, ${rangeLimits.upper}].`,
      );
    }
  }

  let side = 0;
  let sameSideCount = 0;
  for (const subgroup of calculated) {
    const currentSide =
      subgroup.mean > xbarCenter ? 1 : subgroup.mean < xbarCenter ? -1 : 0;
    if (currentSide !== 0 && currentSide === side) {
      sameSideCount += 1;
    } else {
      side = currentSide;
      sameSideCount = currentSide === 0 ? 0 : 1;
    }
    if (sameSideCount === 8) {
      addStabilitySignal(
        signals,
        subgroup,
        'xbar',
        'xbar-eight-on-one-side',
        'Eight consecutive subgroup means are on the same side of the Xbar center line.',
      );
    }
  }

  let trendDirection = 0;
  let trendLength = 1;
  for (let index = 1; index < calculated.length; index += 1) {
    const difference = calculated[index].mean - calculated[index - 1].mean;
    const direction = difference > 0 ? 1 : difference < 0 ? -1 : 0;
    if (direction !== 0 && direction === trendDirection) {
      trendLength += 1;
    } else {
      trendDirection = direction;
      trendLength = direction === 0 ? 1 : 2;
    }
    if (trendLength === 6) {
      addStabilitySignal(
        signals,
        calculated[index],
        'xbar',
        'xbar-six-point-trend',
        'Six consecutive subgroup means form a strictly monotonic trend.',
      );
    }
  }

  const warnings: string[] = [];
  if (subgroups.length < 20) {
    warnings.push(
      'Fewer than twenty baseline subgroups were used; treat the estimated control limits as preliminary.',
    );
  }
  if (signals.some(({ chart }) => chart === 'range')) {
    warnings.push(
      'The R chart has an out-of-control signal; establish within-subgroup consistency before interpreting the Xbar chart.',
    );
  }
  if (signals.length > 0) {
    warnings.push(
      'Special-cause signals are screening indicators and require investigation, not automatic data removal.',
    );
  }

  return {
    subgroupSize,
    subgroupCount: subgroups.length,
    constants,
    centerLines: { xbar: xbarCenter, range: rangeCenter },
    controlLimits: { xbar: xbarLimits, range: rangeLimits },
    subgroups: calculated,
    signals,
    outOfControl: signals.length > 0,
    warnings,
    assumptions: [
      'Each subgroup is a rational subgroup collected under comparable short-term conditions.',
      'Subgroups are independent, chronologically ordered, and have a constant sample size.',
      'Classical Xbar/R constants assume approximately normal, stable within-subgroup variation.',
      'Control limits are estimated from these data; a stable baseline should be confirmed before limits are frozen.',
      'The R chart should be brought into control before the Xbar chart is used to judge location stability.',
    ],
  };
}
