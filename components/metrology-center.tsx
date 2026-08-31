'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Calculator,
  CheckCircle2,
  FlaskConical,
  Plus,
  Save,
  Scale,
  TrendingUp,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  analyzeBias,
  analyzeLinearity,
  analyzeStability,
  calculateCrossedGrr,
  calculateUncertaintyBudget,
  evaluateDecisionRule,
  type CrossedGrrResult,
  type BiasAnalysisResult,
  type DecisionRuleKind,
  type DecisionRuleResult,
  type GrrObservation,
  type LinearityAnalysisResult,
  type LinearityObservation,
  type StabilityAnalysisResult,
  type StabilitySubgroup,
  type UncertaintyBudgetResult,
  type UncertaintyContributor,
  type UncertaintyDistribution,
} from '@/lib/metrology';
import {
  isoNow,
  uid,
  type GaugeRecord,
  type TechnicalStudyRecord,
} from '@/lib/model';

type Notice = { tone: 'good' | 'danger'; text: string };

function numberOrUndefined(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`“${value}” is not a number.`);
  return parsed;
}

function requiredNumber(value: string, label: string) {
  const parsed = numberOrUndefined(value);
  if (parsed === undefined) throw new Error(`${label} is required.`);
  return parsed;
}

function fixed(value: number | null | undefined, digits = 4) {
  if (value == null) return '—';
  if (!Number.isFinite(value)) return '∞';
  return value.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function emptyContributor(name = ''): UncertaintyContributor {
  return {
    id: uid('uc'),
    name,
    uncertainty: 0,
    distribution: 'normal',
    sensitivityCoefficient: 1,
  };
}

const DEFAULT_OBSERVATIONS = `part,appraiser,trial,value
P1,A,1,9.98
P1,A,2,10.02
P1,B,1,10.01
P1,B,2,10.04
P2,A,1,19.97
P2,A,2,20.03
P2,B,1,20.02
P2,B,2,20.05
P3,A,1,29.96
P3,A,2,30.04
P3,B,1,30.01
P3,B,2,30.06`;

const DEFAULT_LINEARITY = `reference,measured
0,0.002
0,-0.001
25,25.003
25,25.001
50,50.004
50,50.006
75,75.008
75,75.006
100,100.010
100,100.012`;

const DEFAULT_STABILITY = `timestamp,m1,m2,m3
2026-08-01,10.001,10.003,10.002
2026-08-08,10.002,10.004,10.003
2026-08-15,10.000,10.003,10.002
2026-08-22,10.003,10.005,10.004
2026-08-29,10.002,10.004,10.003
2026-09-05,10.001,10.004,10.002
2026-09-12,10.002,10.005,10.003
2026-09-19,10.001,10.003,10.002`;

function parseObservations(text: string): GrrObservation[] {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  if (rows.length < 2) throw new Error('Paste a header and observation rows.');
  const header = rows[0].map((item) => item.toLowerCase());
  const required = ['part', 'appraiser', 'trial', 'value'];
  if (!required.every((name) => header.includes(name)))
    throw new Error(
      'The header must contain part, appraiser, trial, and value.',
    );
  return rows.slice(1).map((row, index) => {
    const pick = (name: string) => row[header.indexOf(name)] ?? '';
    const value = Number(pick('value'));
    if (!pick('part') || !pick('appraiser') || !pick('trial'))
      throw new Error(`Observation row ${index + 2} is incomplete.`);
    if (!Number.isFinite(value))
      throw new Error(`Observation row ${index + 2} has an invalid value.`);
    return {
      part: pick('part'),
      appraiser: pick('appraiser'),
      trial: pick('trial'),
      value,
    };
  });
}

function parseNumberSeries(text: string) {
  const values = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (values.some((value) => !Number.isFinite(value)))
    throw new Error('Measurement series contains a non-numeric value.');
  return values;
}

function parseLinearityObservations(text: string): LinearityObservation[] {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  const firstRow = rows[0] ?? [];
  const firstHeader = firstRow[0]?.toLowerCase().replace(/[_-]+/g, ' ');
  const secondHeader = firstRow[1]?.toLowerCase().replace(/[_-]+/g, ' ');
  const hasHeader =
    ['reference', 'reference value', 'accepted value'].includes(firstHeader) &&
    ['measured', 'measured value', 'measurement'].includes(secondHeader);
  const data = hasHeader ? rows.slice(1) : rows;
  const rowOffset = hasHeader ? 2 : 1;
  return data
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      if (!row[0] || !row[1])
        throw new Error(
          `Linearity row ${index + rowOffset} has a blank reference or measured value.`,
        );
      const referenceValue = Number(row[0]);
      const measuredValue = Number(row[1]);
      if (!Number.isFinite(referenceValue) || !Number.isFinite(measuredValue))
        throw new Error(
          `Linearity row ${index + rowOffset} needs numeric reference and measured values.`,
        );
      return { id: `linearity-${index + 1}`, referenceValue, measuredValue };
    });
}

