"use client";

import { useCallback, useEffect, useState } from "react";

interface ModelCall {
  model: string;
  adapter: string;
  outcome: string;
  latencyMs: number;
  costUsd: number;
}

interface AuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: string;
  action: string;
  modelCalls?: ModelCall[];
}

interface ClaimDraft {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
  damagedQty: number | null;
  amount: string;
  source: string;
  body: string;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      return true;
    } catch {
      return false;
    }
  }
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
  const [claims, setClaims] = useState<ClaimDraft[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
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

  const loadClaims = useCallback(async (id: string) => {
    if (!id) {
      setClaims([]);
      return;
    }
    try {
      const res = await fetch(`/api/claims?sessionId=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { claims?: ClaimDraft[] };
      setClaims(data.claims ?? []);
    } catch {
      setError("Could not reach the claims API.");
    }
  }, []);

  useEffect(() => {
    loadEntries(sessionId);
    loadClaims(sessionId);
    if (!sessionId) return;
    const timer = setInterval(() => {
      loadEntries(sessionId);
      loadClaims(sessionId);
    }, 2000);
    return () => clearInterval(timer);
  }, [sessionId, loadEntries, loadClaims]);

  const latest = entries.length > 0 ? entries[entries.length - 1]! : null;
  const counts = entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.verdict] = (acc[entry.verdict] ?? 0) + 1;
    return acc;
  }, {});

  // One submit writes several entries sharing a timestamp and one
  // modelCalls array, so group by ts to recover per-run tiering.
  const runs = new Map<string, ModelCall[]>();
  for (const entry of entries) {
    if (entry.modelCalls && !runs.has(entry.ts)) {
      runs.set(entry.ts, entry.modelCalls);
    }
  }
  const runCalls = [...runs.values()];
  const latestCalls = runCalls.length > 0 ? runCalls[runCalls.length - 1]! : null;
  const sparkCalls = runCalls.filter((calls) =>
    calls.some((c) => c.model === "spark"),
  ).length;
  const totalCost = runCalls
    .flat()
    .reduce((sum, call) => sum + call.costUsd, 0);

  function tieringLine(calls: ModelCall[]): string {
    const glimmer = calls.find((c) => c.model === "glimmer");
    const spark = calls.find((c) => c.model === "spark");
    const cost = calls.reduce((sum, c) => sum + c.costUsd, 0).toFixed(4);
    if (glimmer && !spark) {
      return `Glimmer ${glimmer.outcome} (${glimmer.adapter}), no Spark call, $${cost}`;
    }
    return (
      calls
        .map(
          (c) =>
            `${c.model} ${c.outcome} (${c.adapter}, ${c.latencyMs.toFixed(1)}ms, $${c.costUsd.toFixed(4)})`,
        )
        .join(" → ") + ` · total $${cost}`
    );
  }

  async function onCopy(index: number, body: string) {
    if (await copyText(body)) {
      setCopied(index);
      setTimeout(() => setCopied((cur) => (cur === index ? null : cur)), 2000);
    }
  }

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
            loadClaims(sessionId);
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

      {latestCalls && (
        <section
          style={{
            marginBottom: 16,
            padding: 16,
            border: "1px solid #888",
            borderRadius: 4,
          }}
        >
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Model tier</h2>
          <p style={{ margin: "0 0 4px", fontSize: 14 }}>
            Latest run: {tieringLine(latestCalls)}
          </p>
          <p style={{ margin: 0, fontSize: 14 }}>
            Session: {runCalls.length} runs · {sparkCalls} Spark escalations · $
            {totalCost.toFixed(4)}
          </p>
        </section>
      )}

      {claims.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <h2 style={{ fontSize: 18 }}>Claim drafts ({claims.length})</h2>
          {claims.map((claim, index) => (
            <article
              key={`${claim.bolRef}-${claim.awbRef}-${index}`}
              style={{
                marginBottom: 12,
                padding: 16,
                border: "1px solid #888",
                borderRadius: 4,
              }}
            >
              <p style={{ margin: "0 0 8px", fontSize: 14 }}>
                <strong>{claim.carrier || "Unknown carrier"}</strong> · BOL{" "}
                {claim.bolRef || "n/a"} · AWB {claim.awbRef || "n/a"} ·{" "}
                {claim.damagedQty === null
                  ? "qty unspecified"
                  : `${claim.damagedQty} damaged`}{" "}
                · {claim.amount} · {claim.source}
              </p>
              <pre
                style={{
                  margin: "0 0 8px",
                  padding: 12,
                  background: "#f6f6f6",
                  fontSize: 13,
                  whiteSpace: "pre-wrap",
                }}
              >
                {claim.body}
              </pre>
              <button
                type="button"
                onClick={() => onCopy(index, claim.body)}
                style={{ padding: "8px 12px", cursor: "pointer" }}
              >
                {copied === index ? "Copied" : "Copy claim"}
              </button>
            </article>
          ))}
        </section>
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
