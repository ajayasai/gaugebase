'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FileArchive,
  FileCheck2,
  FileDown,
  FileText,
  Filter,
  Gauge,
  Hash,
  History,
  Import,
  Info,
  LayoutDashboard,
  LockKeyhole,
  MapPin,
  Menu,
  PackageOpen,
  Paperclip,
  Pencil,
  Plus,
  QrCode,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Upload,
  UserRound,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { loadWorkspace, saveWorkspace } from '@/lib/database';
import {
  addMonthsClamped,
  appendAudit,
  createSeedState,
  daysUntil,
  formatDate,
  getCalibrationState,
  hashValue,
  isoNow,
  readingResult,
  stateLabel,
  todayIso,
  uid,
  verifyAuditChain,
  type AppState,
  type CalibrationRecord,
  type CalibrationResult,
  type GaugeRecord,
  type Reading,
} from '@/lib/model';
import {
  downloadAttachment,
  downloadCsvTemplate,
  downloadIcs,
  downloadLabelPng,
  exportAuditCsv,
  exportEncryptedBackup,
  exportGaugesCsv,
  fileToDataUrl,
  generateCertificatePdf,
  importBackup,
  importedGauge,
  parseGaugeCsv,
  type CsvPreview,
} from '@/lib/workspace-actions';

type View =
  | 'dashboard'
  | 'register'
  | 'calibrations'
  | 'schedule'
  | 'labels'
  | 'audit'
  | 'settings';
type ToastMessage = {
  id: number;
  title: string;
  detail?: string;
  tone?: 'good' | 'warning' | 'danger';
};

