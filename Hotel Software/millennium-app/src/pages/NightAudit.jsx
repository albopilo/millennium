// src/pages/NightAudit.jsx
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { runNightAudit } from "../utils/nightAudit";

export default function NightAudit({ currentUser = null, permissions = [] }) {
  const navigate = useNavigate();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [finalizing, setFinalizing] = useState(false);
  const canRun = permissions.includes("canRunNightAudit") || permissions.includes("*");

  const actor = currentUser?.displayName || currentUser?.email || "unknown";

  const handleRun = async (finalize = false) => {
    if (!canRun) {
      alert("You do not have permission to run Night Audit.");
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      // First run the audit in "preview" mode (finalize=false) to show issues
      const res = await runNightAudit({ runBy: actor, finalize });
      setResult(res);
    } catch (err) {
      console.error("NightAudit.run error", err);
      setResult({ success: false, error: err.message || String(err) });
    } finally {
      setRunning(false);
    }
  };

  const handleFinalize = async () => {
    if (!canRun) { alert("No permission"); return; }
    if (!result) return;
    if (result.issues && result.issues.length > 0) {
      const ok = window.confirm("There are issues found. Are you sure you want to finalize the audit? Finalize will still write an audit log but issues remain flagged.");
      if (!ok) return;
    }
    setFinalizing(true);
    try {
      const res2 = await runNightAudit({ runBy: actor, finalize: true });
      setResult(res2);
      alert("Night audit finalized (log written).");
    } catch (err) {
      console.error("finalize error", err);
      alert("Failed to finalize: " + (err.message || String(err)));
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Night Audit</span>
        <button onClick={() => navigate(-1)} style={{ background: "#f3f4f6", border: "1px solid #ccc", padding: "6px 10px" }}>
          ← Back
        </button>
      </h2>

      <div style={{ marginBottom: 16 }}>
        <p>Business day closes at <b>04:00 GMT+7</b>. Run the audit to validate rooms, stays, reservations and financial postings.</p>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button disabled={running} onClick={() => handleRun(false)} style={{ padding: "8px 12px" }}>
          Run (preview)
        </button>
        <button disabled={running || finalizing} onClick={handleFinalize} style={{ padding: "8px 12px" }}>
          Finalize (write audit log)
        </button>
      </div>

      {running && <div>Running audit…</div>}

      {result && (
        <div style={{ marginTop: 12 }}>
          {!result.success && <div style={{ color: "red" }}>Error: {result.error}</div>}

          {result.summary && (
            <div style={{ marginBottom: 12, border: "1px solid #eee", padding: 12 }}>
              <h4>Summary</h4>
              <div>Business Day: {result.summary.businessDay}</div>
              <div>Rooms total: {result.summary.roomsTotal}</div>
              <div>Rooms occupied: {result.summary.roomsOccupied}</div>
              <div>Occupancy: {result.summary.occupancyPct}%</div>
              <div>ADR: {result.summary.adr}</div>
              <div>RevPAR: {result.summary.revpar}</div>
              <div>Total room revenue (postings): {result.summary.totalRoomRevenue}</div>
              <div>Issues found: {result.summary.issuesCount}</div>
            </div>
          )}

          {result.issues && result.issues.length > 0 ? (
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
                      <td style={{ border: "1px solid #ddd", padding: 6 }}>{it.type}</td>
                      <td style={{ border: "1px solid #ddd", padding: 6 }}>{it.message}</td>
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
                    // Allow admin to still finalize if absolutely needed; warn first
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
                <button onClick={() => handleRun(true)} disabled={finalizing}>
                  Finalize and close day
                </button>
                <button onClick={() => navigate(-1)}>Back</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
