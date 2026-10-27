"use client";

import { useRef, useState } from "react";

interface Field {
  id: string;
  label: string;
}

const FIELDS: Field[] = [
  { id: "awb.awbNumber", label: "AWB number" },
  { id: "bol.containerNumber", label: "Container number" },
  { id: "label.sscc", label: "SSCC (pallet label)" },
  { id: "bol.cartons", label: "Shipped cartons" },
  { id: "pod.receivedCartons", label: "Received cartons" },
  { id: "pod.exceptionNote", label: "POD exception note" },
];

const PREFILL: Record<string, string> = {
  "awb.awbNumber": "02027342210",
  "bol.containerNumber": "CSQU3054383",
  "label.sscc": "106141410000001238",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
  "pod.exceptionNote": "",
};

interface Failure {
  fieldId: string;
  rule: string;
  message: string;
  fix?: string;
}

interface SubmitResult {
  decision: "ALLOW" | "BLOCK";
  verdict: { state: string };
  failures: Failure[];
}

export default function ReceivingForm() {
  const [sessionId] = useState(() => crypto.randomUUID());
  const [values, setValues] = useState<Record<string, string>>(PREFILL);
  const [streamed, setStreamed] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function streamEvent(fieldId: string, value: string) {
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(() => {
      fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          fieldId,
          value,
          ts: new Date().toISOString(),
        }),
      })
        .then((res) => {
          if (res.ok) setStreamed((n) => n + 1);
        })
        .catch(() => {});
    }, 250);
  }

  function onChange(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setResult(null);
    streamEvent(fieldId, value);
  }

  function applyFix(fieldId: string, fix: string) {
    setValues((prev) => ({ ...prev, [fieldId]: fix }));
    setResult(null);
    streamEvent(fieldId, fix);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, values }),
      });
      const data = (await res.json()) as SubmitResult;
      setResult(data);
    } finally {
      setSubmitting(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px",
    fontSize: 16,
    border: "1px solid #888",
    borderRadius: 4,
    boxSizing: "border-box",
  };

  return (
    <main style={{ maxWidth: 640, margin: "32px auto", padding: "0 16px" }}>
      <h1>Warehouse receiving</h1>
      <p>
        Mock form. Every keystroke streams to the screen reader; submit runs the
        check-digit gate.
      </p>
      <form onSubmit={onSubmit}>
        {FIELDS.map((field) => (
          <div key={field.id} style={{ marginBottom: 16 }}>
            <label htmlFor={field.id} style={{ display: "block", marginBottom: 4 }}>
              {field.label}{" "}
              <span style={{ color: "#555", fontSize: 13 }}>{field.id}</span>
            </label>
            <input
              id={field.id}
              style={inputStyle}
              value={values[field.id] ?? ""}
              onChange={(e) => onChange(field.id, e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        ))}
        <button
          type="submit"
          disabled={submitting}
          style={{ padding: "10px 24px", fontSize: 16, cursor: "pointer" }}
        >
          {submitting ? "Checking…" : "Submit receiving"}
        </button>
      </form>

      <p style={{ marginTop: 16, fontSize: 14 }}>
        Session <code>{sessionId.slice(0, 8)}</code> · {streamed} typed events
        streamed
      </p>

      {result && (
        <section
          aria-live="polite"
          style={{
            marginTop: 16,
            padding: 16,
            border: `2px solid ${result.decision === "BLOCK" ? "#b00020" : "#1a7f37"}`,
            borderRadius: 4,
          }}
        >
          <h2 style={{ margin: "0 0 8px" }}>
            {result.decision === "BLOCK" ? "Blocked" : "Accepted"} (
            {result.verdict.state})
          </h2>
          {result.failures.length === 0 ? (
            <p style={{ margin: 0 }}>All checks passed.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {result.failures.map((f) => (
                <li key={`${f.fieldId}-${f.rule}`} style={{ marginBottom: 8 }}>
                  <strong>{f.fieldId}</strong> [{f.rule}]: {f.message}
                  {f.fix !== undefined && (
                    <div style={{ marginTop: 4 }}>
                      Proposed fix: <code>{f.fix}</code>{" "}
                      <button
                        type="button"
                        onClick={() => applyFix(f.fieldId, f.fix as string)}
                        style={{ cursor: "pointer" }}
                      >
                        Apply fix
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
