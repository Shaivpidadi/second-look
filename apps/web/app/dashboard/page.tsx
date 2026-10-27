"use client";

import { useCallback, useEffect, useState } from "react";

interface AuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: string;
  action: string;
}

const VERDICT_COLORS: Record<string, string> = {
  clean: "#1a7f37",
  mismatch: "#9a6700",
  blocked: "#b00020",
};

export default function Dashboard() {
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/audit");
      const data = (await res.json()) as { sessions?: string[] };
      setSessions(data.sessions ?? []);
    } catch {
      setError("Could not reach the audit API.");
    }
  }, []);

  const loadEntries = useCallback(async (id: string) => {
    if (!id) {
      setEntries([]);
      return;
    }
    try {
      const res = await fetch(`/api/audit?sessionId=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { entries?: AuditEntry[] };
      setEntries(data.entries ?? []);
      setError(null);
    } catch {
      setError("Could not reach the audit API.");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get("session") ?? "";
    if (preset) setSessionId(preset);
    loadSessions().then(() => {
      if (!preset) {
        fetch("/api/audit")
          .then((res) => res.json())
          .then((data: { sessions?: string[] }) => {
            if (data.sessions && data.sessions.length > 0) {
              setSessionId(data.sessions[0] as string);
            }
          })
          .catch(() => {});
      }
    });
  }, [loadSessions]);

  useEffect(() => {
    loadEntries(sessionId);
    if (!sessionId) return;
    const timer = setInterval(() => loadEntries(sessionId), 2000);
    return () => clearInterval(timer);
  }, [sessionId, loadEntries]);

  const latest = entries.length > 0 ? entries[entries.length - 1]! : null;
  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.verdict] = (acc[entry.verdict] ?? 0) + 1;
    return acc;
  }, {});

  const cell: React.CSSProperties = {
    border: "1px solid #ccc",
    padding: "6px 10px",
    textAlign: "left",
    fontSize: 14,
  };

  return (
    <main style={{ maxWidth: 960, margin: "32px auto", padding: "0 16px" }}>
      <h1>Verdicts &amp; audit trail</h1>
      <p>
        Live view of the append-only audit log. Pick a session to watch its
        verdicts arrive as the form is submitted.
      </p>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="session" style={{ marginRight: 8 }}>
          Session
        </label>
        <input
          id="session"
          list="sessions"
          value={sessionId}
          onChange={(e) => setSessionId(e.target.value)}
          placeholder="paste a session id"
          autoComplete="off"
          spellCheck={false}
          style={{ padding: 8, fontSize: 14, width: 320, maxWidth: "100%" }}
        />
        <datalist id="sessions">
          {sessions.map((id) => (
            <option key={id} value={id} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => {
            loadSessions();
            loadEntries(sessionId);
          }}
          style={{ marginLeft: 8, padding: "8px 12px", cursor: "pointer" }}
        >
          Refresh
        </button>
      </div>

      {error && <p style={{ color: "#b00020" }}>{error}</p>}

      {latest ? (
        <section
          aria-live="polite"
          style={{
            marginBottom: 16,
            padding: 16,
            border: `2px solid ${VERDICT_COLORS[latest.verdict] ?? "#555"}`,
            borderRadius: 4,
          }}
        >
          <h2 style={{ margin: "0 0 8px" }}>
            Latest verdict: {latest.verdict} ({latest.action})
          </h2>
          <p style={{ margin: 0, fontSize: 14 }}>
            {entries.length} audit entries ·{" "}
            {Object.entries(counts)
              .map(([verdict, n]) => `${n} ${verdict}`)
              .join(" · ")}
          </p>
        </section>
      ) : (
        <p>
          {sessionId
            ? "No audit entries for this session yet — submit the form to create some."
            : "No session selected."}
        </p>
      )}

      {entries.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {["Time", "Field", "Typed value", "Verdict", "Action"].map((h) => (
                <th key={h} style={{ ...cell, background: "#f0f0f0" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={`${entry.ts}-${i}`}>
                <td style={cell}>
                  {entry.ts.slice(11, 19)}
                </td>
                <td style={cell}>
                  <code>{entry.fieldId}</code>
                </td>
                <td style={cell}>
                  <code>{entry.typedValue ?? "—"}</code>
                </td>
                <td
                  style={{
                    ...cell,
                    color: VERDICT_COLORS[entry.verdict] ?? "#111",
                    fontWeight: 600,
                  }}
                >
                  {entry.verdict}
                </td>
                <td style={cell}>
                  <code>{entry.action}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
