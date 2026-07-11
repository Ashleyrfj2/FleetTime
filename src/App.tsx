import { useCallback, useEffect, useState } from "react";
import type { SessionRow, SessionSummary } from "../electron/db/types";
import type { DailySummary, LoggedDay } from "../electron/db/summary";
import { formatClockTime, formatDuration, ROLE_LABELS } from "./format";

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

function SessionEditForm({ session, onDone }: { session: SessionSummary; onDone: () => void }) {
  const [envName, setEnvName] = useState(session.environment_name ?? "");
  const [role, setRole] = useState(session.role);
  const [active, setActive] = useState(splitDuration(session.active_seconds));
  const [guidelines, setGuidelines] = useState(splitDuration(session.guidelines_seconds));
  const [slack, setSlack] = useState(splitDuration(session.slack_seconds));

  const save = async () => {
    await window.fleettime.editSession(session.id, {
      environmentName: envName.trim() || null,
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
        <input
          type="text"
          value={envName}
          placeholder={session.task_id}
          onChange={(e) => setEnvName(e.target.value)}
        />
      </div>
      <div className="edit-row">
        <span className="edit-row-label">Role</span>
        <select value={role} onChange={(e) => setRole(e.target.value as SessionSummary["role"])}>
          <option value="task_writing">Task writing</option>
          <option value="qa">QA</option>
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

function SessionCard({ session, onChanged }: { session: SessionSummary; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (editing) {
    return (
      <SessionEditForm
        session={session}
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
        <dt>Submitted time</dt>
        <dd>{session.submitted_at ? formatClockTime(session.submitted_at) : "N/A"}</dd>
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

function DailySummaryView({ summary }: { summary: DailySummary }) {
  if (summary.roles.length === 0) {
    return <p className="muted">No sessions logged yet today.</p>;
  }
  return (
    <div>
      <h3>Sessions</h3>
      <ul className="summary-list">
        {summary.roles.map((role) => (
          <li key={role.role}>
            <strong>{ROLE_LABELS[role.role] ?? role.role}</strong> —{" "}
            {role.environments
              .map((env) => `${env.count} ${env.environmentName} (${formatDuration(env.totalSeconds)})`)
              .join(", ")}
          </li>
        ))}
      </ul>
      {summary.roles.map((role) => (
        <p key={role.role}>
          Total {ROLE_LABELS[role.role] ?? role.role} hours: {formatDuration(role.totalSeconds)} · avg{" "}
          {formatDuration(role.averageHandlingSeconds)}
        </p>
      ))}
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

function SettingsPanel({
  darkMode,
  onDarkModeChange,
  autoStartDisabled,
  onAutoStartDisabledChange,
  pairing,
}: {
  darkMode: boolean;
  onDarkModeChange: (v: boolean) => void;
  autoStartDisabled: boolean;
  onAutoStartDisabledChange: (v: boolean) => void;
  pairing: { port: number; token: string } | null;
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

function DayLogRow({ day }: { day: LoggedDay }) {
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
          {detail.roles.map((role) => (
            <p key={role.role} className="muted day-log-role">
              {ROLE_LABELS[role.role] ?? role.role}: {formatDuration(role.totalSeconds)} · avg{" "}
              {formatDuration(role.averageHandlingSeconds)}
            </p>
          ))}
          {detail.sessions.map((session) => (
            <SessionCard key={session.id} session={session} onChanged={loadDetail} />
          ))}
        </div>
      )}
    </div>
  );
}

function AllLogs({ days }: { days: LoggedDay[] }) {
  return (
    <div className="card">
      <h3>All logs</h3>
      {days.length === 0 && <p className="muted">No logs yet.</p>}
      {days.map((day) => (
        <DayLogRow key={day.date} day={day} />
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

  const refresh = useCallback(async () => {
    const [current, sessions, dailySummary, days] = await Promise.all([
      window.fleettime.getCurrentSession(),
      window.fleettime.getTodaySessions(),
      window.fleettime.getDailySummary(todayStr()),
      window.fleettime.getLoggedDays(),
    ]);
    setCurrentSession(current);
    setTodaySessions(sessions);
    setSummary(dailySummary);
    setLoggedDays(days);
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
              <SessionCard key={session.id} session={session} onChanged={refresh} />
            ))}
        </section>
        <section>
          <h2>Daily summary</h2>
          {summary && <DailySummaryView summary={summary} />}
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
          />
          <AllLogs days={loggedDays} />
        </section>
      </div>
    </div>
  );
}