function parseStabilitySubgroups(text: string): StabilitySubgroup[] {
  const rows = text
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim()));
  const firstHeader = rows[0]?.[0]?.toLowerCase().replace(/[_-]+/g, ' ');
  const hasHeader = ['timestamp', 'date', 'date time', 'time'].includes(
    firstHeader,
  );
  const data = hasHeader ? rows.slice(1) : rows;
  const rowOffset = hasHeader ? 2 : 1;
  return data
    .filter((row) => row.some(Boolean))
    .map((row, index) => {
      if (row.slice(1).some((cell) => !cell))
        throw new Error(
          `Stability row ${index + rowOffset} contains a blank reading.`,
        );
      const measurements = row.slice(1).map(Number);
      if (
        !row[0] ||
        !Number.isFinite(Date.parse(row[0])) ||
        measurements.length < 2 ||
        measurements.some((value) => !Number.isFinite(value))
      )
        throw new Error(
          `Stability row ${index + rowOffset} needs a valid timestamp and at least two numeric readings.`,
        );
      return { id: `subgroup-${index + 1}`, timestamp: row[0], measurements };
    });
}

function formatStudyTimestamp(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toLocaleString();
}

function stabilitySignalLabel(rule: string) {
  if (rule === 'xbar-beyond-control-limit') return 'Xbar limit';
  if (rule === 'range-beyond-control-limit') return 'R limit';
  if (rule === 'xbar-eight-on-one-side') return '8 one side';
  if (rule === 'xbar-six-point-trend') return '6 trend';
  return rule;
}

