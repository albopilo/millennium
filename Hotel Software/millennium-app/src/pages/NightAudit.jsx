// src/pages/NightAudit.jsx
import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { runNightAudit } from "../utils/nightAudit";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase";

/**
 * NightAudit page
 *
 * Keeps original behavior:
 *  - run preview (finalize=false) and show results
 *  - finalize (finalize=true) after confirmation when issues exist
 *
 * Adds:
 *  - persist finalized audit to Firestore collection "night_audits"
 *  - request token + mounted guard to avoid stale updates
 *  - export / copy result utilities
 *  - nicer error handling & retry
 *
 * Props:
 *  - currentUser: user object with displayName/email used as actor
 *  - permissions: array of permission strings (must include canRunNightAudit or "*")
 */
export default function NightAudit({ currentUser = null, permissions = [] }) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const [savingLog, setSavingLog] = useState(false);
  const [lastSavedId, setLastSavedId] = useState(null);
  const [error, setError] = useState(null);
  const [savedError, setSavedError] = useState(null);

  // permission check (kept)
  const canRun = permissions.includes("canRunNightAudit") || permissions.includes("*");

  // actor string (kept)
  const actor = currentUser?.displayName || currentUser?.email || "unknown";

  // mounted guard to prevent setState after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // request token to avoid race conditions (only latest run applies)
  const reqTokenRef = useRef(0);

  // Helper: run audit (preview or finalize)
  // Keeps original logic: runNightAudit({ runBy: actor, finalize })
  async function handleRun(finalize = false) {
    if (!canRun) {
      alert("You do not have permission to run Night Audit.");
      return;
    }

    setError(null);
    setSavedError(null);
    setLastSavedId(null);
    const myToken = ++reqTokenRef.current;

    // toggle running/finalizing flags
    if (finalize) {
      setFinalizing(true);
    } else {
      setRunning(true);
    }

    try {
      // runNightAudit expected to return an object like:
      // { success: true/false, summary: {...}, issues: [...], error?: "..." }
      const res = await runNightAudit({ runBy: actor, finalize });
      // only apply result if still mounted and token matches
      if (!mountedRef.current || reqTokenRef.current !== myToken) return;
      setResult(res);
      if (!res.success) {
        setError(res.error || "Night audit returned failure.");
      } else {
        setError(null);
      }
    } catch (err) {
      console.error("NightAudit.run error", err);
      if (!mountedRef.current || reqTokenRef.current !== myToken) return;
      const message = err?.message || String(err);
      setResult({ success: false, error: message });
      setError(message);
    } finally {
      if (mountedRef.current && reqTokenRef.current === myToken) {
        setRunning(false);
        setFinalizing(false);
      }
    }
  }

  // Helper: persist finalized audit result to Firestore (only when finalize was true and result exists)
  // Writes to collection "night_audits" with metadata and content.
  async function persistAuditLog(auditResult, opts = { runBy: actor, finalize: true }) {
    if (!auditResult) throw new Error("No audit result to persist.");
    setSavingLog(true);
    setSavedError(null);
    try {
      const payload = {
        runBy: opts.runBy || actor,
        finalize: !!opts.finalize,
        createdAt: serverTimestamp(),
        // store summary and issues as-is (best effort)
        summary: auditResult.summary || null,
        issues: auditResult.issues || [],
        success: !!auditResult.success,
        rawResult: auditResult // keep raw for forensics
      };

      const ref = await addDoc(collection(db, "night_audits"), payload);
      if (!mountedRef.current) return null;
      setLastSavedId(ref.id);
      return ref.id;
    } catch (err) {
      console.error("persistAuditLog error", err);
      const msg = err?.message || String(err);
      setSavedError(msg);
      throw err;
    } finally {
      if (mountedRef.current) setSavingLog(false);
    }
  }

  // Handler for finalize button. Keeps original confirmation logic for issues.
  async function handleFinalize() {
    if (!canRun) {
      alert("You do not have permission to finalize Night Audit.");
      return;
    }

    // If user hasn't run preview yet, still allow finalize (original re-runs)
    if (result && result.issues && result.issues.length > 0) {
      const ok = window.confirm("There are issues found. Are you sure you want to finalize the audit? Finalize will still write an audit log but issues remain flagged.");
      if (!ok) return;
    }

    setSavedError(null);
    setLastSavedId(null);

    // run finalize (re-run audit in finalize mode), keep behavior of original code
    const myToken = ++reqTokenRef.current;
    setFinalizing(true);
    try {
      const res2 = await runNightAudit({ runBy: actor, finalize: true });
      if (!mountedRef.current || reqTokenRef.current !== myToken) return;

      setResult(res2);

      if (!res2.success) {
        // still persist audit log even if unsuccessful? original code persisted only on finalize; we'll persist the attempt
        setError(res2.error || "Finalize returned failure.");
      } else {
        setError(null);
      }

      // persist to Firestore regardless of success status (keeps a record)
      try {
        const savedId = await persistAuditLog(res2, { runBy: actor, finalize: true });
        if (!mountedRef.current || reqTokenRef.current !== myToken) return;
        setLastSavedId(savedId);
        alert("Night audit finalized and logged. (ID: " + savedId + ")");
      } catch (saveErr) {
        // show save error but do not block
        console.error("Failed to save audit log:", saveErr);
        if (mountedRef.current) {
          setSavedError(saveErr?.message || String(saveErr));
          alert("Audit finalized but failed to persist log: " + (saveErr?.message || String(saveErr)));
        }
      }
    } catch (err) {
      console.error("finalize error", err);
      if (!mountedRef.current) return;
      const msg = err?.message || String(err);
      setResult({ success: false, error: msg });
      setError(msg);
      alert("Failed to finalize: " + msg);
    } finally {
      if (mountedRef.current && reqTokenRef.current === myToken) setFinalizing(false);
    }
  }

  // Utility: export result JSON
  function exportResultJson() {
    if (!result) {
      alert("No result to export.");
      return;
    }
    try {
      const txt = JSON.stringify(result, null, 2);
      const blob = new Blob([txt], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `night_audit_${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("exportResultJson error", err);
      alert("Failed to export JSON: " + (err?.message || String(err)));
    }
  }

  // Utility: copy result to clipboard
  async function copyResultToClipboard() {
    if (!result) {
      alert("No result to copy.");
      return;
    }
    try {
      const txt = JSON.stringify(result, null, 2);
      await navigator.clipboard.writeText(txt);
      alert("Audit JSON copied to clipboard.");
    } catch (err) {
      console.error("copy to clipboard error", err);
      alert("Failed to copy to clipboard: " + (err?.message || String(err)));
    }
  }

  // Small render helpers
  const showIssues = result && Array.isArray(result.issues) && result.issues.length > 0;
  const showSummary = result && result.summary;

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Night Audit</span>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "#f3f4f6", border: "1px solid #ccc", padding: "6px 10px" }}
        >
          ← Back
        </button>
      </h2>

      <div style={{ marginBottom: 16 }}>
        <p>
          Business day typically closes at <b>04:00 GMT+7</b>. Run the audit to validate rooms, stays, reservations and financial postings.
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          disabled={running || finalizing}
          onClick={() => handleRun(false)}
          style={{ padding: "8px 12px" }}
        >
          {running ? "Running preview…" : "Run (preview)"}
        </button>

        <button
          disabled={running || finalizing}
          onClick={async () => {
            // If we already have a result with no issues we can directly persist/finalize
            if (result && !showIssues) {
              // quick confirm
              const ok = window.confirm("No issues detected. Finalize and close business day?");
              if (!ok) return;
            }
            // call finalize flow
            await handleFinalize();
          }}
          style={{ padding: "8px 12px" }}
        >
          {finalizing ? "Finalizing…" : "Finalize (write audit log)"}
        </button>

        <button
          disabled={!result}
          onClick={exportResultJson}
          title="Export audit result to JSON"
        >
          Export JSON
        </button>

        <button
          disabled={!result}
          onClick={copyResultToClipboard}
          title="Copy audit result JSON to clipboard"
        >
          Copy JSON
        </button>
      </div>

      {running && <div style={{ marginBottom: 12 }}>Running audit (preview)…</div>}
      {finalizing && <div style={{ marginBottom: 12 }}>Finalizing audit…</div>}

      {error && (
        <div style={{ color: "red", marginBottom: 8 }}>
          Error: {error}
          <div>
            <button onClick={() => { setError(null); }}>Dismiss</button>
          </div>
        </div>
      )}

      {result && (
        <div style={{ marginTop: 12 }}>
          {!result.success && (
            <div style={{ color: "red", marginBottom: 8 }}>
              Error from audit: {result.error || "Unknown error"}
            </div>
          )}

          {showSummary && (
            <div style={{ marginBottom: 12, border: "1px solid #eee", padding: 12 }}>
              <h4>Summary</h4>
              <div>Business Day: {result.summary.businessDay ?? "-"}</div>
              <div>Rooms total: {result.summary.roomsTotal ?? "-"}</div>
              <div>Rooms occupied: {result.summary.roomsOccupied ?? "-"}</div>
              <div>Occupancy: {result.summary.occupancyPct ?? "-"}%</div>
              <div>ADR: {result.summary.adr ?? "-"}</div>
              <div>RevPAR: {result.summary.revpar ?? "-"}</div>
              <div>Total room revenue (postings): {result.summary.totalRoomRevenue ?? "-"}</div>
              <div>Issues found: {result.summary.issuesCount ?? (result.issues ? result.issues.length : 0)}</div>
            </div>
          )}

          {showIssues ? (
            <div>
              <h4 style={{ color: "#b91c1c" }}>Issues</h4>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f3f4f6" }}>
                    <th style={{ border: "1px solid #ddd", padding: 6 }}>Type</th>
                    <th style={{ border: "1px solid #ddd", padding: 6 }}>Message</th>
                    <th style={{ border: "1px solid #ddd", padding: 6 }}>Context</th>
                  </tr>
                </thead>
                <tbody>
                  {result.issues.map((it, i) => (
                    <tr key={i}>
                      <td style={{ border: "1px solid #ddd", padding: 6 }}>{it.type ?? "-"}</td>
                      <td style={{ border: "1px solid #ddd", padding: 6 }}>{it.message ?? "-"}</td>
                      <td style={{ border: "1px solid #ddd", padding: 6 }}>
                        {it.reservationId || it.stayId || it.roomNumber || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={() => navigate(-1)}>Back to Dashboard (fix issues)</button>
                <button
                  onClick={() => {
                    const ok = window.confirm("Finalize even with issues? This will write an audit log but issues remain flagged.");
                    if (ok) handleFinalize();
                  }}
                >
                  Finalize anyway
                </button>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <h4 style={{ color: "green" }}>No issues found</h4>
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => {
                    const ok = window.confirm("No issues were found. Finalize and close the business day?");
                    if (ok) handleFinalize();
                  }}
                  disabled={finalizing}
                >
                  Finalize and close day
                </button>
                <button onClick={() => navigate(-1)}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Show saved audit doc id / save errors */}
      {lastSavedId && (
        <div style={{ marginTop: 12, color: "#065f46" }}>
          Audit log saved (ID: <strong>{lastSavedId}</strong>).
        </div>
      )}
      {savedError && (
        <div style={{ marginTop: 12, color: "red" }}>
          Failed to persist audit log: {savedError}
        </div>
      )}
      {savingLog && <div style={{ marginTop: 8 }}>Saving audit log…</div>}
    </div>
  );
}
