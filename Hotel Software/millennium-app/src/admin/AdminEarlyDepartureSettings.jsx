// src/admin/AdminEarlyDepartureSettings.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function AdminEarlyDepartureSettings({ isAdmin = true }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [penaltyPercent, setPenaltyPercent] = useState(0); // percent applied to unused nights amount
  const [refundPercent, setRefundPercent] = useState(0); // percent refunded of unused nights amount
  const docRef = doc(db, "settings", "earlyDeparture");

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    let mounted = true;
    async function load() {
      try {
        const snap = await getDoc(docRef);
        if (!mounted) return;
        if (snap.exists()) {
          const data = snap.data() || {};
          setPenaltyPercent(Number(data.penaltyPercent || 0));
          setRefundPercent(Number(data.refundPercent || 0));
        } else {
          // defaults already set
        }
      } catch (err) {
        console.error("Failed to load earlyDeparture settings", err);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, [isAdmin]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setDoc(
        docRef,
        {
          penaltyPercent: Number(penaltyPercent) || 0,
          refundPercent: Number(refundPercent) || 0,
        },
        { merge: true }
      );
      // simple UX feedback: brief console/log - you can add snackbar etc.
      console.log("Early departure settings saved.");
    } catch (err) {
      console.error("Failed to save early departure settings", err);
      alert("Save failed. See console for details.");
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return <div>Unauthorized</div>;
  }

  if (loading) return <div>Loading early-departure settings…</div>;

  return (
    <div style={{ maxWidth: 720, padding: 12 }}>
      <h3>Early Departure (Early Check-out) Policy</h3>
      <p style={{ marginTop: 0 }}>
        Configure how the system calculates penalties and refunds when a guest checks out earlier than scheduled.
        Values are percentages of the *unused nights amount* (per-night room rates × unused nights).
      </p>

      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <label>
          Penalty (% of unused nights amount)
          <input
            type="number"
            min="0"
            step="0.1"
            value={penaltyPercent}
            onChange={(e) => setPenaltyPercent(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <label>
          Refund (% of unused nights amount)
          <input
            type="number"
            min="0"
            step="0.1"
            value={refundPercent}
            onChange={(e) => setRefundPercent(e.target.value)}
            style={{ width: "100%" }}
          />
        </label>

        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Policy"}
          </button>
          <button
            onClick={() => {
              setPenaltyPercent(0);
              setRefundPercent(0);
            }}
            style={{ marginLeft: 8 }}
          >
            Reset to 0 / Clear
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, fontSize: 13, color: "#555" }}>
        <strong>Note:</strong> This only sets the percentages. The reservation folio UI will preview the penalty/refund automatically.
        Persisting (creating the actual charge / refund lines in the reservation) is optional — to persist automatically implement
        the parent handler `applyEarlyDepartureAdjustments` (see sample below).
      </div>
    </div>
  );
}
