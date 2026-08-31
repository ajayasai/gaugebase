'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GitBranch,
  Link2,
  Search,
  ShieldAlert,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  formatDate,
  getCalibrationState,
  isoNow,
  stateLabel,
  uid,
  type AppState,
  type QualityCase,
} from '@/lib/model';
import { recommendCalibrationInterval } from '@/lib/interval-analysis';

function statusTone(status: QualityCase['status']) {
  return status === 'closed'
    ? 'good'
    : status === 'contained'
      ? 'warning'
      : 'danger';
}

export function QualityCenter({
  state,
  onUpsertCase,
  openGauge,
  onApplyInterval,
  canCloseCases = true,
}: {
  state: AppState;
  onUpsertCase: (record: QualityCase, previous?: QualityCase) => void;
  openGauge: (id: string) => void;
  onApplyInterval: (gaugeId: string, intervalMonths: number) => void;
  canCloseCases?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [closingCase, setClosingCase] = useState<QualityCase>();
  const [closureDisposition, setClosureDisposition] = useState('');
  const standards = state.gauges.filter(
    (gauge) => gauge.type === 'reference-standard',
  );
  const calibrationsWithLinks = state.calibrations.filter(
    (record) => (record.standardIds?.length ?? 0) > 0,
  );
  const traceabilityCoverage = state.calibrations.length
    ? Math.round(
        (calibrationsWithLinks.length / state.calibrations.length) * 100,
      )
    : 100;
  const risks = useMemo(
    () =>
      standards.flatMap((standard) => {
        const status = getCalibrationState(standard);
        const affected = state.calibrations.filter((record) =>
          record.standardIds?.includes(standard.id),
        );
        return ['overdue', 'failed', 'restriction-expired'].includes(status) &&
          affected.length
          ? [{ standard, status, affected }]
          : [];
      }),
    [standards, state.calibrations],
  );
  const intervalRecommendations = useMemo(
    () =>
      state.gauges
        .map((gauge) => ({
          gauge,
          recommendation: recommendCalibrationInterval(
            gauge,
            state.calibrations,
          ),
        }))
        .filter((item) => item.recommendation.direction !== 'retain'),
    [state.gauges, state.calibrations],
  );
  const cases = [...state.qualityCases]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter((record) =>
      [record.caseNumber, record.title, record.owner, record.status]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
    );

  const openRecall = (risk: (typeof risks)[number]) => {
    const now = isoNow();
    const record: QualityCase = {
      id: uid('case'),
      caseNumber: `Q-${new Date().getFullYear()}-${String(state.qualityCases.length + 1).padStart(4, '0')}`,
      type: 'recall',
      status: 'open',
      severity: risk.standard.criticality === 'critical' ? 'critical' : 'high',
      title: `Traceability review for ${risk.standard.assetId}`,
      description: `${risk.affected.length} calibration record${risk.affected.length === 1 ? '' : 's'} reference a standard that is now ${stateLabel(risk.status).toLowerCase()}. Review validity at time of use, customer/product impact, and disposition.`,
      gaugeId: risk.standard.id,
      owner: state.settings.actorName,
      impactWindowStart: risk.standard.lastCalibrated,
      impactWindowEnd: now.slice(0, 10),
      affectedGaugeIds: [...new Set(risk.affected.map((item) => item.gaugeId))],
      createdAt: now,
      updatedAt: now,
    };
    onUpsertCase(record);
  };

  const moveCase = (record: QualityCase, status: QualityCase['status']) =>
    onUpsertCase(
      {
        ...record,
        status,
        updatedAt: isoNow(),
        closedAt: status === 'closed' ? isoNow() : undefined,
      },
      record,
    );

  const beginClosure = (record: QualityCase) => {
    if (!canCloseCases) return;
    setClosingCase(record);
    setClosureDisposition(record.disposition ?? '');
  };

  const completeClosure = () => {
    if (!closingCase || !closureDisposition.trim()) return;
    const now = isoNow();
    onUpsertCase(
      {
        ...closingCase,
        status: 'closed',
        disposition: closureDisposition.trim(),
        updatedAt: now,
        closedAt: now,
      },
      closingCase,
    );
    setClosingCase(undefined);
    setClosureDisposition('');
  };

  return (
    <div className="quality-center">
      <div className="view-heading">
        <div>
          <p className="eyebrow">Risk and traceability</p>
          <h1>Quality center</h1>
          <p>
            Follow standards into downstream calibrations, contain failures, and
            preserve the impact-assessment trail.
          </p>
        </div>
      </div>

      <section className="quality-metrics" aria-label="Quality program summary">
        <article>
          <span>
            <Link2 />
          </span>
          <div>
            <strong>{traceabilityCoverage}%</strong>
            <p>structured standard linkage</p>
          </div>
        </article>
        <article>
          <span>
            <ShieldAlert />
          </span>
          <div>
            <strong>
              {
                state.qualityCases.filter((item) => item.status !== 'closed')
                  .length
              }
            </strong>
            <p>open quality cases</p>
          </div>
        </article>
        <article>
          <span>
            <GitBranch />
          </span>
          <div>
            <strong>{risks.length}</strong>
            <p>active traceability risks</p>
          </div>
        </article>
        <article>
          <span>
            <CheckCircle2 />
          </span>
          <div>
            <strong>
              {
                standards.filter(
                  (item) => getCalibrationState(item) === 'current',
                ).length
              }
              /{standards.length}
            </strong>
            <p>reference standards current</p>
          </div>
        </article>
      </section>

      <div className="quality-grid">
        <section className="panel traceability-panel">
          <div className="section-heading">
            <div>
              <h2>Traceability graph</h2>
              <p>
                Structured standard links, validity signals, and downstream
                exposure.
              </p>
            </div>
          </div>
          {standards.length === 0 ? (
            <div className="calc-empty compact">
              <GitBranch />
              <strong>No reference standards</strong>
              <p>Add reference-standard records to build the graph.</p>
            </div>
          ) : (
            <div className="standard-list">
              {standards.map((standard) => {
                const linked = state.calibrations.filter((record) =>
                  record.standardIds?.includes(standard.id),
                );
                const status = getCalibrationState(standard);
                return (
                  <article key={standard.id}>
                    <button onClick={() => openGauge(standard.id)}>
                      <span className={`standard-node ${status}`}>
                        <GitBranch />
                      </span>
                      <div>
                        <strong>
                          {standard.assetId} · {standard.name}
                        </strong>
                        <p>
                          {stateLabel(status)} ·{' '}
                          {standard.standardCertificateNumber ||
                            'Certificate not indexed'}{' '}
                          · {linked.length} downstream events
                        </p>
                      </div>
                      <ArrowRight />
                    </button>
                    {standard.traceabilitySource && (
                      <small>{standard.traceabilitySource}</small>
                    )}
                  </article>
                );
              })}
            </div>
          )}
          {traceabilityCoverage < 100 && (
            <div className="traceability-gap">
              <AlertTriangle />
              <div>
                <strong>
                  {state.calibrations.length - calibrationsWithLinks.length}{' '}
                  historical record
                  {state.calibrations.length - calibrationsWithLinks.length ===
                  1
                    ? ''
                    : 's'}{' '}
                  use free-text references only
                </strong>
                <p>
                  They remain preserved, but cannot participate in automated
                  impact queries until superseded or mapped.
                </p>
              </div>
            </div>
          )}
        </section>

        <section className="panel recall-panel">
          <div className="section-heading">
            <div>
              <h2>Downstream risk radar</h2>
              <p>Standards needing containment or documented review.</p>
            </div>
            <span>{risks.length} risks</span>
          </div>
          {risks.length === 0 ? (
            <div className="calc-empty compact good">
              <CheckCircle2 />
              <strong>No linked standard risk detected</strong>
              <p>
                Current structured links do not point to an unavailable
                standard.
              </p>
            </div>
          ) : (
            <div className="risk-list">
              {risks.map((risk) => (
                <article key={risk.standard.id}>
                  <span>
                    <AlertTriangle />
                  </span>
                  <div>
                    <strong>
                      {risk.standard.assetId} is{' '}
                      {stateLabel(risk.status).toLowerCase()}
                    </strong>
                    <p>
                      {risk.affected.length} linked calibration events ·{' '}
                      {new Set(risk.affected.map((item) => item.gaugeId)).size}{' '}
                      gauges
                    </p>
                  </div>
                  <Button size="sm" onClick={() => openRecall(risk)}>
                    Open recall
                  </Button>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="panel interval-panel">
        <div className="section-heading">
          <div>
            <h2>Interval optimization</h2>
            <p>
              Conservative, explainable recommendations from completed history
              and equipment criticality.
            </p>
          </div>
          <span>{intervalRecommendations.length} candidates</span>
        </div>
        {intervalRecommendations.length === 0 ? (
          <div className="calc-empty compact good">
            <CheckCircle2 />
            <strong>No interval changes suggested</strong>
            <p>
              Current evidence does not meet the screening threshold for a
              change.
            </p>
          </div>
        ) : (
          <div className="interval-list">
            {intervalRecommendations.map(({ gauge, recommendation }) => (
              <article key={gauge.id} className={recommendation.direction}>
                <button onClick={() => openGauge(gauge.id)}>
                  <strong>
                    {gauge.assetId} · {gauge.name}
                  </strong>
                  <p>{recommendation.explanation}</p>
                </button>
                <div>
                  <span>{recommendation.currentMonths} mo</span>
                  <ArrowRight />
                  <strong>{recommendation.recommendedMonths} mo</strong>
                  <em>{recommendation.confidence} confidence</em>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onApplyInterval(gauge.id, recommendation.recommendedMonths)
                  }
                >
                  Apply after review
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel case-panel">
        <div className="section-heading">
          <div>
            <h2>Quality cases</h2>
            <p>
              Out-of-tolerance impact, recalls, deviations, and CAPA through
              closure.
            </p>
          </div>
          <label className="case-search">
            <Search />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search cases…"
            />
          </label>
        </div>
        <div className="case-board">
          {(['open', 'investigating', 'contained', 'closed'] as const).map(
            (status) => (
              <div className="case-column" key={status}>
                <header>
                  <span>{status}</span>
                  <em>
                    {cases.filter((item) => item.status === status).length}
                  </em>
                </header>
                {cases
                  .filter((item) => item.status === status)
                  .map((record) => (
                    <article
                      key={record.id}
                      className={statusTone(record.status)}
                    >
                      <div>
                        <code>{record.caseNumber}</code>
                        <span>{record.severity}</span>
                      </div>
                      <strong>{record.title}</strong>
                      <p>{record.description}</p>
                      <small>
                        {record.owner}{' '}
                        {record.dueDate
                          ? `· due ${formatDate(record.dueDate)}`
                          : ''}
                      </small>
                      <div className="case-actions">
                        {status === 'open' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => moveCase(record, 'investigating')}
                          >
                            Investigate
                          </Button>
                        )}
                        {status === 'investigating' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => moveCase(record, 'contained')}
                          >
                            Contain
                          </Button>
                        )}
                        {status === 'contained' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canCloseCases}
                            title={
                              canCloseCases
                                ? 'Record reviewed disposition and close'
                                : 'Quality-manager authority is required to close cases'
                            }
                            onClick={() => beginClosure(record)}
                          >
                            Close
                          </Button>
                        )}
                        {status === 'closed' && (
                          <small>
                            Disposition: {record.disposition || 'Not recorded'}
                          </small>
                        )}
                      </div>
                    </article>
                  ))}
              </div>
            ),
          )}
        </div>
      </section>

      <Dialog
        open={Boolean(closingCase)}
        onOpenChange={(open) => {
          if (!open) {
            setClosingCase(undefined);
            setClosureDisposition('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close quality case</DialogTitle>
            <DialogDescription>
              Record the reviewed disposition. Closed cases are immutable;
              further work must use a controlled follow-up case.
            </DialogDescription>
          </DialogHeader>
          <label className="observation-input">
            <span>Final disposition</span>
            <Textarea
              value={closureDisposition}
              onChange={(event) => setClosureDisposition(event.target.value)}
              rows={5}
              placeholder="Document impact conclusion, containment, correction, and approval basis…"
            />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingCase(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!closureDisposition.trim()}
              onClick={completeClosure}
            >
              <CheckCircle2 /> Record closure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="claim-note">
        <AlertTriangle size={17} />
        <p>
          <strong>Impact suggestions are leads, not conclusions.</strong>{' '}
          GaugeBase identifies linked records and time windows; qualified
          personnel must determine actual product, process, customer, and
          regulatory impact.
        </p>
      </div>
    </div>
  );
}