const navItems: Array<{ key: View; label: string; icon: typeof Gauge }> = [
  { key: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { key: 'register', label: 'Gauge register', icon: Gauge },
  { key: 'calibrations', label: 'Calibrations', icon: ClipboardCheck },
  { key: 'schedule', label: 'Schedule', icon: CalendarClock },
  { key: 'labels', label: 'Labels', icon: QrCode },
  { key: 'audit', label: 'Audit log', icon: History },
];

function calibrationTone(gauge: GaugeRecord) {
  return getCalibrationState(gauge).replace('not-required', 'inactive');
}

function dueLabel(gauge: GaugeRecord) {
  const days = daysUntil(gauge.nextDue);
  if (!Number.isFinite(days)) return 'No due date';
  if (days < 0)
    return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due ${formatDate(gauge.nextDue, { day: 'numeric', month: 'short' })}`;
}

function relativeTime(timestamp: string) {
  const seconds = Math.round(
    (Date.now() - new Date(timestamp).getTime()) / 1000,
  );
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (seconds < 60) return 'just now';
  if (seconds < 3600)
    return formatter.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86_400)
    return formatter.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 2_592_000)
    return formatter.format(-Math.round(seconds / 86_400), 'day');
  return formatDate(timestamp.slice(0, 10));
}

function formText(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

function ViewHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="view-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="view-actions">{actions}</div>}
    </div>
  );
}

function StatusPill({ gauge }: { gauge: GaugeRecord }) {
  return (
    <span className={`status-pill ${calibrationTone(gauge)}`}>
      <i />
      {stateLabel(getCalibrationState(gauge))}
    </span>
  );
}

export function CalibrationApp() {
  const [state, setState] = useState<AppState>(() => createSeedState());
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>('dashboard');
  const [search, setSearch] = useState('');
  const [selectedGaugeId, setSelectedGaugeId] = useState<string>();
  const [gaugeDialogOpen, setGaugeDialogOpen] = useState(false);
  const [editingGaugeId, setEditingGaugeId] = useState<string>();
  const [calibrationDialogGaugeId, setCalibrationDialogGaugeId] =
    useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const toast = (
    title: string,
    detail?: string,
    tone: ToastMessage['tone'] = 'good',
  ) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, title, detail, tone }]);
    window.setTimeout(
      () =>
        setToasts((current) => current.filter((message) => message.id !== id)),
      4300,
    );
  };

  useEffect(() => {
    loadWorkspace()
      .then((stored) => {
        if (stored?.schemaVersion === 1) setState(stored);
        setHydrated(true);
      })
      .catch(() => setHydrated(true));
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('asset');
    if (!token) return;
    const match = state.gauges.find((gauge) => gauge.token === token);
    if (match) {
      setSelectedGaugeId(match.id);
      setView('register');
    }
  }, [hydrated, state.gauges]);

  useEffect(() => {
    if (hydrated)
      saveWorkspace(state).catch(() =>
        toast(
          'Local save failed',
          'Export a backup before closing this tab.',
          'danger',
        ),
      );
  }, [state, hydrated]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === 'Escape') setSearch('');
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const selectedGauge = state.gauges.find(
    (gauge) => gauge.id === selectedGaugeId,
  );
  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return [];
    return state.gauges
      .filter((gauge) =>
        [
          gauge.assetId,
          gauge.name,
          gauge.serial,
          gauge.location,
          gauge.manufacturer,
        ].some((value) => value.toLowerCase().includes(query)),
      )
      .slice(0, 6);
  }, [search, state.gauges]);

  const openGauge = (id: string) => {
    setSelectedGaugeId(id);
    setSearch('');
    setView('register');
  };
  const goTo = (next: View) => {
    setView(next);
    setMobileNavOpen(false);
    window.history.replaceState(null, '', `#${next}`);
  };
  const editGauge = (id: string) => {
    setEditingGaugeId(id);
    setGaugeDialogOpen(true);
  };
  const newGauge = () => {
    setEditingGaugeId(undefined);
    setGaugeDialogOpen(true);
  };

  const upsertGauge = (gauge: GaugeRecord, previous?: GaugeRecord) => {
    setState((current) => {
      const gauges = previous
        ? current.gauges.map((item) => (item.id === gauge.id ? gauge : item))
        : [...current.gauges, gauge];
      return {
        ...current,
        gauges,
        audit: appendAudit(current.audit, {
          actor: current.settings.actorName,
          action: previous ? 'gauge.updated' : 'gauge.created',
          entityType: 'gauge',
          entityId: gauge.id,
          summary: `${gauge.assetId} ${previous ? 'record updated' : 'added to register'}`,
          before: previous,
          after: gauge,
        }),
      };
    });
    toast(
      previous ? 'Gauge updated' : 'Gauge added',
      `${gauge.assetId} · ${gauge.name}`,
    );
  };

  const archiveGauge = (gauge: GaugeRecord) => {
    upsertGauge({ ...gauge, lifecycle: 'retired', updatedAt: isoNow() }, gauge);
    setSelectedGaugeId(undefined);
    toast(
      'Gauge retired',
      'Its records and history remain available.',
      'warning',
    );
  };

  const saveCalibration = (
    calibration: CalibrationRecord,
    gauge: GaugeRecord,
  ) => {
    setState((current) => {
      const previousGauge = current.gauges.find(
        (item) => item.id === gauge.id,
      )!;
      return {
        ...current,
        gauges: current.gauges.map((item) =>
          item.id === gauge.id ? gauge : item,
        ),
        calibrations: [calibration, ...current.calibrations],
        audit: appendAudit(current.audit, {
          actor: current.settings.actorName,
          action: 'calibration.completed',
          entityType: 'calibration',
          entityId: calibration.id,
          summary: `${gauge.assetId} recorded as ${calibration.result === 'conditional' ? 'conditional pass' : calibration.result}`,
          before: { gauge: previousGauge },
          after: { calibration, gauge },
        }),
      };
    });
    toast(
      'Calibration recorded',
      `${gauge.assetId} · ${calibration.result === 'pass' ? 'Passed' : calibration.result === 'fail' ? 'Failed and placed out of service' : 'Restricted use approved'}`,
      calibration.result === 'fail'
        ? 'danger'
        : calibration.result === 'conditional'
          ? 'warning'
          : 'good',
    );
  };

  const addAttachments = async (gauge: GaugeRecord, files: FileList) => {
    const accepted = Array.from(files).filter((file) => file.size <= 5_000_000);
    if (accepted.length !== files.length)
      toast(
        'Some files were skipped',
        'Attachments are limited to 5 MB each.',
        'warning',
      );
    const attachments = await Promise.all(
      accepted.map(async (file) => {
        const dataUrl = await fileToDataUrl(file);
        return {
          id: uid('attachment'),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          dataUrl,
          sha256: hashValue(dataUrl),
          createdAt: isoNow(),
          targetType: 'gauge' as const,
          targetId: gauge.id,
        };
      }),
    );
    if (!attachments.length) return;
    setState((current) => {
      const updated = {
        ...gauge,
        attachmentIds: [
          ...gauge.attachmentIds,
          ...attachments.map((attachment) => attachment.id),
        ],
        updatedAt: isoNow(),
      };
      return {
        ...current,
        attachments: [...current.attachments, ...attachments],
        gauges: current.gauges.map((item) =>
          item.id === gauge.id ? updated : item,
        ),
        audit: appendAudit(current.audit, {
          actor: current.settings.actorName,
          action: 'attachment.linked',
          entityType: 'attachment',
          entityId: attachments[0].id,
          summary: `${attachments.length} attachment${attachments.length === 1 ? '' : 's'} linked to ${gauge.assetId}`,
          after: attachments.map(
            ({ dataUrl: _data, ...attachment }) => attachment,
          ),
        }),
      };
    });
    toast(
      'Attachment saved',
      `${attachments.length} file${attachments.length === 1 ? '' : 's'} stored on this device.`,
    );
  };

  const openCalibration = (gaugeId?: string) =>
    setCalibrationDialogGaugeId(
      gaugeId ??
        state.gauges.find((gauge) => gauge.lifecycle !== 'retired')?.id,
    );
  const counts = useMemo(() => {
    const status = state.gauges.map(getCalibrationState);
    return {
      overdue: status.filter((item) => item === 'overdue').length,
      dueSoon: status.filter((item) => item === 'due-soon').length,
      current: status.filter((item) => item === 'current').length,
      unavailable: status.filter((item) =>
        ['failed', 'conditional'].includes(item),
      ).length,
    };
  }, [state.gauges]);

  return (
    <main className="app-shell full-app">
      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">
            <Gauge size={20} strokeWidth={2.25} />
          </span>
          <span>
            <strong>GaugeBase</strong>
            <small>Calibration control</small>
          </span>
          <button
            className="mobile-close"
            onClick={() => setMobileNavOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <nav aria-label="Primary navigation">
          <p className="nav-label">Workspace</p>
          {navItems.map(({ key, label, icon: Icon }) => (
            <button
              className={`nav-item ${view === key ? 'active' : ''}`}
              key={key}
              onClick={() => goTo(key)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {key === 'calibrations' && counts.overdue > 0 && (
                <em>{counts.overdue}</em>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="data-card">
            <ShieldCheck size={18} />
            <div>
              <strong>Your data stays yours</strong>
              <p>Stored on this device. Export a backup anytime.</p>
            </div>
          </div>
          <button
            className={`nav-item ${view === 'settings' ? 'active' : ''}`}
            onClick={() => goTo('settings')}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <div className="profile">
            <span className="avatar">
              {state.settings.actorName
                .split(' ')
                .map((part) => part[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </span>
            <span>
              <strong>{state.settings.actorName}</strong>
              <small>Quality manager</small>
            </span>
            <span
              className="online-dot"
              title={hydrated ? 'Saved locally' : 'Loading local workspace'}
            />
          </div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button
            className="mobile-menu"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={19} />
          </button>
          <div className="global-search-wrap">
            <label className="search-box">
              <Search size={18} />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search gauges, serials, locations…"
                aria-label="Search"
              />
              <kbd>Ctrl K</kbd>
            </label>
            {searchResults.length > 0 && (
              <div className="search-results">
                <p>Gauge register</p>
                {searchResults.map((gauge) => (
                  <button key={gauge.id} onClick={() => openGauge(gauge.id)}>
                    <span className={`result-icon ${calibrationTone(gauge)}`}>
                      <Gauge size={16} />
                    </span>
                    <span>
                      <strong>
                        {gauge.assetId} · {gauge.name}
                      </strong>
                      <small>
                        {gauge.manufacturer} · {gauge.location}
                      </small>
                    </span>
                    <StatusPill gauge={gauge} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="View reminders"
              onClick={() => goTo('schedule')}
            >
              <Bell size={19} />
              {counts.overdue + counts.dueSoon > 0 && (
                <span className="notification-dot" />
              )}
            </button>
            <button className="primary-button" onClick={newGauge}>
              <Plus size={17} />
              Add gauge
            </button>
          </div>
        </header>
        <div className="content app-content">
          {view === 'dashboard' && (
            <DashboardView
              state={state}
              counts={counts}
              openGauge={openGauge}
              openCalibration={openCalibration}
              goTo={goTo}
            />
          )}
          {view === 'register' && (
            <RegisterView
              state={state}
              openGauge={openGauge}
              newGauge={newGauge}
              openImport={() => setImportOpen(true)}
              exportCsv={() => {
                exportGaugesCsv(state.gauges);
                setState((current) => ({
                  ...current,
                  audit: appendAudit(current.audit, {
                    actor: current.settings.actorName,
                    action: 'export.gauges',
                    entityType: 'export',
                    entityId: uid('export'),
                    summary: `${current.gauges.length} gauge records exported to CSV`,
                  }),
                }));
                toast(
                  'CSV exported',
                  `${state.gauges.length} gauge records downloaded.`,
                );
              }}
            />
          )}
          {view === 'calibrations' && (
            <CalibrationsView
              state={state}
              openCalibration={openCalibration}
              openGauge={openGauge}
              downloadCertificate={(calibration, gauge) =>
                generateCertificatePdf(state, calibration, gauge)
              }
            />
          )}
          {view === 'schedule' && (
            <ScheduleView
              state={state}
              setState={setState}
              openGauge={openGauge}
              goTo={goTo}
              toast={toast}
            />
          )}
          {view === 'labels' && (
            <LabelsView
              state={state}
              setState={setState}
              initialGaugeId={selectedGaugeId}
              toast={toast}
            />
          )}
          {view === 'audit' && (
            <AuditView
              state={state}
              exportAudit={() => {
                exportAuditCsv(state.audit);
                setState((current) => ({
                  ...current,
                  audit: appendAudit(current.audit, {
                    actor: current.settings.actorName,
                    action: 'export.audit',
                    entityType: 'export',
                    entityId: uid('export'),
                    summary: `${current.audit.length} audit entries exported with hash chain`,
                  }),
                }));
                toast(
                  'Audit log exported',
                  'The CSV includes every entry hash and its predecessor.',
                );
              }}
            />
          )}
          {view === 'settings' && (
            <SettingsView state={state} setState={setState} toast={toast} />
          )}
        </div>
      </section>

      <GaugeDialog
        open={gaugeDialogOpen}
        onOpenChange={setGaugeDialogOpen}
        state={state}
        editing={state.gauges.find((gauge) => gauge.id === editingGaugeId)}
        onSave={upsertGauge}
        toast={toast}
      />
      <CalibrationDialog
        gaugeId={calibrationDialogGaugeId}
        state={state}
        onClose={() => setCalibrationDialogGaugeId(undefined)}
        onSave={saveCalibration}
        toast={toast}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        state={state}
        setState={setState}
        toast={toast}
      />
      <GaugeDetailSheet
        gauge={selectedGauge}
        state={state}
        open={Boolean(selectedGauge)}
        onOpenChange={(open) => !open && setSelectedGaugeId(undefined)}
        editGauge={editGauge}
        archiveGauge={archiveGauge}
        openCalibration={openCalibration}
        addAttachments={addAttachments}
        goTo={goTo}
      />
      <div className="toast-stack" aria-live="polite">
        {toasts.map((message) => (
          <div
            className={`toast-message ${message.tone ?? 'good'}`}
            key={message.id}
          >
            <span>
              {message.tone === 'danger' ? (
                <AlertTriangle size={17} />
              ) : message.tone === 'warning' ? (
                <Info size={17} />
              ) : (
                <CheckCircle2 size={17} />
              )}
            </span>
            <div>
              <strong>{message.title}</strong>
              {message.detail && <p>{message.detail}</p>}
            </div>
            <button
              onClick={() =>
                setToasts((current) =>
                  current.filter((item) => item.id !== message.id),
                )
              }
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}

function DashboardView({
  state,
  counts,
  openGauge,
  openCalibration,
  goTo,
}: {
  state: AppState;
  counts: {
    overdue: number;
    dueSoon: number;
    current: number;
    unavailable: number;
  };
  openGauge: (id: string) => void;
  openCalibration: (id?: string) => void;
  goTo: (view: View) => void;
}) {
  const queue = [...state.gauges]
    .filter((gauge) =>
      ['overdue', 'due-soon', 'failed', 'conditional'].includes(
        getCalibrationState(gauge),
      ),
    )
    .sort((a, b) => daysUntil(a.nextDue) - daysUntil(b.nextDue))
    .slice(0, 4);
  const active = state.gauges.filter(
    (gauge) => !['retired', 'inactive'].includes(gauge.lifecycle),
  );
  const score = active.length
    ? Math.round(
        (active.filter((gauge) =>
          ['current', 'due-soon'].includes(getCalibrationState(gauge)),
        ).length /
          active.length) *
          100,
      )
    : 100;
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(now);
  const completeness = Math.round(
    (state.gauges.filter(
      (gauge) => gauge.serial && gauge.location && gauge.custodian,
    ).length /
      Math.max(1, state.gauges.length)) *
      100,
  );
  const passRate = state.calibrations.length
    ? Math.round(
        (state.calibrations.filter((item) => item.result === 'pass').length /
          state.calibrations.length) *
          100,
      )
    : 100;
  return (
    <>
      <ViewHeading
        eyebrow={dateLabel}
        title={`Good ${now.getHours() < 12 ? 'morning' : now.getHours() < 18 ? 'afternoon' : 'evening'}, ${state.settings.actorName.split(' ')[0]}.`}
        description="Here’s what needs attention across your calibration program."
        actions={
          <Button variant="outline" size="lg" onClick={() => goTo('audit')}>
            <Activity />
            View program history
          </Button>
        }
      />
      <section className="metrics" aria-label="Calibration summary">
        <article className="metric-card metric-danger">
          <span className="metric-icon">
            <AlertTriangle size={20} />
          </span>
          <div>
            <p>Overdue</p>
            <strong>{counts.overdue}</strong>
          </div>
          <span className="metric-trend">Immediate action required</span>
        </article>
        <article className="metric-card metric-warning">
          <span className="metric-icon">
            <CalendarClock size={20} />
          </span>
          <div>
            <p>Due in 30 days</p>
            <strong>{counts.dueSoon}</strong>
          </div>
          <span className="metric-trend">Including due today</span>
        </article>
        <article className="metric-card metric-good">
          <span className="metric-icon">
            <CheckCircle2 size={20} />
          </span>
          <div>
            <p>In calibration</p>
            <strong>{counts.current}</strong>
          </div>
          <span className="metric-trend">Available for use</span>
        </article>
        <article className="metric-card metric-neutral">
          <span className="metric-icon">
            <Wrench size={20} />
          </span>
          <div>
            <p>Restricted / service</p>
            <strong>{counts.unavailable}</strong>
          </div>
          <span className="metric-trend">Review before use</span>
        </article>
      </section>
      <div className="dashboard-grid">
        <section className="panel schedule-panel">
          <div className="panel-heading">
            <div>
              <h2>Priority queue</h2>
              <p>Ordered by state and due date</p>
            </div>
            <button onClick={() => goTo('schedule')}>
              View schedule <ArrowUpRight size={15} />
            </button>
          </div>
          <div className="gauge-list">
            {queue.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="The queue is clear"
                detail="No gauges are overdue, due soon, or restricted."
              />
            ) : (
              queue.map((gauge) => (
                <article
                  className="gauge-row"
                  key={gauge.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ')
                      openGauge(gauge.id);
                  }}
                  onClick={() => openGauge(gauge.id)}
                >
                  <span className={`status-rail ${calibrationTone(gauge)}`} />
                  <span className="gauge-symbol">
                    <Gauge size={19} />
                  </span>
                  <div className="gauge-details">
                    <div>
                      <code>{gauge.assetId}</code>
                      <StatusPill gauge={gauge} />
                    </div>
                    <h3>{gauge.name}</h3>
                    <p>
                      {gauge.manufacturer} · {gauge.location}
                    </p>
                  </div>
                  <div className="due-date">
                    <strong>{dueLabel(gauge)}</strong>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        openCalibration(gauge.id);
                      }}
                    >
                      Record result
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
        <aside className="panel health-panel">
          <div className="panel-heading">
            <div>
              <h2>Program health</h2>
              <p>Live workspace score</p>
            </div>
            <button aria-label="Open audit log" onClick={() => goTo('audit')}>
              •••
            </button>
          </div>
          <div className="health-score">
            <div
              className="score-ring"
              style={{
                background: `conic-gradient(#1d7968 0 ${score}%, #e7ece8 ${score}% 100%)`,
              }}
            >
              <strong>{score}</strong>
              <span>/100</span>
            </div>
            <div>
              <strong>
                {score >= 90
                  ? 'Healthy'
                  : score >= 70
                    ? 'Needs attention'
                    : 'At risk'}
              </strong>
              <p>{active.length} controlled instruments</p>
            </div>
          </div>
          <div className="health-bars">
            <div>
              <span>
                <b>Current or due soon</b>
                <em>{score}%</em>
              </span>
              <i>
                <u style={{ width: `${score}%` }} />
              </i>
            </div>
            <div>
              <span>
                <b>Record completeness</b>
                <em>{completeness}%</em>
              </span>
              <i>
                <u style={{ width: `${completeness}%` }} />
              </i>
            </div>
            <div>
              <span>
                <b>Calibration pass rate</b>
                <em>{passRate}%</em>
              </span>
              <i>
                <u style={{ width: `${passRate}%` }} />
              </i>
            </div>
          </div>
          <div className="insight-card">
            <span>
              <ShieldCheck size={17} />
            </span>
            <p>
              <strong>History chain verified</strong>
              {verifyAuditChain(state.audit)
                ? `All ${state.audit.length} entries link correctly.`
                : 'An audit entry no longer matches its recorded hash.'}
            </p>
          </div>
        </aside>
      </div>
      <section className="quick-actions">
        <button onClick={() => openCalibration()}>
          <span>
            <ClipboardCheck />
          </span>
          <div>
            <strong>Record calibration</strong>
            <p>Pass, fail, or restricted use with readings</p>
          </div>
          <ArrowRight />
        </button>
        <button onClick={() => goTo('labels')}>
          <span>
            <QrCode />
          </span>
          <div>
            <strong>Print a label</strong>
            <p>Privacy-safe QR and Code 128</p>
          </div>
          <ArrowRight />
        </button>
        <button onClick={() => goTo('settings')}>
          <span>
            <FileArchive />
          </span>
          <div>
            <strong>Back up workspace</strong>
            <p>Portable, password-protected export</p>
          </div>
          <ArrowRight />
        </button>
      </section>
    </>
  );
}

function EmptyState({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Gauge;
  title: string;
  detail: string;
}) {
  return (
    <div className="empty-state">
      <span>
        <Icon size={22} />
      </span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function RegisterView({
  state,
  openGauge,
  newGauge,
  openImport,
  exportCsv,
}: {
  state: AppState;
  openGauge: (id: string) => void;
  newGauge: () => void;
  openImport: () => void;
  exportCsv: () => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<
    'all' | ReturnType<typeof getCalibrationState>
  >('all');
  const gauges = useMemo(
    () =>
      state.gauges
        .filter((gauge) => {
          const matches = [
            gauge.assetId,
            gauge.name,
            gauge.serial,
            gauge.location,
            gauge.custodian,
          ]
            .join(' ')
            .toLowerCase()
            .includes(query.toLowerCase());
          return (
            matches &&
            (filter === 'all' || getCalibrationState(gauge) === filter)
          );
        })
        .sort((a, b) => a.assetId.localeCompare(b.assetId)),
    [state.gauges, query, filter],
  );
  return (
    <>
      <ViewHeading
        eyebrow={`${state.gauges.length} controlled records`}
        title="Gauge register"
        description="One searchable source of truth for instruments, standards, owners, and calibration status."
        actions={
          <>
            <Button variant="outline" size="lg" onClick={openImport}>
              <Import />
              Import CSV
            </Button>
            <Button variant="outline" size="lg" onClick={exportCsv}>
              <FileDown />
              Export
            </Button>
            <Button size="lg" onClick={newGauge}>
              <Plus />
              Add gauge
            </Button>
          </>
        }
      />
      <section className="register-summary">
        {(
          [
            'all',
            'current',
            'due-soon',
            'overdue',
            'conditional',
            'failed',
          ] as const
        ).map((status) => {
          const count =
            status === 'all'
              ? state.gauges.length
              : state.gauges.filter(
                  (gauge) => getCalibrationState(gauge) === status,
                ).length;
          return (
            <button
              key={status}
              className={filter === status ? 'active' : ''}
              onClick={() => setFilter(status)}
            >
              <span className={`summary-dot ${status}`} />
              {status === 'all'
                ? 'All gauges'
                : status === 'failed'
                  ? 'Out of service'
                  : stateLabel(status)}
              <strong>{count}</strong>
            </button>
          );
        })}
      </section>
      <section className="panel data-panel">
        <div className="table-toolbar">
          <label>
            <Search size={16} />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter this register…"
            />
          </label>
          <span>
            <Filter size={15} />
            {gauges.length} shown
          </span>
        </div>
        {gauges.length === 0 ? (
          <EmptyState
            icon={PackageOpen}
            title="No gauges match"
            detail="Try a broader search or another status filter."
          />
        ) : (
          <Table className="register-table">
            <TableHeader>
              <TableRow>
                <TableHead>Asset / instrument</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Location & owner</TableHead>
                <TableHead>Last calibrated</TableHead>
                <TableHead>Next due</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gauges.map((gauge) => (
                <TableRow key={gauge.id} onClick={() => openGauge(gauge.id)}>
                  <TableCell>
                    <div className="asset-cell">
                      <span>
                        <Gauge size={18} />
                      </span>
                      <div>
                        <strong>{gauge.assetId}</strong>
                        <p>{gauge.name}</p>
                        <small>
                          {gauge.manufacturer} {gauge.model} · S/N{' '}
                          {gauge.serial || '—'}
                        </small>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill gauge={gauge} />
                  </TableCell>
                  <TableCell>
                    <strong className="table-primary">
                      {gauge.location || 'Unassigned'}
                    </strong>
                    <small className="table-secondary">
                      {gauge.custodian || 'No custodian'}
                    </small>
                  </TableCell>
                  <TableCell>
                    <span className="date-cell">
                      {formatDate(gauge.lastCalibrated)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`date-cell ${calibrationTone(gauge)}`}>
                      {formatDate(gauge.nextDue)}
                      <small>{dueLabel(gauge)}</small>
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Open ${gauge.assetId}`}
                    >
                      <ArrowRight />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
    </>
  );
}

function CalibrationsView({
  state,
  openCalibration,
  openGauge,
  downloadCertificate,
}: {
  state: AppState;
  openCalibration: (id?: string) => void;
  openGauge: (id: string) => void;
  downloadCertificate: (
    calibration: CalibrationRecord,
    gauge: GaugeRecord,
  ) => void;
}) {
  const [resultFilter, setResultFilter] = useState<'all' | CalibrationResult>(
    'all',
  );
  const records = state.calibrations.filter(
    (record) => resultFilter === 'all' || record.result === resultFilter,
  );
  return (
    <>
      <ViewHeading
        eyebrow="Controlled calibration records"
        title="Calibrations"
        description="Capture as-found and as-left readings, standards, outcomes, approvals, and certificates."
        actions={
          <Button size="lg" onClick={() => openCalibration()}>
            <Plus />
            Record calibration
          </Button>
        }
      />
      <section className="calibration-stats">
        <div>
          <span className="good">
            <CheckCircle2 />
          </span>
          <p>
            <strong>
              {
                state.calibrations.filter((item) => item.result === 'pass')
                  .length
              }
            </strong>
            Passed
          </p>
        </div>
        <div>
          <span className="warning">
            <Info />
          </span>
          <p>
            <strong>
              {
                state.calibrations.filter(
                  (item) => item.result === 'conditional',
                ).length
              }
            </strong>
            Conditional
          </p>
        </div>
        <div>
          <span className="danger">
            <AlertTriangle />
          </span>
          <p>
            <strong>
              {
                state.calibrations.filter((item) => item.result === 'fail')
                  .length
              }
            </strong>
            Failed
          </p>
        </div>
        <div>
          <span>
            <FileCheck2 />
          </span>
          <p>
            <strong>{state.calibrations.length}</strong>Certificates ready
          </p>
        </div>
      </section>
      <section className="panel data-panel">
        <div className="table-toolbar">
          <div className="segmented-control">
            {(['all', 'pass', 'conditional', 'fail'] as const).map((item) => (
              <button
                key={item}
                className={resultFilter === item ? 'active' : ''}
                onClick={() => setResultFilter(item)}
              >
                {item === 'all'
                  ? 'All results'
                  : item === 'conditional'
                    ? 'Conditional pass'
                    : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <span>{records.length} records</span>
        </div>
        {records.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No calibration records yet"
            detail="Record a completed calibration to start immutable history."
          />
        ) : (
          <Table className="register-table calibration-table">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Gauge</TableHead>
                <TableHead>Performed</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Technician</TableHead>
                <TableHead>Certificate</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => {
                const gauge = state.gauges.find(
                  (item) => item.id === record.gaugeId,
                );
                if (!gauge) return null;
                return (
                  <TableRow key={record.id}>
                    <TableCell>
                      <code className="event-number">{record.eventNumber}</code>
                    </TableCell>
                    <TableCell>
                      <button
                        className="table-link"
                        onClick={() => openGauge(gauge.id)}
                      >
                        <strong>{gauge.assetId}</strong>
                        <small>{gauge.name}</small>
                      </button>
                    </TableCell>
                    <TableCell>
                      <span className="date-cell">
                        {formatDate(record.performedOn)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={`result-pill ${record.result}`}>
                        {record.result === 'conditional'
                          ? 'Conditional pass'
                          : record.result}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="table-primary">{record.technician}</span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => downloadCertificate(record, gauge)}
                      >
                        <Download />
                        {record.certificateNumber}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
      <div className="claim-note">
        <Info size={17} />
        <p>
          <strong>Evidence, not accreditation.</strong> Certificates reflect
          data entered and approved by your organization. GaugeBase does not
          independently establish traceability, technical validity, or
          compliance.
        </p>
      </div>
    </>
  );
}

function ScheduleView({
  state,
  setState,
  openGauge,
  goTo,
  toast,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  openGauge: (id: string) => void;
  goTo: (view: View) => void;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const schedule = [...state.gauges]
    .filter(
      (gauge) =>
        gauge.nextDue && !['retired', 'inactive'].includes(gauge.lifecycle),
    )
    .sort((a, b) => daysUntil(a.nextDue) - daysUntil(b.nextDue));
  const [sending, setSending] = useState<string>();
  const sendReminder = async (gauge: GaugeRecord) => {
    const recipient =
      gauge.custodianEmail || state.settings.qualityManagerEmail;
    if (!recipient) {
      toast(
        'No recipient email',
        'Add a custodian or quality-manager email in Settings.',
        'warning',
      );
      return;
    }
    const subject = `Calibration ${daysUntil(gauge.nextDue) < 0 ? 'overdue' : 'due'}: ${gauge.assetId} ${gauge.name}`;
    const body = `${gauge.assetId} · ${gauge.name}\nStatus: ${stateLabel(getCalibrationState(gauge))}\nDue: ${formatDate(gauge.nextDue)}\nLocation: ${gauge.location}\n\nSent from ${state.settings.organizationName}'s GaugeBase workspace.`;
    setSending(gauge.id);
    try {
      if (state.settings.reminderWebhook) {
        const response = await fetch(state.settings.reminderWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: recipient,
            subject,
            text: body,
            gauge: {
              assetId: gauge.assetId,
              name: gauge.name,
              nextDue: gauge.nextDue,
              status: getCalibrationState(gauge),
            },
          }),
        });
        if (!response.ok)
          throw new Error(`Webhook returned ${response.status}`);
        toast('Reminder sent', `${recipient} received the due-date reminder.`);
      } else {
        window.location.href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
        toast(
          'Email draft opened',
          'Add a reminder webhook in Settings for one-click delivery.',
        );
      }
      setState((current) => ({
        ...current,
        audit: appendAudit(current.audit, {
          actor: current.settings.actorName,
          action: state.settings.reminderWebhook
            ? 'reminder.webhook_sent'
            : 'reminder.email_drafted',
          entityType: 'settings',
          entityId: gauge.id,
          summary: `Calibration reminder prepared for ${gauge.assetId} → ${recipient}`,
          after: { recipient, due: gauge.nextDue },
        }),
      }));
    } catch (error) {
      toast(
        'Reminder delivery failed',
        error instanceof Error
          ? error.message
          : 'The configured webhook could not be reached.',
        'danger',
      );
    } finally {
      setSending(undefined);
    }
  };
  const enableNotifications = async () => {
    if (!('Notification' in window))
      return toast(
        'Notifications unavailable',
        'This browser does not support desktop notifications.',
        'warning',
      );
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      new Notification('GaugeBase reminders are ready', {
        body: `${schedule.filter((gauge) => daysUntil(gauge.nextDue) <= gauge.dueSoonDays).length} gauges need attention.`,
      });
      toast('Desktop reminders enabled');
    } else
      toast(
        'Notifications not enabled',
        'You can change notification permission in your browser settings.',
        'warning',
      );
  };
  return (
    <>
      <ViewHeading
        eyebrow="Due-date control"
        title="Calibration schedule"
        description="Triage upcoming work, send reminders, and take your calendar with you."
        actions={
          <>
            <Button variant="outline" size="lg" onClick={enableNotifications}>
              <Bell />
              Desktop alerts
            </Button>
            <Button
              variant="outline"
              size="lg"
              onClick={() => downloadIcs(state.gauges)}
            >
              <CalendarClock />
              Export .ics
            </Button>
          </>
        }
      />
      <section className="schedule-layout">
        <div className="panel schedule-timeline">
          <div className="panel-heading">
            <div>
              <h2>Due work</h2>
              <p>
                {
                  schedule.filter((gauge) => daysUntil(gauge.nextDue) <= 30)
                    .length
                }{' '}
                records due in the next 30 days or overdue
              </p>
            </div>
            <span className="live-badge">
              <i />
              Live
            </span>
          </div>
          <div className="timeline-list">
            {schedule.map((gauge) => {
              const days = daysUntil(gauge.nextDue);
              const bucket =
                days < 0
                  ? 'Overdue'
                  : days === 0
                    ? 'Today'
                    : days <= 7
                      ? 'Next 7 days'
                      : days <= 30
                        ? 'Next 30 days'
                        : 'Later';
              return (
                <article key={gauge.id} className="timeline-row">
                  <div className={`timeline-date ${calibrationTone(gauge)}`}>
                    <strong>
                      {formatDate(gauge.nextDue, { day: '2-digit' })}
                    </strong>
                    <span>{formatDate(gauge.nextDue, { month: 'short' })}</span>
                  </div>
                  <div className="timeline-info">
                    <p>{bucket}</p>
                    <button onClick={() => openGauge(gauge.id)}>
                      <strong>
                        {gauge.assetId} · {gauge.name}
                      </strong>
                      <small>
                        <MapPin size={12} />
                        {gauge.location} · {gauge.custodian || 'No custodian'}
                      </small>
                    </button>
                  </div>
                  <StatusPill gauge={gauge} />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sending === gauge.id}
                    onClick={() => sendReminder(gauge)}
                  >
                    {sending === gauge.id ? (
                      <RefreshCw className="spin" />
                    ) : (
                      <Send />
                    )}
                    Remind
                  </Button>
                </article>
              );
            })}
          </div>
        </div>
        <aside className="schedule-sidebar">
          <section className="panel reminder-rules">
            <div className="panel-heading">
              <div>
                <h2>Reminder rules</h2>
                <p>Stored with this workspace</p>
              </div>
            </div>
            <div>
              {state.settings.reminderRules.map((rule) => (
                <label key={rule.id}>
                  <input
                    type="checkbox"
                    checked={rule.active}
                    onChange={(event) => {
                      const active = event.target.checked;
                      setState((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          reminderRules: current.settings.reminderRules.map(
                            (item) =>
                              item.id === rule.id ? { ...item, active } : item,
                          ),
                        },
                        audit: appendAudit(current.audit, {
                          actor: current.settings.actorName,
                          action: 'reminder.rule_updated',
                          entityType: 'settings',
                          entityId: rule.id,
                          summary: `${rule.offsetDays === 0 ? 'Due-date' : `${rule.offsetDays}-day`} reminder ${active ? 'enabled' : 'disabled'}`,
                          before: { active: rule.active },
                          after: { active },
                        }),
                      }));
                    }}
                  />
                  <span>
                    <strong>
                      {rule.offsetDays === 0
                        ? 'On the due date'
                        : `${rule.offsetDays} days before`}
                    </strong>
                    <small>
                      To{' '}
                      {rule.recipient === 'custodian'
                        ? 'the gauge custodian'
                        : 'quality manager'}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </section>
          <section className="panel webhook-card">
            <span>
              <Zap size={19} />
            </span>
            <h3>
              {state.settings.reminderWebhook
                ? 'Delivery connected'
                : 'Connect automatic delivery'}
            </h3>
            <p>
              {state.settings.reminderWebhook
                ? 'Remind buttons send a JSON payload to your configured email automation webhook.'
                : 'Without a webhook, GaugeBase opens a ready-to-send email draft. Add a Make, Zapier, n8n, or private endpoint in Settings for direct delivery.'}
            </p>
            <Button variant="outline" onClick={() => goTo('settings')}>
              <Settings />
              Open settings
            </Button>
          </section>
        </aside>
      </section>
    </>
  );
}

function LabelsView({
  state,
  setState,
  initialGaugeId,
  toast,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  initialGaugeId?: string;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const [gaugeId, setGaugeId] = useState(initialGaugeId ?? state.gauges[0]?.id);
  const gauge =
    state.gauges.find((item) => item.id === gaugeId) ?? state.gauges[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!gauge || !canvasRef.current || !barcodeRef.current) return;
    const base =
      typeof window === 'undefined'
        ? ''
        : `${window.location.origin}${window.location.pathname}`;
    QRCode.toCanvas(
      canvasRef.current,
      `${base}#asset=${encodeURIComponent(gauge.token)}`,
      {
        width: 190,
        margin: 1,
        color: { dark: '#17231f', light: '#ffffff' },
        errorCorrectionLevel: 'M',
      },
    ).catch(() => undefined);
    try {
      JsBarcode(barcodeRef.current, gauge.assetId, {
        format: 'CODE128',
        lineColor: '#17231f',
        background: '#ffffff',
        width: 1.5,
        height: 42,
        margin: 0,
        displayValue: false,
      });
    } catch {
      /* invalid codes are surfaced by the text label */
    }
  }, [gauge]);
  if (!gauge)
    return (
      <EmptyState
        icon={QrCode}
        title="No gauges to label"
        detail="Add a gauge to create privacy-safe labels."
      />
    );
  const issueLabel = (kind: 'download' | 'print') => {
    setState((current) => ({
      ...current,
      audit: appendAudit(current.audit, {
        actor: current.settings.actorName,
        action: `label.${kind === 'print' ? 'printed' : 'downloaded'}`,
        entityType: 'label',
        entityId: gauge.id,
        summary: `${kind === 'print' ? 'Print prepared' : 'QR downloaded'} for ${gauge.assetId}`,
        after: {
          assetId: gauge.assetId,
          dueSnapshot: gauge.nextDue,
          token: gauge.token,
        },
      }),
    }));
    if (kind === 'download' && canvasRef.current)
      downloadLabelPng(canvasRef.current, gauge.assetId);
    else window.print();
    toast(
      kind === 'download' ? 'QR downloaded' : 'Print dialog opened',
      `Label issue recorded for ${gauge.assetId}.`,
    );
  };
  return (
    <>
      <ViewHeading
        eyebrow="Scan-first control"
        title="Labels"
        description="Create privacy-safe QR and Code 128 labels. Scans resolve the live record instead of exposing sensitive fields."
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={() => issueLabel('download')}
            >
              <Download />
              Download QR
            </Button>
            <Button size="lg" onClick={() => issueLabel('print')}>
              <QrCode />
              Print label
            </Button>
          </>
        }
      />
      <section className="labels-layout">
        <div className="panel label-picker">
          <div className="panel-heading">
            <div>
              <h2>Choose a gauge</h2>
              <p>{state.gauges.length} label-ready records</p>
            </div>
          </div>
          <div className="label-search">
            <Search size={16} />
            <select
              aria-label="Choose a gauge"
              value={gauge.id}
              onChange={(event) => setGaugeId(event.target.value)}
            >
              {state.gauges
                .filter((item) => item.lifecycle !== 'retired')
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.assetId} · {item.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="label-gauge-list">
            {state.gauges
              .filter((item) => item.lifecycle !== 'retired')
              .map((item) => (
                <button
                  key={item.id}
                  className={item.id === gauge.id ? 'active' : ''}
                  onClick={() => setGaugeId(item.id)}
                >
                  <span>
                    <Gauge size={17} />
                  </span>
                  <div>
                    <strong>{item.assetId}</strong>
                    <p>{item.name}</p>
                  </div>
                  <StatusPill gauge={item} />
                </button>
              ))}
          </div>
        </div>
        <div className="label-preview-area">
          <div className="preview-caption">
            <div>
              <span>50 × 25 mm · Compact asset label</span>
              <strong>Print preview</strong>
            </div>
            <p>
              Encoded payload uses an opaque token. Custodian email, serial
              number, and internal IDs are not embedded.
            </p>
          </div>
          <div className="label-stage label-print-area">
            <div className="asset-label">
              <div className="label-main">
                <div className="label-brand">
                  <span>
                    <Gauge size={15} />
                  </span>
                  <strong>GaugeBase</strong>
                </div>
                <div className="label-title">
                  <strong>{gauge.assetId}</strong>
                  <p>{gauge.name}</p>
                </div>
                <div className="label-status">
                  <StatusPill gauge={gauge} />
                  <span>
                    Due{' '}
                    {formatDate(gauge.nextDue, {
                      month: 'short',
                      day: '2-digit',
                      year: 'numeric',
                    })}
                  </span>
                </div>
                <svg ref={barcodeRef} className="barcode" />
              </div>
              <div className="label-qr">
                <canvas ref={canvasRef} />
                <small>SCAN FOR LIVE RECORD</small>
              </div>
            </div>
          </div>
          <div className="label-notes">
            <div>
              <ShieldCheck />
              <span>
                <strong>Privacy by design</strong>
                <p>
                  The QR contains only an opaque record token and the app URL.
                </p>
              </span>
            </div>
            <div>
              <RefreshCw />
              <span>
                <strong>Live status wins</strong>
                <p>
                  After dates change, a scan shows current status and
                  distinguishes the printed snapshot.
                </p>
              </span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function AuditView({
  state,
  exportAudit,
}: {
  state: AppState;
  exportAudit: () => void;
}) {
  const [query, setQuery] = useState('');
  const entries = [...state.audit]
    .reverse()
    .filter((entry) =>
      [entry.actor, entry.action, entry.summary, entry.entityId]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const valid = verifyAuditChain(state.audit);
  return (
    <>
      <ViewHeading
        eyebrow="Append-only application history"
        title="Audit log"
        description="Every record change, calibration, file, label, reminder, import, and export is linked into a verifiable SHA-256 chain."
        actions={
          <Button variant="outline" size="lg" onClick={exportAudit}>
            <Download />
            Export with hashes
          </Button>
        }
      />
      <div className={`integrity-banner ${valid ? 'valid' : 'invalid'}`}>
        <span>{valid ? <ShieldCheck /> : <AlertTriangle />}</span>
        <div>
          <strong>
            {valid ? 'History chain verified' : 'History verification failed'}
          </strong>
          <p>
            {valid
              ? `${state.audit.length} entries link correctly from the genesis record to ${state.audit.at(-1)?.hash.slice(0, 12)}…`
              : 'At least one entry has changed or no longer links to its predecessor. Export the log and investigate before relying on it.'}
          </p>
        </div>
        <code>SHA-256</code>
      </div>
      <section className="panel audit-panel">
        <div className="table-toolbar">
          <label>
            <Search size={16} />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search actors, actions, records…"
            />
          </label>
          <span>
            <Hash size={15} />
            {entries.length} entries
          </span>
        </div>
        <div className="audit-list">
          {entries.map((entry) => (
            <details key={entry.id}>
              <summary>
                <span className={`audit-icon ${entry.entityType}`}>
                  <History size={15} />
                </span>
                <div>
                  <strong>{entry.summary}</strong>
                  <p>
                    {entry.actor} · {relativeTime(entry.timestamp)}
                  </p>
                </div>
                <code>{entry.hash.slice(0, 10)}</code>
                <ArrowDownToLine size={15} />
              </summary>
              <div className="audit-detail">
                <dl>
                  <div>
                    <dt>Action</dt>
                    <dd>{entry.action}</dd>
                  </div>
                  <div>
                    <dt>Entity</dt>
                    <dd>
                      {entry.entityType} · {entry.entityId}
                    </dd>
                  </div>
                  <div>
                    <dt>UTC timestamp</dt>
                    <dd>{entry.timestamp}</dd>
                  </div>
                  <div>
                    <dt>Previous hash</dt>
                    <dd>
                      <code>{entry.previousHash}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Entry hash</dt>
                    <dd>
                      <code>{entry.hash}</code>
                    </dd>
                  </div>
                </dl>
                {(entry.before !== undefined || entry.after !== undefined) && (
                  <div className="json-diff">
                    {entry.before !== undefined && (
                      <div>
                        <span>Before</span>
                        <pre>{JSON.stringify(entry.before, null, 2)}</pre>
                      </div>
                    )}
                    {entry.after !== undefined && (
                      <div>
                        <span>After</span>
                        <pre>{JSON.stringify(entry.after, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      </section>
      <div className="claim-note">
        <Info size={17} />
        <p>
          <strong>Tamper-evident, not tamper-proof.</strong> The hash chain
          makes accidental or unauthorized edits detectable in exported history.
          A device administrator can still replace local storage, so independent
          backups remain essential.
        </p>
      </div>
    </>
  );
}

function SettingsView({
  state,
  setState,
  toast,
}: {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const [password, setPassword] = useState('');
  const restoreRef = useRef<HTMLInputElement>(null);
  const saveSettings = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setState((current) => {
      const settings = {
        ...current.settings,
        organizationName: formText(data, 'organizationName'),
        actorName: formText(data, 'actorName'),
        actorEmail: formText(data, 'actorEmail'),
        qualityManagerEmail: formText(data, 'qualityManagerEmail'),
        dueSoonDays: Number(data.get('dueSoonDays')) || 30,
        reminderWebhook: formText(data, 'reminderWebhook'),
        certificatePrefix: formText(data, 'certificatePrefix') || 'GB',
      };
      return {
        ...current,
        settings,
        audit: appendAudit(current.audit, {
          actor: settings.actorName,
          action: 'settings.updated',
          entityType: 'settings',
          entityId: 'workspace',
          summary: 'Workspace settings updated',
          before: current.settings,
          after: settings,
        }),
      };
    });
    toast(
      'Settings saved',
      'Workspace identity and reminder delivery are updated.',
    );
  };
  const backup = async () => {
    await exportEncryptedBackup(state, password);
    setState((current) => ({
      ...current,
      settings: { ...current.settings, lastBackupAt: isoNow() },
      audit: appendAudit(current.audit, {
        actor: current.settings.actorName,
        action: 'backup.exported',
        entityType: 'backup',
        entityId: uid('backup'),
        summary: `${password ? 'Encrypted' : 'Unencrypted'} workspace backup exported`,
        after: {
          encrypted: Boolean(password),
          gauges: current.gauges.length,
          calibrations: current.calibrations.length,
          attachments: current.attachments.length,
        },
      }),
    }));
    toast(
      password ? 'Encrypted backup downloaded' : 'Backup downloaded',
      password
        ? 'Keep the password separately; GaugeBase cannot recover it.'
        : 'Add a password before exporting to encrypt the archive.',
    );
  };
  const restore = async (file: File) => {
    try {
      const restored = await importBackup(await file.text(), password);
      if (
        restored?.schemaVersion !== 1 ||
        !Array.isArray(restored.gauges) ||
        !Array.isArray(restored.audit)
      )
        throw new Error('This file is not a supported GaugeBase workspace.');
      setState({
        ...restored,
        audit: appendAudit(restored.audit, {
          actor: restored.settings.actorName,
          action: 'backup.restored',
          entityType: 'backup',
          entityId: uid('backup'),
          summary: 'Workspace restored from portable backup',
        }),
      });
      toast(
        'Workspace restored',
        `${restored.gauges.length} gauges and ${restored.calibrations.length} calibrations loaded.`,
      );
    } catch (error) {
      toast(
        'Restore failed',
        error instanceof Error
          ? error.message
          : 'The backup could not be opened.',
        'danger',
      );
    }
  };
  return (
    <>
      <ViewHeading
        eyebrow="Workspace control"
        title="Settings"
        description="Configure identity and integrations, then protect the complete portable record set."
      />
      <form onSubmit={saveSettings} className="settings-grid">
        <section className="panel settings-section">
          <div className="settings-title">
            <span>
              <Database />
            </span>
            <div>
              <h2>Workspace identity</h2>
              <p>
                Used in certificates, reminders, exports, and audit entries.
              </p>
            </div>
          </div>
          <div className="settings-fields">
            <FormField label="Organization name">
              <Input
                name="organizationName"
                defaultValue={state.settings.organizationName}
                required
              />
            </FormField>
            <FormField label="Current operator">
              <Input
                name="actorName"
                defaultValue={state.settings.actorName}
                required
              />
            </FormField>
            <FormField label="Operator email">
              <Input
                name="actorEmail"
                type="email"
                defaultValue={state.settings.actorEmail}
              />
            </FormField>
            <FormField label="Quality manager email">
              <Input
                name="qualityManagerEmail"
                type="email"
                defaultValue={state.settings.qualityManagerEmail}
              />
            </FormField>
            <FormField label="Default due-soon window">
              <div className="input-suffix">
                <Input
                  name="dueSoonDays"
                  type="number"
                  min="1"
                  max="365"
                  defaultValue={state.settings.dueSoonDays}
                />
                <span>days</span>
              </div>
            </FormField>
            <FormField label="Certificate prefix">
              <Input
                name="certificatePrefix"
                defaultValue={state.settings.certificatePrefix}
                maxLength={12}
              />
            </FormField>
          </div>
        </section>
        <section className="panel settings-section">
          <div className="settings-title">
            <span>
              <Zap />
            </span>
            <div>
              <h2>Email reminder delivery</h2>
              <p>
                Optional HTTP webhook for direct delivery; leave blank for
                mail-client drafts.
              </p>
            </div>
          </div>
          <div className="settings-fields one-column">
            <FormField
              label="Reminder webhook URL"
              hint="GaugeBase sends JSON with to, subject, text, and gauge fields. Stored only on this device."
            >
              <Input
                name="reminderWebhook"
                type="url"
                placeholder="https://your-automation.example/webhook/…"
                defaultValue={state.settings.reminderWebhook}
              />
            </FormField>
            <div className="webhook-payload">
              <code>POST</code>
              <pre>{`{ "to": "custodian@example.com",\n  "subject": "Calibration due: DIM-042",\n  "text": "…", "gauge": { "assetId": "DIM-042" } }`}</pre>
            </div>
          </div>
        </section>
        <div className="settings-save">
          <Button size="lg" type="submit">
            <CheckCircle2 />
            Save workspace settings
          </Button>
        </div>
      </form>
      <section className="panel backup-section">
        <div className="settings-title">
          <span>
            <LockKeyhole />
          </span>
          <div>
            <h2>Portable backup & restore</h2>
            <p>
              One lossless archive contains gauges, calibrations, attachments,
              settings, and the complete hash-linked audit log.
            </p>
          </div>
          <span className="last-backup">
            {state.settings.lastBackupAt
              ? `Last backup ${relativeTime(state.settings.lastBackupAt)}`
              : 'No backup recorded yet'}
          </span>
        </div>
        <div className="backup-actions">
          <FormField
            label="Optional encryption password"
            hint="AES-256-GCM with PBKDF2-SHA256. There is no password recovery."
          >
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Protect this export…"
            />
          </FormField>
          <Button size="lg" onClick={backup}>
            <FileArchive />
            {password ? 'Export encrypted backup' : 'Export backup'}
          </Button>
          <input
            ref={restoreRef}
            hidden
            type="file"
            accept=".json,.gaugebase,application/json"
            onChange={(event) =>
              event.target.files?.[0] && restore(event.target.files[0])
            }
          />
          <Button
            variant="outline"
            size="lg"
            onClick={() => restoreRef.current?.click()}
          >
            <RotateCcw />
            Restore backup
          </Button>
        </div>
      </section>
      <section className="compliance-panel">
        <div>
          <ShieldCheck />
        </div>
        <span>
          <strong>
            Built to support controlled recordkeeping—not to make compliance
            claims.
          </strong>
          <p>
            GaugeBase preserves records, revisions, approvals, and exportable
            evidence. Your organization remains responsible for validated
            procedures, access controls, uncertainty and decision rules,
            qualified review, retention, electronic signatures, and backups.
          </p>
        </span>
      </section>
    </>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="form-field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function GaugeDialog({
  open,
  onOpenChange,
  state,
  editing,
  onSave,
  toast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppState;
  editing?: GaugeRecord;
  onSave: (gauge: GaugeRecord, previous?: GaugeRecord) => void;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const assetId = formText(data, 'assetId').trim().toUpperCase();
    if (
      state.gauges.some(
        (gauge) =>
          gauge.id !== editing?.id &&
          gauge.assetId.toLowerCase() === assetId.toLowerCase(),
      )
    ) {
      toast(
        'Asset ID already exists',
        'Asset IDs must be unique inside this workspace.',
        'danger',
      );
      return;
    }
    const lastCalibrated = formText(data, 'lastCalibrated') || undefined;
    const intervalMonths = Number(data.get('intervalMonths')) || 12;
    const enteredDue = formText(data, 'nextDue') || undefined;
    const nextDue =
      enteredDue ??
      (lastCalibrated
        ? addMonthsClamped(lastCalibrated, intervalMonths)
        : undefined);
    const now = isoNow();
    const gauge: GaugeRecord = {
      id: editing?.id ?? uid('gauge'),
      token: editing?.token ?? uid('token'),
      assetId,
      name: formText(data, 'name').trim(),
      type:
        data.get('type') === 'reference-standard'
          ? 'reference-standard'
          : 'measuring-equipment',
      manufacturer: formText(data, 'manufacturer').trim(),
      model: formText(data, 'model').trim(),
      serial: formText(data, 'serial').trim(),
      range: formText(data, 'range').trim(),
      unit: formText(data, 'unit').trim(),
      location: formText(data, 'location').trim(),
      custodian: formText(data, 'custodian').trim(),
      custodianEmail: formText(data, 'custodianEmail').trim(),
      intervalMonths,
      dueSoonDays:
        Number(data.get('dueSoonDays')) || state.settings.dueSoonDays,
      lastCalibrated,
      nextDue,
      lifecycle: formText(data, 'lifecycle') as GaugeRecord['lifecycle'],
      procedure: formText(data, 'procedure').trim(),
      notes: formText(data, 'notes').trim(),
      attachmentIds: editing?.attachmentIds ?? [],
      createdAt: editing?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(gauge, editing);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="record-dialog"
        key={`${editing?.id ?? 'new'}-${open}`}
      >
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${editing.assetId}` : 'Add a gauge'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes create a before-and-after audit entry.'
              : 'Create a controlled equipment record. You can attach procedures and certificates after saving.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="record-form">
          <div className="form-section">
            <h3>Identity</h3>
            <div className="form-grid">
              <FormField label="Asset ID">
                <Input
                  name="assetId"
                  defaultValue={editing?.assetId}
                  placeholder="DIM-042"
                  required
                />
              </FormField>
              <FormField label="Instrument name">
                <Input
                  name="name"
                  defaultValue={editing?.name}
                  placeholder="Digital micrometer 0–25 mm"
                  required
                />
              </FormField>
              <FormField label="Record type">
                <select
                  name="type"
                  defaultValue={editing?.type ?? 'measuring-equipment'}
                >
                  <option value="measuring-equipment">
                    Measuring equipment
                  </option>
                  <option value="reference-standard">Reference standard</option>
                </select>
              </FormField>
              <FormField label="Lifecycle status">
                <select
                  name="lifecycle"
                  defaultValue={editing?.lifecycle ?? 'active'}
                >
                  <option value="active">Active</option>
                  <option value="restricted">Restricted use</option>
                  <option value="out-of-service">Out of service</option>
                  <option value="inactive">Inactive</option>
                  <option value="retired">Retired</option>
                </select>
              </FormField>
              <FormField label="Manufacturer">
                <Input
                  name="manufacturer"
                  defaultValue={editing?.manufacturer}
                />
              </FormField>
              <FormField label="Model">
                <Input name="model" defaultValue={editing?.model} />
              </FormField>
              <FormField label="Serial number">
                <Input name="serial" defaultValue={editing?.serial} />
              </FormField>
              <FormField label="Range">
                <Input
                  name="range"
                  defaultValue={editing?.range}
                  placeholder="0–25"
                />
              </FormField>
              <FormField label="Primary unit">
                <Input
                  name="unit"
                  defaultValue={editing?.unit}
                  placeholder="mm"
                />
              </FormField>
            </div>
          </div>
          <div className="form-section">
            <h3>Control</h3>
            <div className="form-grid">
              <FormField label="Location">
                <Input name="location" defaultValue={editing?.location} />
              </FormField>
              <FormField label="Custodian">
                <Input name="custodian" defaultValue={editing?.custodian} />
              </FormField>
              <FormField label="Custodian email">
                <Input
                  name="custodianEmail"
                  type="email"
                  defaultValue={editing?.custodianEmail}
                />
              </FormField>
              <FormField label="Procedure / revision">
                <Input
                  name="procedure"
                  defaultValue={editing?.procedure}
                  placeholder="CAL-DIM-04 · Rev C"
                />
              </FormField>
              <FormField label="Calibration interval">
                <div className="input-suffix">
                  <Input
                    name="intervalMonths"
                    type="number"
                    min="1"
                    max="120"
                    defaultValue={editing?.intervalMonths ?? 12}
                    required
                  />
                  <span>months</span>
                </div>
              </FormField>
              <FormField label="Due-soon window">
                <div className="input-suffix">
                  <Input
                    name="dueSoonDays"
                    type="number"
                    min="1"
                    max="365"
                    defaultValue={
                      editing?.dueSoonDays ?? state.settings.dueSoonDays
                    }
                  />
                  <span>days</span>
                </div>
              </FormField>
              <FormField label="Last calibrated">
                <Input
                  name="lastCalibrated"
                  type="date"
                  defaultValue={editing?.lastCalibrated}
                />
              </FormField>
              <FormField
                label="Next due"
                hint="Leave blank to calculate from last calibrated + interval."
              >
                <Input
                  name="nextDue"
                  type="date"
                  defaultValue={editing?.nextDue}
                />
              </FormField>
            </div>
            <FormField label="Notes">
              <Textarea
                name="notes"
                defaultValue={editing?.notes}
                rows={3}
                placeholder="Handling limitations, storage instructions, or context…"
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              <CheckCircle2 />
              {editing ? 'Save changes' : 'Add to register'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CalibrationDialog({
  gaugeId,
  state,
  onClose,
  onSave,
  toast,
}: {
  gaugeId?: string;
  state: AppState;
  onClose: () => void;
  onSave: (record: CalibrationRecord, gauge: GaugeRecord) => void;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const [selectedId, setSelectedId] = useState(gaugeId);
  const [result, setResult] = useState<CalibrationResult>('pass');
  const [readings, setReadings] = useState<Reading[]>([
    {
      id: uid('reading'),
      characteristic: '',
      nominal: '',
      lowerLimit: '',
      upperLimit: '',
      asFound: '',
      asLeft: '',
      unit: '',
    },
  ]);
  useEffect(() => {
    setSelectedId(gaugeId);
    setResult('pass');
    setReadings([
      {
        id: uid('reading'),
        characteristic: '',
        nominal: '',
        lowerLimit: '',
        upperLimit: '',
        asFound: '',
        asLeft: '',
        unit: '',
      },
    ]);
  }, [gaugeId]);
  const gauge = state.gauges.find((item) => item.id === selectedId);
  const updateReading = (id: string, field: keyof Reading, value: string) =>
    setReadings((current) =>
      current.map((reading) =>
        reading.id === id ? { ...reading, [field]: value } : reading,
      ),
    );
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!gauge) return;
    const data = new FormData(event.currentTarget);
    const performedOn = formText(data, 'performedOn');
    const usefulReadings = readings.filter((reading) =>
      Object.entries(reading).some(([key, value]) => key !== 'id' && value),
    );
    if (
      usefulReadings.some(
        (reading) => Number(reading.lowerLimit) > Number(reading.upperLimit),
      )
    )
      return toast(
        'Reading limits are invalid',
        'Every lower limit must be less than or equal to its upper limit.',
        'danger',
      );
    if (
      result === 'pass' &&
      usefulReadings.some((reading) => readingResult(reading) === 'fail')
    )
      return toast(
        'Overall pass conflicts with readings',
        'At least one reading is outside its stored limits. Use Fail or Conditional pass.',
        'danger',
      );
    const condition = formText(data, 'condition').trim();
    const restrictionExpiry = formText(data, 'restrictionExpiry').trim();
    const approvedBy = formText(data, 'approvedBy').trim();
    if (
      result === 'conditional' &&
      (!condition || !restrictionExpiry || !approvedBy)
    )
      return toast(
        'Conditional approval is incomplete',
        'Record the limitation, review date, and approving manager.',
        'danger',
      );
    const sequence = String(state.calibrations.length + 1).padStart(4, '0');
    const base = {
      id: uid('calibration'),
      eventNumber: `EVT-${new Date().getFullYear()}-${sequence}`,
      gaugeId: gauge.id,
      performedOn,
      result,
      technician: formText(data, 'technician').trim(),
      procedureRevision: formText(data, 'procedureRevision').trim(),
      environmentalConditions: formText(data, 'environmentalConditions').trim(),
      standardReferences: formText(data, 'standardReferences').trim(),
      readings: usefulReadings,
      notes: formText(data, 'notes').trim(),
      condition: result === 'conditional' ? condition : undefined,
      restrictionExpiry:
        result === 'conditional' ? restrictionExpiry : undefined,
      approvedBy: result === 'conditional' ? approvedBy : undefined,
      certificateNumber: `${state.settings.certificatePrefix}-${new Date().getFullYear()}-${sequence}`,
      attachmentIds: [],
      createdAt: isoNow(),
    };
    const record: CalibrationRecord = {
      ...base,
      certificateHash: hashValue(base),
    };
    const nextDue =
      result === 'fail'
        ? gauge.nextDue
        : addMonthsClamped(performedOn, gauge.intervalMonths);
    const updatedGauge: GaugeRecord = {
      ...gauge,
      lastCalibrated: performedOn,
      nextDue,
      lifecycle:
        result === 'fail'
          ? 'out-of-service'
          : result === 'conditional'
            ? 'restricted'
            : 'active',
      updatedAt: isoNow(),
    };
    onSave(record, updatedGauge);
    onClose();
  };
  return (
    <Dialog open={Boolean(gaugeId)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="record-dialog calibration-dialog">
        <DialogHeader>
          <DialogTitle>Record calibration</DialogTitle>
          <DialogDescription>
            Completed records are preserved. Corrections should be made with a
            new superseding record, never a silent edit.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="record-form">
          <div className="calibration-banner">
            <FormField label="Gauge">
              <select
                value={selectedId ?? ''}
                onChange={(event) => setSelectedId(event.target.value)}
                required
              >
                {state.gauges
                  .filter((item) => item.lifecycle !== 'retired')
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.assetId} · {item.name}
                    </option>
                  ))}
              </select>
            </FormField>
            {gauge && (
              <div>
                <StatusPill gauge={gauge} />
                <span>Current due date: {formatDate(gauge.nextDue)}</span>
              </div>
            )}
          </div>
          <div className="form-section">
            <h3>Outcome & context</h3>
            <div className="result-choices">
              {(['pass', 'conditional', 'fail'] as CalibrationResult[]).map(
                (item) => (
                  <label
                    className={`${item} ${result === item ? 'active' : ''}`}
                    key={item}
                  >
                    <input
                      type="radio"
                      name="result"
                      value={item}
                      checked={result === item}
                      onChange={() => setResult(item)}
                    />
                    <span>
                      {item === 'pass' ? (
                        <CheckCircle2 />
                      ) : item === 'fail' ? (
                        <AlertTriangle />
                      ) : (
                        <Info />
                      )}
                    </span>
                    <strong>
                      {item === 'conditional'
                        ? 'Conditional pass'
                        : item[0].toUpperCase() + item.slice(1)}
                    </strong>
                    <small>
                      {item === 'pass'
                        ? 'Available for intended use'
                        : item === 'fail'
                          ? 'Place out of service'
                          : 'Restricted use with approval'}
                    </small>
                  </label>
                ),
              )}
            </div>
            <div className="form-grid">
              <FormField label="Performed on">
                <Input
                  name="performedOn"
                  type="date"
                  defaultValue={todayIso()}
                  max={todayIso()}
                  required
                />
              </FormField>
              <FormField label="Technician / provider">
                <Input
                  name="technician"
                  defaultValue={state.settings.actorName}
                  required
                />
              </FormField>
              <FormField label="Procedure revision">
                <Input
                  name="procedureRevision"
                  defaultValue={gauge?.procedure}
                  required
                />
              </FormField>
              <FormField label="Environmental conditions">
                <Input
                  name="environmentalConditions"
                  placeholder="20.4 °C · 48% RH"
                />
              </FormField>
            </div>
            <FormField
              label="Reference standards and validity"
              hint="Record the organization-supplied reference, certificate, and validity date. This field does not independently establish traceability."
            >
              <Textarea
                name="standardReferences"
                placeholder="DIM-STD-004 · Certificate 24-1987 · Valid through 2027-03-22"
                required
              />
            </FormField>
          </div>
          <div className="form-section">
            <div className="section-heading">
              <div>
                <h3>Measurement readings</h3>
                <p>
                  Optional for summary records. As-left is evaluated when
                  present; otherwise as-found.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setReadings((current) => [
                    ...current,
                    {
                      id: uid('reading'),
                      characteristic: '',
                      nominal: '',
                      lowerLimit: '',
                      upperLimit: '',
                      asFound: '',
                      asLeft: '',
                      unit: gauge?.unit ?? '',
                    },
                  ])
                }
              >
                <Plus />
                Add point
              </Button>
            </div>
            <div className="reading-table">
              <div className="reading-header">
                <span>Characteristic</span>
                <span>Nominal</span>
                <span>Lower</span>
                <span>Upper</span>
                <span>As found</span>
                <span>As left</span>
                <span>Unit</span>
                <span />
              </div>
              {readings.map((reading) => (
                <div className="reading-row" key={reading.id}>
                  <Input
                    aria-label="Characteristic"
                    value={reading.characteristic}
                    onChange={(event) =>
                      updateReading(
                        reading.id,
                        'characteristic',
                        event.target.value,
                      )
                    }
                    placeholder="Point"
                  />
                  <Input
                    aria-label="Nominal"
                    inputMode="decimal"
                    value={reading.nominal}
                    onChange={(event) =>
                      updateReading(reading.id, 'nominal', event.target.value)
                    }
                  />
                  <Input
                    aria-label="Lower limit"
                    inputMode="decimal"
                    value={reading.lowerLimit}
                    onChange={(event) =>
                      updateReading(
                        reading.id,
                        'lowerLimit',
                        event.target.value,
                      )
                    }
                  />
                  <Input
                    aria-label="Upper limit"
                    inputMode="decimal"
                    value={reading.upperLimit}
                    onChange={(event) =>
                      updateReading(
                        reading.id,
                        'upperLimit',
                        event.target.value,
                      )
                    }
                  />
                  <Input
                    aria-label="As found"
                    inputMode="decimal"
                    value={reading.asFound}
                    onChange={(event) =>
                      updateReading(reading.id, 'asFound', event.target.value)
                    }
                  />
                  <Input
                    aria-label="As left"
                    inputMode="decimal"
                    value={reading.asLeft}
                    onChange={(event) =>
                      updateReading(reading.id, 'asLeft', event.target.value)
                    }
                  />
                  <Input
                    aria-label="Unit"
                    value={reading.unit}
                    onChange={(event) =>
                      updateReading(reading.id, 'unit', event.target.value)
                    }
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setReadings((current) =>
                        current.length > 1
                          ? current.filter((item) => item.id !== reading.id)
                          : current,
                      )
                    }
                    aria-label="Remove reading"
                  >
                    <X />
                  </button>
                </div>
              ))}
            </div>
          </div>
          {result === 'conditional' && (
            <div className="form-section conditional-fields">
              <h3>Required restricted-use approval</h3>
              <div className="form-grid">
                <FormField label="Use limitation">
                  <Input
                    name="condition"
                    placeholder="Use only for measurements ≤ 300 mm"
                    required
                  />
                </FormField>
                <FormField label="Restriction review / expiry">
                  <Input
                    name="restrictionExpiry"
                    type="date"
                    min={todayIso()}
                    required
                  />
                </FormField>
                <FormField label="Approved by">
                  <Input
                    name="approvedBy"
                    placeholder="Quality manager name"
                    required
                  />
                </FormField>
              </div>
            </div>
          )}
          <div className="form-section">
            <FormField label="Calibration notes">
              <Textarea
                name="notes"
                placeholder="Adjustment, observations, deviations, or impact assessment…"
                rows={3}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <FileCheck2 />
              Complete & create certificate
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ImportDialog({
  open,
  onOpenChange,
  state,
  setState,
  toast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
  toast: (title: string, detail?: string, tone?: ToastMessage['tone']) => void;
}) {
  const [preview, setPreview] = useState<CsvPreview>();
  const [filename, setFilename] = useState('');
  const readFile = async (file: File) => {
    setFilename(file.name);
    setPreview(parseGaugeCsv(await file.text(), state.gauges));
  };
  const commit = () => {
    if (!preview || preview.errors.length) return;
    const gauges = preview.rows.map(importedGauge);
    setState((current) => ({
      ...current,
      gauges: [...current.gauges, ...gauges],
      audit: appendAudit(current.audit, {
        actor: current.settings.actorName,
        action: 'import.gauges_committed',
        entityType: 'import',
        entityId: uid('import'),
        summary: `${gauges.length} gauge records imported from ${filename}`,
        after: { filename, created: gauges.length, rejected: 0 },
      }),
    }));
    onOpenChange(false);
    setPreview(undefined);
    setFilename('');
    toast('CSV import complete', `${gauges.length} records added atomically.`);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setPreview(undefined);
          setFilename('');
        }
      }}
    >
      <DialogContent className="import-dialog">
        <DialogHeader>
          <DialogTitle>Import gauge register</DialogTitle>
          <DialogDescription>
            GaugeBase validates the whole file first. No records are written
            until every row is valid.
          </DialogDescription>
        </DialogHeader>
        {!preview ? (
          <div className="import-drop">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) =>
                event.target.files?.[0] && readFile(event.target.files[0])
              }
            />
            <span>
              <Upload />
            </span>
            <strong>Choose a CSV file</strong>
            <p>UTF-8 · ISO dates (YYYY-MM-DD) · 10 MB maximum</p>
            <Button
              type="button"
              variant="outline"
              onClick={downloadCsvTemplate}
            >
              <FileDown />
              Download template
            </Button>
          </div>
        ) : (
          <div className="import-preview">
            <div
              className={`validation-summary ${preview.errors.length ? 'invalid' : 'valid'}`}
            >
              <span>
                {preview.errors.length ? <AlertTriangle /> : <CheckCircle2 />}
              </span>
              <div>
                <strong>
                  {preview.errors.length
                    ? `${preview.errors.length} issue${preview.errors.length === 1 ? '' : 's'} found`
                    : 'Dry run passed'}
                </strong>
                <p>
                  {filename} · {preview.total} source rows ·{' '}
                  {preview.rows.length} ready to create
                </p>
              </div>
            </div>
            {preview.errors.length > 0 && (
              <div className="import-errors">
                {preview.errors.map((error, index) => (
                  <p key={`${error}-${index}`}>
                    <X />
                    {error}
                  </p>
                ))}
              </div>
            )}
            <div className="import-table">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Next due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rows.slice(0, 8).map((row) => (
                    <TableRow key={row.assetId}>
                      <TableCell>
                        <strong>{row.assetId}</strong>
                      </TableCell>
                      <TableCell>{row.name}</TableCell>
                      <TableCell>{row.location || '—'}</TableCell>
                      <TableCell>{formatDate(row.nextDue)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {preview.rows.length > 8 && (
                <p>+ {preview.rows.length - 8} more valid rows</p>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          {preview && (
            <Button
              type="button"
              disabled={preview.errors.length > 0 || preview.rows.length === 0}
              onClick={commit}
            >
              <Import />
              Commit {preview.rows.length} records
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GaugeDetailSheet({
  gauge,
  state,
  open,
  onOpenChange,
  editGauge,
  archiveGauge,
  openCalibration,
  addAttachments,
  goTo,
}: {
  gauge?: GaugeRecord;
  state: AppState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editGauge: (id: string) => void;
  archiveGauge: (gauge: GaugeRecord) => void;
  openCalibration: (id?: string) => void;
  addAttachments: (gauge: GaugeRecord, files: FileList) => Promise<void>;
  goTo: (view: View) => void;
}) {
  if (!gauge) return null;
  const records = state.calibrations
    .filter((record) => record.gaugeId === gauge.id)
    .sort((a, b) => b.performedOn.localeCompare(a.performedOn));
  const attachments = state.attachments.filter((attachment) =>
    gauge.attachmentIds.includes(attachment.id),
  );
  const history = state.audit
    .filter(
      (entry) =>
        entry.entityId === gauge.id ||
        records.some((record) => record.id === entry.entityId),
    )
    .reverse()
    .slice(0, 8);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gauge-sheet">
        <SheetHeader className="gauge-sheet-header">
          <div className="sheet-id">
            <span>
              <Gauge />
            </span>
            <div>
              <code>{gauge.assetId}</code>
              <SheetTitle>{gauge.name}</SheetTitle>
              <SheetDescription>
                {gauge.manufacturer} {gauge.model} · S/N {gauge.serial || '—'}
              </SheetDescription>
            </div>
          </div>
          <StatusPill gauge={gauge} />
        </SheetHeader>
        <div className={`sheet-status ${calibrationTone(gauge)}`}>
          <span>
            {getCalibrationState(gauge) === 'overdue' ||
            getCalibrationState(gauge) === 'failed' ? (
              <AlertTriangle />
            ) : (
              <CheckCircle2 />
            )}
          </span>
          <div>
            <strong>{dueLabel(gauge)}</strong>
            <p>
              {gauge.nextDue
                ? `Controlled due date ${formatDate(gauge.nextDue)}`
                : 'Set a due date to bring this gauge into the schedule.'}
            </p>
          </div>
        </div>
        <div className="sheet-actions">
          <Button onClick={() => openCalibration(gauge.id)}>
            <ClipboardCheck />
            Record calibration
          </Button>
          <Button variant="outline" onClick={() => editGauge(gauge.id)}>
            <Pencil />
            Edit
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              goTo('labels');
            }}
          >
            <QrCode />
            Label
          </Button>
        </div>
        <div className="sheet-scroll">
          <section className="detail-section">
            <h3>Equipment record</h3>
            <dl className="detail-grid">
              <div>
                <dt>Location</dt>
                <dd>
                  <MapPin />
                  {gauge.location || 'Unassigned'}
                </dd>
              </div>
              <div>
                <dt>Custodian</dt>
                <dd>
                  <UserRound />
                  {gauge.custodian || 'Unassigned'}
                </dd>
              </div>
              <div>
                <dt>Range</dt>
                <dd>
                  {gauge.range || '—'} {gauge.unit}
                </dd>
              </div>
              <div>
                <dt>Interval</dt>
                <dd>{gauge.intervalMonths} months</dd>
              </div>
              <div>
                <dt>Last calibrated</dt>
                <dd>{formatDate(gauge.lastCalibrated)}</dd>
              </div>
              <div>
                <dt>Next due</dt>
                <dd>{formatDate(gauge.nextDue)}</dd>
              </div>
              <div className="wide">
                <dt>Procedure</dt>
                <dd>
                  <FileText />
                  {gauge.procedure || 'No procedure assigned'}
                </dd>
              </div>
              {gauge.notes && (
                <div className="wide">
                  <dt>Notes</dt>
                  <dd>{gauge.notes}</dd>
                </div>
              )}
            </dl>
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <div>
                <h3>Attachments</h3>
                <p>
                  Certificates, procedures, photos, and supporting files. 5 MB
                  each.
                </p>
              </div>
              <label className="upload-button">
                <Paperclip />
                Attach
                <input
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,image/*,.csv,.txt"
                  onChange={(event) =>
                    event.target.files &&
                    addAttachments(gauge, event.target.files)
                  }
                />
              </label>
            </div>
            {attachments.length === 0 ? (
              <div className="mini-empty">
                <Paperclip />
                <span>
                  <strong>No attachments yet</strong>
                  <p>Files are stored only in this browser workspace.</p>
                </span>
              </div>
            ) : (
              <div className="attachment-list">
                {attachments.map((attachment) => (
                  <button
                    key={attachment.id}
                    onClick={() =>
                      downloadAttachment(attachment.dataUrl, attachment.name)
                    }
                  >
                    <span>
                      <FileText />
                    </span>
                    <div>
                      <strong>{attachment.name}</strong>
                      <p>
                        {(attachment.size / 1024).toFixed(1)} KB · SHA-256{' '}
                        {attachment.sha256.slice(0, 10)}…
                      </p>
                    </div>
                    <Download />
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="detail-section">
            <div className="section-heading">
              <div>
                <h3>Calibration history</h3>
                <p>Completed records are immutable in the application.</p>
              </div>
            </div>
            {records.length === 0 ? (
              <div className="mini-empty">
                <ClipboardCheck />
                <span>
                  <strong>No calibration history</strong>
                  <p>Record the first completed event.</p>
                </span>
              </div>
            ) : (
              <div className="record-timeline">
                {records.map((record) => (
                  <article key={record.id}>
                    <span className={`record-node ${record.result}`} />
                    <div>
                      <div>
                        <code>{record.eventNumber}</code>
                        <span className={`result-pill ${record.result}`}>
                          {record.result === 'conditional'
                            ? 'Conditional pass'
                            : record.result}
                        </span>
                      </div>
                      <strong>{formatDate(record.performedOn)}</strong>
                      <p>
                        {record.technician} · {record.procedureRevision}
                      </p>
                      {record.condition && <small>{record.condition}</small>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        generateCertificatePdf(state, record, gauge)
                      }
                      aria-label={`Download ${record.certificateNumber}`}
                    >
                      <FileDown />
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </section>
          <section className="detail-section">
            <h3>Recent change history</h3>
            <div className="mini-audit">
              {history.length === 0 ? (
                <p>No linked changes yet.</p>
              ) : (
                history.map((entry) => (
                  <div key={entry.id}>
                    <span>
                      <History />
                    </span>
                    <p>
                      <strong>{entry.summary}</strong>
                      <small>
                        {entry.actor} · {relativeTime(entry.timestamp)}
                      </small>
                    </p>
                    <code>{entry.hash.slice(0, 8)}</code>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
        <SheetFooter className="gauge-sheet-footer">
          <Button
            variant="destructive"
            onClick={() => {
              if (
                window.confirm(
                  `Retire ${gauge.assetId}? Historical records will be preserved.`,
                )
              )
                archiveGauge(gauge);
            }}
          >
            <Archive />
            Retire gauge
          </Button>
          <span>Record token {gauge.token.slice(-8)}</span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
