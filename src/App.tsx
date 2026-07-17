import { useCallback, useEffect, useState } from "react";
import type { SessionRow, SessionSummary } from "../electron/db/types";
import type { DailySummary, LoggedDay, WeeklySummary } from "../electron/db/summary";
import type { EnvironmentRow } from "../electron/db/environments";
import { formatClockTime, formatDuration, ROLE_LABELS } from "./format";

/**
 * Dropdown of manageable environments. Hidden ones are excluded, but the
 * current value stays selectable even if hidden/deleted so existing logs
 * never display a wrong name.
 */
function EnvironmentSelect({
  environments,
  value,
  onChange,
}: {
  environments: EnvironmentRow[];
  value: string | null;
  onChange: (name: string | null) => void;
}) {
  const visible = environments.filter((env) => !env.hidden);
  const names = visible.map((env) => env.name);
  if (value && !names.includes(value)) names.unshift(value);

  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">—</option>
      {names.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

// Local-timezone date string — toISOString() would flip to tomorrow's UTC
// date during evening sessions and hide them from the "today" views.
function todayStr(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function splitDuration(totalSeconds: number): { h: number; m: number; s: number } {
  const seconds = Math.max(0, Math.round(totalSeconds));
  return { h: Math.floor(seconds / 3600), m: Math.floor((seconds % 3600) / 60), s: seconds % 60 };
}

function joinDuration(parts: { h: number; m: number; s: number }): number {
  const n = (v: number) => Math.max(0, Math.floor(Number(v) || 0));
  return n(parts.h) * 3600 + n(parts.m) * 60 + n(parts.s);
}

function DurationFields({
  label,
  value,
  onChange,
}: {
  label: string;
  value: { h: number; m: number; s: number };
  onChange: (v: { h: number; m: number; s: number }) => void;
}) {
  const field = (key: "h" | "m" | "s", unit: string, max?: number) => (
    <label className="duration-field">
      <input
        type="number"
        min={0}
        max={max}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
      />
      {unit}
    </label>
  );
  return (
    <div className="edit-row">
      <span className="edit-row-label">{label}</span>
      <span className="duration-fields">
        {field("h", "h")}
        {field("m", "m", 59)}
        {field("s", "s", 59)}
      </span>
    </div>
  );
}

function SessionEditForm({
  session,
  environments,
  onDone,
}: {
  session: SessionSummary;
  environments: EnvironmentRow[];
  onDone: () => void;
}) {
  const [envName, setEnvName] = useState<string | null>(session.environment_name);
  const [role, setRole] = useState(session.role);
  const [active, setActive] = useState(splitDuration(session.active_seconds));
  const [guidelines, setGuidelines] = useState(splitDuration(session.guidelines_seconds));
  const [slack, setSlack] = useState(splitDuration(session.slack_seconds));

  const save = async () => {
    await window.fleettime.editSession(session.id, {
      environmentName: envName,
      role,
      activeSeconds: joinDuration(active),
      guidelinesSeconds: joinDuration(guidelines),
      slackSeconds: joinDuration(slack),
    });
    onDone();
  };

  return (
    <div className="card session-edit">
      <div className="edit-row">
        <span className="edit-row-label">Environment</span>
        <EnvironmentSelect environments={environments} value={envName} onChange={setEnvName} />
      </div>
      <div className="edit-row">
        <span className="edit-row-label">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as SessionSummary["role"])}>
          <option value="task_writing">Task writing</option>
          <option value="qa">QA</option>
          <option value="env_qa">Environmental QA</option>
          <option value="feedback">Feedback</option>
        </select>
      </div>
      <DurationFields label="Environment time" value={active} onChange={setActive} />
      <DurationFields label="Guidelines time" value={guidelines} onChange={setGuidelines} />
      <DurationFields label="Slack time" value={slack} onChange={setSlack} />
      <div className="card-actions">
        <button type="button" className="btn-primary" onClick={save}>
          Save
        </button>
        <button type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SessionCard({
  session,
  environments,
  onChanged,
}: {
  session: SessionSummary;
  environments: EnvironmentRow[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <SessionEditForm
        session={session}
        environments={environments}
        onDone={() => {
          setEditing(false);
          onChanged();
        }}
      />
    );
  }

  const remove = async () => {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    await window.fleettime.deleteSession(session.id);
    onChanged();
  };

  return (
    <div className="card">
      <div className="card-title">{session.environment_name ?? session.task_id}</div>
      <dl>
        <dt>Started</dt>
        <dd>{formatClockTime(session.started_at)}</dd>
        <dt>Role</dt>
        <dd>{ROLE_LABELS[session.role] ?? session.role}</dd>
        <dt>Total session time</dt>
        <dd>{formatDuration(session.total_seconds)}</dd>
        <dt>Total active environment time</dt>
        <dd>{formatDuration(session.active_seconds)}</dd>
        <dt>Total guidelines time</dt>
        <dd>{formatDuration(session.guidelines_seconds)}</dd>
        <dt>Total Slack time</dt>
        <dd>{formatDuration(session.slack_seconds)}</dd>
        <dt>Environment</dt>
        <dd>
          <EnvironmentSelect
            environments={environments}
            value={session.environment_name}
            onChange={async (name) => {
              await window.fleettime.setSessionEnvironment(session.id, name);
              onChanged();
            }}
          />
        </dd>
      </dl>
      <div className="card-actions">
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button type="button" className={confirmingDelete ? "btn-danger" : ""} onClick={remove}>
          {confirmingDelete ? "Confirm delete?" : "Delete"}
        </button>
      </div>
    </div>
  );
}

function formatWeekDate(dateStr: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(
    new Date(`${dateStr}T12:00:00`)
  );
}

function WeeklySummaryView({ week }: { week: WeeklySummary }) {
  return (
    <div className="card weekly-summary">
      <h3>
        This week <span className="muted">({formatWeekDate(week.weekStart)} – {formatWeekDate(week.weekEnd)})</span>
      </h3>
      <p>Weekly time: {formatDuration(week.totalSeconds)}</p>
      <p className="daily-total">
        Total week earnings: $
        {week.totalEarnings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </p>
      <p className="muted weekly-breakdown">
        Environmental QA ${week.envQaEarnings.toFixed(2)} ({formatDuration(Math.round(week.envQaSeconds / 60) * 60)}{" "}
        @ ${week.envQaRate}/h) · Task writing &amp; QA ${week.taskQaEarnings.toFixed(2)} (
        {formatDuration(week.taskQaSeconds)} @ ${week.taskQaRate}/h)
      </p>
    </div>
  );
}

function DayNotes({ date, savedNote }: { date: string; savedNote: string }) {
  const [text, setText] = useState(savedNote);
  const [dirty, setDirty] = useState(false);

  // The dashboard refreshes every few seconds; only mirror the stored note
  // while the user isn't mid-edit, so typing never gets clobbered.
  useEffect(() => {
    if (!dirty) setText(savedNote);
  }, [savedNote, dirty]);

  const save = async () => {
    await window.fleettime.setDayNote(date, text);
    setDirty(false);
  };

  return (
    <div className="day-notes">
      <h4>Notes</h4>
      <textarea
        rows={3}
        value={text}
        placeholder="Add notes for this day…"
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
      {dirty && (
        <div className="card-actions">
          <button type="button" className="btn-primary" onClick={save}>
            Save note
          </button>
          <button
            type="button"
            onClick={() => {
              setText(savedNote);
              setDirty(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function DailySummaryView({ summary }: { summary: DailySummary }) {
  return (
    <div>
      {summary.roles.length === 0 ? (
        <p className="muted">No sessions logged yet today.</p>
      ) : (
        <>
          <h3>Sessions</h3>
          <ul className="summary-list">
            {summary.roles.map((role) => (
              <li key={role.role}>
                <strong>{ROLE_LABELS[role.role] ?? role.role}</strong> ({formatDuration(role.totalSeconds)}) —{" "}
                {role.environments
                  .map((env) => `${env.count} ${env.environmentName} (${formatDuration(env.totalSeconds)})`)
                  .join(", ")}
              </li>
            ))}
          </ul>
          <p className="daily-total">Total time: {formatDuration(summary.totalSeconds)}</p>
        </>
      )}
      <DayNotes date={summary.date} savedNote={summary.note} />
    </div>
  );
}

function CurrentSessionBar({ session }: { session: SessionRow | null }) {
  if (!session) return <div className="bar muted">No active session</div>;
  return (
    <div className={`bar state-${session.current_state}`}>
      {ROLE_LABELS[session.role] ?? session.role} · {session.environment_name ?? session.task_id} ·{" "}
      {session.current_state}
    </div>
  );
}

function EnvironmentManager({ environments }: { environments: EnvironmentRow[] }) {
  const [newName, setNewName] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);

  const add = async () => {
    if (!newName.trim()) return;
    await window.fleettime.addEnvironment(newName);
    setNewName("");
  };

  const remove = async (id: number) => {
    if (confirmingDeleteId !== id) {
      setConfirmingDeleteId(id);
      setTimeout(() => setConfirmingDeleteId((current) => (current === id ? null : current)), 4000);
      return;
    }
    await window.fleettime.deleteEnvironment(id);
    setConfirmingDeleteId(null);
  };

  return (
    <div className="env-manager">
      <h4>Environments</h4>
      <div className="env-add-row">
        <input
          type="text"
          value={newName}
          placeholder="New environment name"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button type="button" className="btn-primary" onClick={add}>
          Add
        </button>
      </div>
      {environments.map((env) => (
        <div key={env.id} className={`env-row${env.hidden ? " env-hidden" : ""}`}>
          <span className="env-name">{env.name}</span>
          <button
            type="button"
            onClick={() => window.fleettime.setEnvironmentHidden(env.id, !env.hidden)}
            title={env.hidden ? "Show in dropdowns" : "Hide from dropdowns"}
          >
            {env.hidden ? "Show" : "Hide"}
          </button>
          <button
            type="button"
            className={confirmingDeleteId === env.id ? "btn-danger" : ""}
            onClick={() => remove(env.id)}
          >
            {confirmingDeleteId === env.id ? "Confirm?" : "Delete"}
          </button>
        </div>
      ))}
    </div>
  );
}

function SettingsPanel({
  darkMode,
  onDarkModeChange,
  autoStartDisabled,
  onAutoStartDisabledChange,
  pairing,
  environments,
}: {
  darkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
  autoStartDisabled: boolean;
  onAutoStartDisabledChange: (v: boolean) => void;
  pairing: { port: number; token: string } | null;
  environments: EnvironmentRow[];
}) {
  return (
    <div className="card">
      <h3>Settings</h3>
      <label className="setting-row">
        <input type="checkbox" checked={darkMode} onChange={(e) => onDarkModeChange(e.target.checked)} />
        Dark mode
      </label>
      <label className="setting-row">
        <input
          type="checkbox"
          checked={autoStartDisabled}
          onChange={(e) => onAutoStartDisabledChange(e.target.checked)}
        />
        Disable auto-start
      </label>
      <EnvironmentManager environments={environments} />
      {pairing && (
        <div className="pairing">
          <p className="muted">
            Paste this into the FleetTime extension's options page to connect it to this app:
          </p>
          <code>
            port: {pairing.port}
            <br />
            token: {pairing.token}
          </code>
        </div>
      )}
    </div>
  );
}

function DayLogRow({ day, environments }: { day: LoggedDay; environments: EnvironmentRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<DailySummary | null>(null);

  const loadDetail = async () => {
    setDetail(await window.fleettime.getDailySummary(day.date));
  };

  const toggle = async () => {
    const next = !expanded;
    setExpanded(next);
    // Refetch on each expand so today's row is never stale.
    if (next) await loadDetail();
  };

  return (
    <div className="day-log">
      <button type="button" className="day-log-header" onClick={toggle} aria-expanded={expanded}>
        <span className={`chevron${expanded ? " open" : ""}`}>▸</span>
        <span className="day-log-date">{day.date}</span>
        <span className="day-log-meta">
          {formatDuration(day.totalSeconds)} · {day.sessionCount} log{day.sessionCount === 1 ? "" : "s"}
        </span>
      </button>
      {expanded && detail && (
        <div className="day-log-detail">
          {/* Same per-environment breakdown format as Daily summary; regroups
              automatically when logs get (re)assigned an environment later,
              since summaries are computed from session rows on every read. */}
          <DailySummaryView summary={detail} />
          {detail.sessions.map((session) => (
            <SessionCard key={session.id} session={session} environments={environments} onChanged={loadDetail} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllLogs({ days, environments }: { days: LoggedDay[]; environments: EnvironmentRow[] }) {
  return (
    <div className="card">
      <h3>All logs</h3>
      {days.length === 0 && <p className="muted">No logs yet.</p>}
      {days.map((day) => (
        <DayLogRow key={day.date} day={day} environments={environments} />
      ))}
    </div>
  );
}

export default function App() {
  const [currentSession, setCurrentSession] = useState<SessionRow | null>(null);
  const [todaySessions, setTodaySessions] = useState<SessionSummary[]>([]);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [darkMode, setDarkMode] = useState(false);
  const [autoStartDisabled, setAutoStartDisabled] = useState(false);
  const [pairing, setPairing] = useState<{ port: number; token: string } | null>(null);
  const [loggedDays, setLoggedDays] = useState<LoggedDay[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentRow[]>([]);
  const [weekly, setWeekly] = useState<WeeklySummary | null>(null);

  const refresh = useCallback(async () => {
    const [current, sessions, dailySummary, days, envs, weeklySummary] = await Promise.all([
      window.fleettime.getCurrentSession(),
      window.fleettime.getTodaySessions(),
      window.fleettime.getDailySummary(todayStr()),
      window.fleettime.getLoggedDays(),
      window.fleettime.getEnvironments(),
      window.fleettime.getWeeklySummary(),
    ]);
    setCurrentSession(current);
    setTodaySessions(sessions);
    setSummary(dailySummary);
    setLoggedDays(days);
    setEnvironments(envs);
    setWeekly(weeklySummary);
  }, []);

  useEffect(() => {
    refresh();
    window.fleettime.getConfig().then((config) => {
      setPairing({ port: config.port, token: config.token });
      setDarkMode(config.darkMode);
      setAutoStartDisabled(config.autoStartDisabled);
    });
    const unsubscribe = window.fleettime.onLiveUpdate(refresh);
    // Open sessions accrue time continuously; poll so displayed durations tick.
    const interval = setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
  }, [darkMode]);

  return (
    <div className="app">
      <CurrentSessionBar session={currentSession} />
      <div className="columns">
        <section>
          <h2>Today's sessions</h2>
          {todaySessions.length === 0 && <p className="muted">No sessions logged yet today.</p>}
          {todaySessions
            .slice()
            .reverse()
            .map((session) => (
              <SessionCard key={session.id} session={session} environments={environments} onChanged={refresh} />
            ))}
        </section>
        <section>
          <h2>Daily summary</h2>
          {summary && <DailySummaryView summary={summary} />}
          {weekly && <WeeklySummaryView week={weekly} />}
          <AllLogs days={loggedDays} environments={environments} />
          <SettingsPanel
            darkMode={darkMode}
            onDarkModeChange={(v) => {
              setDarkMode(v);
              window.fleettime.setDarkMode(v);
            }}
            autoStartDisabled={autoStartDisabled}
            onAutoStartDisabledChange={(v) => {
              setAutoStartDisabled(v);
              window.fleettime.setAutoStartDisabled(v);
            }}
            pairing={pairing}
            environments={environments}
          />
        </section>
      </div>
    </div>
  );
}