export function MetrologyCenter({
  gauges,
  studies,
  actor,
  saveStatus = 'reviewed',
  onSaveStudy,
}: {
  gauges: GaugeRecord[];
  studies: TechnicalStudyRecord[];
  actor: string;
  saveStatus?: 'draft' | 'reviewed';
  onSaveStudy: (study: TechnicalStudyRecord) => void;
}) {
  const [mode, setMode] = useState<
    'uncertainty' | 'grr' | 'bias-linearity' | 'stability'
  >('uncertainty');
  const [notice, setNotice] = useState<Notice>();
  const [title, setTitle] = useState('Dimensional calibration budget');
  const [gaugeId, setGaugeId] = useState('');
  const [unit, setUnit] = useState('mm');
  const [coverageFactor, setCoverageFactor] = useState('2');
  const [contributors, setContributors] = useState<UncertaintyContributor[]>([
    {
      id: uid('uc'),
      name: 'Reference certificate',
      uncertainty: 0.004,
      distribution: 'normal',
      divisor: 2,
      sensitivityCoefficient: 1,
    },
    {
      id: uid('uc'),
      name: 'Resolution',
      uncertainty: 0.001,
      distribution: 'rectangular',
      sensitivityCoefficient: 1,
    },
    {
      id: uid('uc'),
      name: 'Repeatability',
      uncertainty: 0.0015,
      distribution: 'normal',
      sensitivityCoefficient: 1,
      degreesOfFreedom: 9,
    },
  ]);
  const [measuredValue, setMeasuredValue] = useState('10.002');
  const [lowerLimit, setLowerLimit] = useState('9.99');
  const [upperLimit, setUpperLimit] = useState('10.01');
  const [decisionRule, setDecisionRule] =
    useState<DecisionRuleKind>('uncertainty-aware');
  const [guardBand, setGuardBand] = useState('0.002');
  const [budgetResult, setBudgetResult] = useState<UncertaintyBudgetResult>();
  const [decisionResult, setDecisionResult] = useState<DecisionRuleResult>();

  const [grrTitle, setGrrTitle] = useState('Digital micrometer crossed R&R');
  const [grrGaugeId, setGrrGaugeId] = useState('');
  const [observations, setObservations] = useState(DEFAULT_OBSERVATIONS);
  const [grrLower, setGrrLower] = useState('0');
  const [grrUpper, setGrrUpper] = useState('40');
  const [grrResult, setGrrResult] = useState<CrossedGrrResult>();
  const [biasTitle, setBiasTitle] = useState('Reference point bias study');
  const [biasGaugeId, setBiasGaugeId] = useState('');
  const [biasReference, setBiasReference] = useState('10');
  const [biasMeasurements, setBiasMeasurements] = useState(
    '10.002, 10.001, 10.003, 10.002, 10.004, 10.001',
  );
  const [biasResult, setBiasResult] = useState<BiasAnalysisResult>();
  const [linearityTitle, setLinearityTitle] = useState(
    'Full-range linearity study',
  );
  const [linearityGaugeId, setLinearityGaugeId] = useState('');
  const [linearityData, setLinearityData] = useState(DEFAULT_LINEARITY);
  const [linearityResult, setLinearityResult] =
    useState<LinearityAnalysisResult>();
  const [stabilityTitle, setStabilityTitle] = useState(
    'Weekly reference check stability',
  );
  const [stabilityGaugeId, setStabilityGaugeId] = useState('');
  const [stabilityData, setStabilityData] = useState(DEFAULT_STABILITY);
  const [stabilityResult, setStabilityResult] =
    useState<StabilityAnalysisResult>();

  const recent = useMemo(
    () => [...studies].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [studies],
  );

  const updateContributor = (
    index: number,
    patch: Partial<UncertaintyContributor>,
  ) =>
    setContributors((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );

  const calculateBudget = () => {
    try {
      const result = calculateUncertaintyBudget(contributors, {
        coverageFactor: Number(coverageFactor),
      });
      const measured = Number(measuredValue);
      const lower = numberOrUndefined(lowerLimit);
      const upper = numberOrUndefined(upperLimit);
      let decision: DecisionRuleResult;
      if (decisionRule === 'guard-banded') {
        decision = evaluateDecisionRule({
          rule: decisionRule,
          measuredValue: measured,
          lowerLimit: lower,
          upperLimit: upper,
          guardBand: Number(guardBand),
        });
      } else if (decisionRule === 'uncertainty-aware') {
        decision = evaluateDecisionRule({
          rule: decisionRule,
          measuredValue: measured,
          lowerLimit: lower,
          upperLimit: upper,
          expandedUncertainty: result.expandedUncertainty,
        });
      } else {
        decision = evaluateDecisionRule({
          rule: decisionRule,
          measuredValue: measured,
          lowerLimit: lower,
          upperLimit: upper,
        });
      }
      setBudgetResult(result);
      setDecisionResult(decision);
      setNotice({
        tone: 'good',
        text: 'Budget and decision rule recalculated.',
      });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Calculation failed.',
      });
    }
  };

  const saveBudget = () => {
    if (!budgetResult || !decisionResult) return calculateBudget();
    const now = isoNow();
    onSaveStudy({
      id: uid('study'),
      kind: 'uncertainty-budget',
      title,
      gaugeId: gaugeId || undefined,
      status: saveStatus,
      input: {
        unit,
        coverageFactor: Number(coverageFactor),
        contributors,
        decision: {
          measuredValue: Number(measuredValue),
          lowerLimit: numberOrUndefined(lowerLimit),
          upperLimit: numberOrUndefined(upperLimit),
          rule: decisionRule,
          guardBand:
            decisionRule === 'guard-banded' ? Number(guardBand) : undefined,
        },
      },
      result: { budget: budgetResult, decision: decisionResult },
      createdBy: actor,
      reviewedBy: saveStatus === 'reviewed' ? actor : undefined,
      createdAt: now,
      updatedAt: now,
    });
    setNotice({
      tone: 'good',
      text: `${saveStatus === 'reviewed' ? 'Reviewed' : 'Draft'} uncertainty study saved.`,
    });
  };

  const calculateGrr = () => {
    try {
      const result = calculateCrossedGrr(parseObservations(observations), {
        lowerSpecificationLimit: numberOrUndefined(grrLower),
        upperSpecificationLimit: numberOrUndefined(grrUpper),
      });
      setGrrResult(result);
      setNotice({ tone: 'good', text: 'Balanced crossed R&R calculated.' });
    } catch (error) {
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Calculation failed.',
      });
    }
  };

  const saveGrr = () => {
    if (!grrResult) return calculateGrr();
    const now = isoNow();
    onSaveStudy({
      id: uid('study'),
      kind: 'gage-rr',
      title: grrTitle,
      gaugeId: grrGaugeId || undefined,
      status: saveStatus,
      input: {
        observations: parseObservations(observations),
        lowerSpecificationLimit: numberOrUndefined(grrLower),
        upperSpecificationLimit: numberOrUndefined(grrUpper),
      },
      result: grrResult,
      createdBy: actor,
      reviewedBy: saveStatus === 'reviewed' ? actor : undefined,
      createdAt: now,
      updatedAt: now,
    });
    setNotice({
      tone: 'good',
      text: `${saveStatus === 'reviewed' ? 'Reviewed' : 'Draft'} Gage R&R study saved.`,
    });
  };

  const saveMsaStudy = (
    kind: 'bias' | 'linearity' | 'stability',
    studyTitle: string,
    linkedGaugeId: string,
    input: unknown,
    result: unknown,
  ) => {
    const now = isoNow();
    onSaveStudy({
      id: uid('study'),
      kind,
      title: studyTitle,
      gaugeId: linkedGaugeId || undefined,
      status: saveStatus,
      input,
      result,
      createdBy: actor,
      reviewedBy: saveStatus === 'reviewed' ? actor : undefined,
      createdAt: now,
      updatedAt: now,
    });
    setNotice({
      tone: 'good',
      text: `${saveStatus === 'reviewed' ? 'Reviewed' : 'Draft'} ${kind} study saved.`,
    });
  };

  const calculateBias = () => {
    try {
      const measurements = parseNumberSeries(biasMeasurements);
      const referenceValue = requiredNumber(
        biasReference,
        'Accepted reference value',
      );
      const result = analyzeBias(measurements, referenceValue);
      setBiasResult(result);
      setNotice({ tone: 'good', text: 'Bias study recalculated.' });
    } catch (error) {
      setBiasResult(undefined);
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Bias analysis failed.',
      });
    }
  };

  const calculateLinearity = () => {
    try {
      const result = analyzeLinearity(
        parseLinearityObservations(linearityData),
      );
      setLinearityResult(result);
      setNotice({ tone: 'good', text: 'Linearity model recalculated.' });
    } catch (error) {
      setLinearityResult(undefined);
      setNotice({
        tone: 'danger',
        text:
          error instanceof Error ? error.message : 'Linearity analysis failed.',
      });
    }
  };

  const calculateStability = () => {
    try {
      const result = analyzeStability(parseStabilitySubgroups(stabilityData));
      setStabilityResult(result);
      setNotice({ tone: 'good', text: 'Xbar/R stability study recalculated.' });
    } catch (error) {
      setStabilityResult(undefined);
      setNotice({
        tone: 'danger',
        text:
          error instanceof Error ? error.message : 'Stability analysis failed.',
      });
    }
  };

  const saveBias = () => {
    if (!biasResult) return;
    try {
      saveMsaStudy(
        'bias',
        biasTitle,
        biasGaugeId,
        {
          referenceValue: requiredNumber(
            biasReference,
            'Accepted reference value',
          ),
          measurements: parseNumberSeries(biasMeasurements),
        },
        biasResult,
      );
    } catch (error) {
      setBiasResult(undefined);
      setNotice({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Bias study is invalid.',
      });
    }
  };

  const saveLinearity = () => {
    if (!linearityResult) return;
    try {
      saveMsaStudy(
        'linearity',
        linearityTitle,
        linearityGaugeId,
        { observations: parseLinearityObservations(linearityData) },
        linearityResult,
      );
    } catch (error) {
      setLinearityResult(undefined);
      setNotice({
        tone: 'danger',
        text:
          error instanceof Error
            ? error.message
            : 'Linearity study is invalid.',
      });
    }
  };

  const saveStability = () => {
    if (!stabilityResult) return;
    try {
      saveMsaStudy(
        'stability',
        stabilityTitle,
        stabilityGaugeId,
        { subgroups: parseStabilitySubgroups(stabilityData) },
        stabilityResult,
      );
    } catch (error) {
      setStabilityResult(undefined);
      setNotice({
        tone: 'danger',
        text:
          error instanceof Error
            ? error.message
            : 'Stability study is invalid.',
      });
    }
  };

  return (
    <div className="metrology-center">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Technical metrology</p>
          <h1>Metrology lab</h1>
          <p>
            Build transparent uncertainty budgets, apply explicit conformity
            decision rules, and evaluate bias, linearity, stability, and crossed
            measurement-system studies.
          </p>
        </div>
        <div className="view-actions segmented-control">
          <Button
            variant={mode === 'uncertainty' ? 'default' : 'outline'}
            onClick={() => setMode('uncertainty')}
          >
            <FlaskConical /> Uncertainty
          </Button>
          <Button
            variant={mode === 'grr' ? 'default' : 'outline'}
            onClick={() => setMode('grr')}
          >
            <BarChart3 /> Gage R&amp;R
          </Button>
          <Button
            variant={mode === 'bias-linearity' ? 'default' : 'outline'}
            onClick={() => setMode('bias-linearity')}
          >
            <TrendingUp /> Bias &amp; linearity
          </Button>
          <Button
            variant={mode === 'stability' ? 'default' : 'outline'}
            onClick={() => setMode('stability')}
          >
            <Activity /> Stability
          </Button>
        </div>
      </div>

      {notice && (
        <div className={`calc-notice ${notice.tone}`}>
          {notice.tone === 'good' ? <CheckCircle2 /> : <AlertTriangle />}
          {notice.text}
        </div>
      )}

      {mode === 'uncertainty' ? (
        <div className="metrology-grid">
          <section className="panel calc-builder">
            <div className="section-heading">
              <div>
                <h2>Uncertainty budget</h2>
                <p>GUM-style independent contributor model.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setContributors((current) => [
                    ...current,
                    emptyContributor('New contributor'),
                  ])
                }
              >
                <Plus /> Add contributor
              </Button>
            </div>
            <div className="calc-meta-grid">
              <label>
                <span>Study title</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Linked gauge</span>
                <select
                  value={gaugeId}
                  onChange={(event) => setGaugeId(event.target.value)}
                >
                  <option value="">General method</option>
                  {gauges.map((gauge) => (
                    <option key={gauge.id} value={gauge.id}>
                      {gauge.assetId} · {gauge.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Output unit</span>
                <Input
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </label>
              <label>
                <span>Coverage factor k</span>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={coverageFactor}
                  onChange={(event) => setCoverageFactor(event.target.value)}
                />
              </label>
            </div>
            <div className="contributor-table">
              <div className="contributor-head">
                <span>Source</span>
                <span>Quoted u</span>
                <span>Distribution</span>
                <span>Divisor</span>
                <span>Sensitivity</span>
                <span>ν</span>
                <span />
              </div>
              {contributors.map((item, index) => (
                <div className="contributor-row" key={item.id ?? index}>
                  <Input
                    value={item.name}
                    aria-label={`Contributor ${index + 1} name`}
                    onChange={(event) =>
                      updateContributor(index, { name: event.target.value })
                    }
                  />
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={item.uncertainty}
                    aria-label={`Contributor ${index + 1} uncertainty`}
                    onChange={(event) =>
                      updateContributor(index, {
                        uncertainty: Number(event.target.value),
                      })
                    }
                  />
                  <select
                    value={item.distribution}
                    aria-label={`Contributor ${index + 1} distribution`}
                    onChange={(event) =>
                      updateContributor(index, {
                        distribution: event.target
                          .value as UncertaintyDistribution,
                      })
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="rectangular">Rectangular</option>
                    <option value="triangular">Triangular</option>
                    <option value="u-shaped">U-shaped</option>
                  </select>
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="Auto"
                    value={item.divisor ?? ''}
                    aria-label={`Contributor ${index + 1} divisor`}
                    onChange={(event) =>
                      updateContributor(index, {
                        divisor: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                  <Input
                    type="number"
                    step="any"
                    value={item.sensitivityCoefficient ?? 1}
                    aria-label={`Contributor ${index + 1} sensitivity`}
                    onChange={(event) =>
                      updateContributor(index, {
                        sensitivityCoefficient: Number(event.target.value),
                      })
                    }
                  />
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    placeholder="∞"
                    value={item.degreesOfFreedom ?? ''}
                    aria-label={`Contributor ${index + 1} degrees of freedom`}
                    onChange={(event) =>
                      updateContributor(index, {
                        degreesOfFreedom: event.target.value
                          ? Number(event.target.value)
                          : undefined,
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove contributor ${index + 1}`}
                    disabled={contributors.length === 1}
                    onClick={() =>
                      setContributors((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
            <div className="decision-builder">
              <div>
                <h3>Conformity decision</h3>
                <p>
                  The chosen rule and its risk treatment are stored with the
                  study.
                </p>
              </div>
              <div className="calc-meta-grid five">
                <label>
                  <span>Measured value</span>
                  <Input
                    type="number"
                    step="any"
                    value={measuredValue}
                    onChange={(event) => setMeasuredValue(event.target.value)}
                  />
                </label>
                <label>
                  <span>Lower limit</span>
                  <Input
                    type="number"
                    step="any"
                    value={lowerLimit}
                    onChange={(event) => setLowerLimit(event.target.value)}
                  />
                </label>
                <label>
                  <span>Upper limit</span>
                  <Input
                    type="number"
                    step="any"
                    value={upperLimit}
                    onChange={(event) => setUpperLimit(event.target.value)}
                  />
                </label>
                <label>
                  <span>Decision rule</span>
                  <select
                    value={decisionRule}
                    onChange={(event) =>
                      setDecisionRule(event.target.value as DecisionRuleKind)
                    }
                  >
                    <option value="simple-acceptance">Simple acceptance</option>
                    <option value="guard-banded">Guard-banded</option>
                    <option value="uncertainty-aware">Uncertainty-aware</option>
                  </select>
                </label>
                {decisionRule === 'guard-banded' && (
                  <label>
                    <span>Guard band</span>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={guardBand}
                      onChange={(event) => setGuardBand(event.target.value)}
                    />
                  </label>
                )}
              </div>
            </div>
            <div className="calc-actions">
              <Button size="lg" onClick={calculateBudget}>
                <Calculator /> Calculate
              </Button>
              <Button size="lg" variant="outline" onClick={saveBudget}>
                <Save /> Save {saveStatus} study
              </Button>
            </div>
          </section>

          <section className="panel calc-results">
            <div className="section-heading">
              <div>
                <h2>Technical result</h2>
                <p>Unrounded values are preserved in the record.</p>
              </div>
            </div>
            {!budgetResult || !decisionResult ? (
              <div className="calc-empty">
                <Calculator />
                <strong>Ready to calculate</strong>
                <p>Enter the budget and explicit decision rule.</p>
              </div>
            ) : (
              <>
                <div className="result-metrics">
                  <div>
                    <span>Combined standard u</span>
                    <strong>
                      {fixed(budgetResult.combinedStandardUncertainty)} {unit}
                    </strong>
                  </div>
                  <div>
                    <span>Expanded U</span>
                    <strong>
                      {fixed(budgetResult.expandedUncertainty)} {unit}
                    </strong>
                  </div>
                  <div>
                    <span>Coverage factor</span>
                    <strong>k = {fixed(budgetResult.coverageFactor, 3)}</strong>
                  </div>
                  <div>
                    <span>Effective ν</span>
                    <strong>
                      {fixed(budgetResult.effectiveDegreesOfFreedom, 1)}
                    </strong>
                  </div>
                </div>
                <div className={`decision-result ${decisionResult.outcome}`}>
                  <span>{decisionResult.outcome}</span>
                  <strong>{decisionResult.explanation}</strong>
                  <p>
                    Margin to nearest specification limit:{' '}
                    {fixed(decisionResult.marginToNearestSpecificationLimit)}{' '}
                    {unit}
                  </p>
                </div>
                <div className="budget-bars">
                  {budgetResult.contributors.map((contributor) => (
                    <div key={contributor.id ?? contributor.name}>
                      <span>
                        <b>{contributor.name}</b>
                        <em>
                          {fixed(contributor.percentVarianceContribution, 1)}%
                        </em>
                      </span>
                      <i>
                        <u
                          style={{
                            width: `${Math.min(100, contributor.percentVarianceContribution)}%`,
                          }}
                        />
                      </i>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      ) : mode === 'grr' ? (
        <div className="metrology-grid">
          <section className="panel calc-builder">
            <div className="section-heading">
              <div>
                <h2>Crossed Gage R&amp;R</h2>
                <p>
                  Balanced average-and-range study with transparent assumptions.
                </p>
              </div>
            </div>
            <div className="calc-meta-grid">
              <label>
                <span>Study title</span>
                <Input
                  value={grrTitle}
                  onChange={(event) => setGrrTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Linked gauge</span>
                <select
                  value={grrGaugeId}
                  onChange={(event) => setGrrGaugeId(event.target.value)}
                >
                  <option value="">General method</option>
                  {gauges.map((gauge) => (
                    <option key={gauge.id} value={gauge.id}>
                      {gauge.assetId} · {gauge.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Lower specification</span>
                <Input
                  type="number"
                  step="any"
                  value={grrLower}
                  onChange={(event) => setGrrLower(event.target.value)}
                />
              </label>
              <label>
                <span>Upper specification</span>
                <Input
                  type="number"
                  step="any"
                  value={grrUpper}
                  onChange={(event) => setGrrUpper(event.target.value)}
                />
              </label>
            </div>
            <label className="observation-input">
              <span>Observations (CSV)</span>
              <Textarea
                value={observations}
                onChange={(event) => setObservations(event.target.value)}
                rows={16}
                spellCheck={false}
              />
            </label>
            <div className="calc-actions">
              <Button size="lg" onClick={calculateGrr}>
                <Calculator /> Calculate study
              </Button>
              <Button size="lg" variant="outline" onClick={saveGrr}>
                <Save /> Save {saveStatus} study
              </Button>
            </div>
          </section>
          <section className="panel calc-results">
            <div className="section-heading">
              <div>
                <h2>Measurement-system result</h2>
                <p>
                  Common screening thresholds are advisory, not automatic
                  approval.
                </p>
              </div>
            </div>
            {!grrResult ? (
              <div className="calc-empty">
                <BarChart3 />
                <strong>Ready to calculate</strong>
                <p>Paste a complete balanced crossed study.</p>
              </div>
            ) : (
              <>
                <div className={`decision-result ${grrResult.classification}`}>
                  <span>{grrResult.classification}</span>
                  <strong>{grrResult.summary}</strong>
                  <p>
                    {grrResult.design.partCount} parts ·{' '}
                    {grrResult.design.appraiserCount} appraisers ·{' '}
                    {grrResult.design.trialsPerCell} trials
                  </p>
                </div>
                <div className="result-metrics">
                  <div>
                    <span>Gage R&amp;R</span>
                    <strong>
                      {fixed(
                        grrResult.components.gaugeRr.percentStudyVariation,
                        1,
                      )}
                      %
                    </strong>
                  </div>
                  <div>
                    <span>Repeatability</span>
                    <strong>
                      {fixed(
                        grrResult.components.repeatability
                          .percentStudyVariation,
                        1,
                      )}
                      %
                    </strong>
                  </div>
                  <div>
                    <span>Reproducibility</span>
                    <strong>
                      {fixed(
                        grrResult.components.reproducibility
                          .percentStudyVariation,
                        1,
                      )}
                      %
                    </strong>
                  </div>
                  <div>
                    <span>Distinct categories</span>
                    <strong>
                      {fixed(grrResult.numberOfDistinctCategories, 0)}
                    </strong>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Component</TableHead>
                      <TableHead>Std. deviation</TableHead>
                      <TableHead>% study</TableHead>
                      <TableHead>% contribution</TableHead>
                      <TableHead>% tolerance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(grrResult.components).map(
                      ([name, component]) => (
                        <TableRow key={name}>
                          <TableCell>{name}</TableCell>
                          <TableCell>
                            {fixed(component.standardDeviation)}
                          </TableCell>
                          <TableCell>
                            {fixed(component.percentStudyVariation, 1)}
                          </TableCell>
                          <TableCell>
                            {fixed(component.percentContribution, 1)}
                          </TableCell>
                          <TableCell>
                            {fixed(component.percentTolerance, 1)}
                          </TableCell>
                        </TableRow>
                      ),
                    )}
                  </TableBody>
                </Table>
                {grrResult.warnings.length > 0 && (
                  <div className="study-warnings">
                    {grrResult.warnings.map((warning) => (
                      <p key={warning}>
                        <AlertTriangle />
                        {warning}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      ) : mode === 'bias-linearity' ? (
        <div className="metrology-grid msa-grid">
          <section className="panel calc-builder">
            <div className="section-heading">
              <div>
                <h2>Reference point bias</h2>
                <p>
                  Repeated-measurement t interval against one accepted value.
                </p>
              </div>
            </div>
            <div className="calc-meta-grid">
              <label>
                <span>Study title</span>
                <Input
                  value={biasTitle}
                  onChange={(event) => setBiasTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Linked gauge</span>
                <select
                  value={biasGaugeId}
                  onChange={(event) => setBiasGaugeId(event.target.value)}
                >
                  <option value="">General method</option>
                  {gauges.map((gauge) => (
                    <option key={gauge.id} value={gauge.id}>
                      {gauge.assetId} · {gauge.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Accepted reference value</span>
                <Input
                  type="number"
                  step="any"
                  value={biasReference}
                  onChange={(event) => {
                    setBiasReference(event.target.value);
                    setBiasResult(undefined);
                  }}
                />
              </label>
            </div>
            <label className="observation-input">
              <span>
                Repeated measurements (comma, space, or line separated)
              </span>
              <Textarea
                value={biasMeasurements}
                onChange={(event) => {
                  setBiasMeasurements(event.target.value);
                  setBiasResult(undefined);
                }}
                rows={6}
                spellCheck={false}
              />
            </label>
            <div className="calc-actions">
              <Button onClick={calculateBias}>
                <Calculator /> Calculate bias
              </Button>
              <Button
                variant="outline"
                disabled={!biasResult}
                onClick={saveBias}
              >
                <Save /> Save {saveStatus}
              </Button>
            </div>
            {biasResult && (
              <div className="msa-result-block">
                <div
                  className={`decision-result ${biasResult.statisticallySignificantAt95Percent ? 'unacceptable' : 'indeterminate'}`}
                >
                  <span>
                    {biasResult.statisticallySignificantAt95Percent
                      ? 'significant bias'
                      : 'not detected'}
                  </span>
                  <strong>
                    Mean bias {fixed(biasResult.meanBias)}; 95% CI{' '}
                    {fixed(biasResult.confidenceInterval95.lower)} to{' '}
                    {fixed(biasResult.confidenceInterval95.upper)}
                  </strong>
                  <p>
                    n = {biasResult.measurementCount} · t ={' '}
                    {fixed(biasResult.tStatistic, 3)} · df ={' '}
                    {biasResult.degreesOfFreedom}
                  </p>
                </div>
                <div className="result-metrics">
                  <div>
                    <span>Mean measurement</span>
                    <strong>{fixed(biasResult.meanMeasurement)}</strong>
                  </div>
                  <div>
                    <span>Sample s</span>
                    <strong>{fixed(biasResult.sampleStandardDeviation)}</strong>
                  </div>
                  <div>
                    <span>Standard error</span>
                    <strong>{fixed(biasResult.standardError)}</strong>
                  </div>
                  <div>
                    <span>% reference bias</span>
                    <strong>
                      {fixed(biasResult.percentBiasOfReference, 3)}%
                    </strong>
                  </div>
                </div>
                <div className="study-warnings">
                  {biasResult.warnings.map((warning) => (
                    <p key={warning}>
                      <AlertTriangle />
                      {warning}
                    </p>
                  ))}
                </div>
                <details className="study-assumptions">
                  <summary>Statistical assumptions</summary>
                  <ul>
                    {biasResult.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </section>

          <section className="panel calc-builder">
            <div className="section-heading">
              <div>
                <h2>Linearity across range</h2>
                <p>
                  OLS regression of individual bias on accepted reference value.
                </p>
              </div>
            </div>
            <div className="calc-meta-grid">
              <label>
                <span>Study title</span>
                <Input
                  value={linearityTitle}
                  onChange={(event) => setLinearityTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Linked gauge</span>
                <select
                  value={linearityGaugeId}
                  onChange={(event) => setLinearityGaugeId(event.target.value)}
                >
                  <option value="">General method</option>
                  {gauges.map((gauge) => (
                    <option key={gauge.id} value={gauge.id}>
                      {gauge.assetId} · {gauge.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="observation-input">
              <span>Observations (reference, measured CSV)</span>
              <Textarea
                value={linearityData}
                onChange={(event) => {
                  setLinearityData(event.target.value);
                  setLinearityResult(undefined);
                }}
                rows={11}
                spellCheck={false}
              />
            </label>
            <div className="calc-actions">
              <Button onClick={calculateLinearity}>
                <Calculator /> Calculate linearity
              </Button>
              <Button
                variant="outline"
                disabled={!linearityResult}
                onClick={saveLinearity}
              >
                <Save /> Save {saveStatus}
              </Button>
            </div>
            {linearityResult && (
              <div className="msa-result-block">
                <div
                  className={`decision-result ${linearityResult.statisticallySignificantSlopeAt95Percent ? 'unacceptable' : 'indeterminate'}`}
                >
                  <span>
                    {linearityResult.statisticallySignificantSlopeAt95Percent
                      ? 'range effect detected'
                      : 'slope not detected'}
                  </span>
                  <strong>
                    Bias = {fixed(linearityResult.intercept)} +{' '}
                    {fixed(linearityResult.slope)} × reference
                  </strong>
                  <p>
                    95% slope CI{' '}
                    {fixed(linearityResult.slopeConfidenceInterval95.lower)} to{' '}
                    {fixed(linearityResult.slopeConfidenceInterval95.upper)} ·
                    R² {fixed(linearityResult.rSquared, 4)}
                  </p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>n</TableHead>
                      <TableHead>Observed mean bias</TableHead>
                      <TableHead>Fitted bias</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linearityResult.fittedLevels.map((level) => (
                      <TableRow key={level.referenceValue}>
                        <TableCell>{fixed(level.referenceValue)}</TableCell>
                        <TableCell>{level.measurementCount}</TableCell>
                        <TableCell>{fixed(level.observedMeanBias)}</TableCell>
                        <TableCell>{fixed(level.fittedBias)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="study-warnings">
                  {linearityResult.warnings.map((warning) => (
                    <p key={warning}>
                      <AlertTriangle />
                      {warning}
                    </p>
                  ))}
                </div>
                <details className="study-assumptions">
                  <summary>Statistical assumptions</summary>
                  <ul>
                    {linearityResult.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="metrology-grid">
          <section className="panel calc-builder">
            <div className="section-heading">
              <div>
                <h2>Measurement-system stability</h2>
                <p>
                  Chronological balanced rational subgroups with Xbar/R signals.
                </p>
              </div>
            </div>
            <div className="calc-meta-grid">
              <label>
                <span>Study title</span>
                <Input
                  value={stabilityTitle}
                  onChange={(event) => setStabilityTitle(event.target.value)}
                />
              </label>
              <label>
                <span>Linked gauge</span>
                <select
                  value={stabilityGaugeId}
                  onChange={(event) => setStabilityGaugeId(event.target.value)}
                >
                  <option value="">General method</option>
                  {gauges.map((gauge) => (
                    <option key={gauge.id} value={gauge.id}>
                      {gauge.assetId} · {gauge.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="observation-input">
              <span>
                Subgroups (timestamp followed by balanced measurements)
              </span>
              <Textarea
                value={stabilityData}
                onChange={(event) => {
                  setStabilityData(event.target.value);
                  setStabilityResult(undefined);
                }}
                rows={13}
                spellCheck={false}
              />
            </label>
            <div className="calc-actions">
              <Button onClick={calculateStability}>
                <Calculator /> Calculate stability
              </Button>
              <Button
                variant="outline"
                disabled={!stabilityResult}
                onClick={saveStability}
              >
                <Save /> Save {saveStatus}
              </Button>
            </div>
          </section>
          <section className="panel calc-results">
            <div className="section-heading">
              <div>
                <h2>Xbar/R result</h2>
                <p>
                  Interpret Xbar signals only after establishing range control.
                </p>
              </div>
            </div>
            {!stabilityResult ? (
              <div className="calc-empty">
                <Activity />
                <strong>Ready to calculate</strong>
                <p>Paste balanced subgroups in strict chronological order.</p>
              </div>
            ) : (
              <>
                <div
                  className={`decision-result ${
                    stabilityResult.outOfControl
                      ? 'unacceptable'
                      : stabilityResult.warnings.length > 0
                        ? 'indeterminate'
                        : 'acceptable'
                  }`}
                >
                  <span>
                    {stabilityResult.outOfControl
                      ? 'special-cause signal'
                      : 'no signal detected'}
                  </span>
                  <strong>
                    {stabilityResult.signals.length} control-chart signal
                    {stabilityResult.signals.length === 1 ? '' : 's'} across{' '}
                    {stabilityResult.subgroupCount} subgroups
                  </strong>
                  <p>
                    Subgroup size {stabilityResult.subgroupSize} · A₂{' '}
                    {fixed(stabilityResult.constants.a2, 3)} · D₃{' '}
                    {fixed(stabilityResult.constants.d3, 3)} · D₄{' '}
                    {fixed(stabilityResult.constants.d4, 3)}
                  </p>
                </div>
                <div className="result-metrics">
                  <div>
                    <span>X̿ center</span>
                    <strong>{fixed(stabilityResult.centerLines.xbar)}</strong>
                  </div>
                  <div>
                    <span>Xbar limits</span>
                    <strong>
                      {fixed(stabilityResult.controlLimits.xbar.lower)} –{' '}
                      {fixed(stabilityResult.controlLimits.xbar.upper)}
                    </strong>
                  </div>
                  <div>
                    <span>R̄ center</span>
                    <strong>{fixed(stabilityResult.centerLines.range)}</strong>
                  </div>
                  <div>
                    <span>R limits</span>
                    <strong>
                      {fixed(stabilityResult.controlLimits.range.lower)} –{' '}
                      {fixed(stabilityResult.controlLimits.range.upper)}
                    </strong>
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Subgroup</TableHead>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Mean</TableHead>
                      <TableHead>Range</TableHead>
                      <TableHead>Signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stabilityResult.subgroups.map((subgroup) => (
                      <TableRow key={subgroup.id ?? subgroup.subgroupIndex}>
                        <TableCell>{subgroup.subgroupIndex + 1}</TableCell>
                        <TableCell>
                          {formatStudyTimestamp(subgroup.timestamp)}
                        </TableCell>
                        <TableCell>{fixed(subgroup.mean)}</TableCell>
                        <TableCell>{fixed(subgroup.range)}</TableCell>
                        <TableCell>
                          {stabilityResult.signals
                            .filter(
                              (signal) =>
                                signal.subgroupIndex === subgroup.subgroupIndex,
                            )
                            .map((signal) => stabilitySignalLabel(signal.rule))
                            .join(', ') || '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {stabilityResult.signals.length > 0 && (
                  <div className="study-warnings">
                    {stabilityResult.signals.map((signal, index) => (
                      <p
                        key={`${signal.rule}-${signal.subgroupIndex}-${index}`}
                      >
                        <AlertTriangle />
                        {signal.message}
                      </p>
                    ))}
                  </div>
                )}
                <div className="study-warnings">
                  {stabilityResult.warnings.map((warning) => (
                    <p key={warning}>
                      <AlertTriangle />
                      {warning}
                    </p>
                  ))}
                </div>
                <details className="study-assumptions">
                  <summary>Statistical assumptions</summary>
                  <ul>
                    {stabilityResult.assumptions.map((assumption) => (
                      <li key={assumption}>{assumption}</li>
                    ))}
                  </ul>
                </details>
              </>
            )}
          </section>
        </div>
      )}

      <section className="panel study-library">
        <div className="section-heading">
          <div>
            <h2>Controlled study library</h2>
            <p>
              Saved inputs, unrounded results, reviewer identity, and linked
              equipment.
            </p>
          </div>
          <span>{recent.length} studies</span>
        </div>
        {recent.length === 0 ? (
          <div className="calc-empty compact">
            <FlaskConical />
            <strong>No saved studies</strong>
            <p>Save a calculation to establish the controlled library.</p>
          </div>
        ) : (
          <div className="study-list">
            {recent.map((study) => (
              <article key={study.id}>
                <span className="study-icon">
                  {study.kind === 'uncertainty-budget' ? (
                    <FlaskConical />
                  ) : study.kind === 'gage-rr' ? (
                    <BarChart3 />
                  ) : study.kind === 'bias' ? (
                    <Scale />
                  ) : study.kind === 'linearity' ? (
                    <TrendingUp />
                  ) : (
                    <Activity />
                  )}
                </span>
                <div>
                  <strong>{study.title}</strong>
                  <p>
                    {study.kind === 'uncertainty-budget'
                      ? 'Uncertainty budget'
                      : study.kind === 'gage-rr'
                        ? 'Crossed Gage R&R'
                        : study.kind === 'bias'
                          ? 'Bias study'
                          : study.kind === 'linearity'
                            ? 'Linearity study'
                            : 'Stability study'}{' '}
                    · {study.status}
                  </p>
                </div>
                <span>{new Date(study.updatedAt).toLocaleDateString()}</span>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="claim-note">
        <AlertTriangle size={17} />
        <p>
          <strong>Technical review remains required.</strong> The calculators
          expose formulas and assumptions, but the organization must validate
          the model, contributors, distributions, study design, risk rule, and
          fitness for intended use.
        </p>
      </div>
    </div>
  );
}
