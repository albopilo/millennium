// src/pages/ReservationDetailC.jsx
import React, { useMemo } from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailC(props) {
  const roomLines = useMemo(() => {
    // Infer per-room postings if postings include ROOM entries
    const roomPostings = (postings || []).filter(p => ((p.accountCode || "") + "").toUpperCase() === "ROOM" && ((p.status || "") + "").toLowerCase() !== "void");
    const map = {};
    for (const p of roomPostings) {
      const rn = p.roomNumber || "—";
      map[rn] = (map[rn] || 0) + Number(p.amount || 0);
    }
    return Object.keys(map).map((k) => ({ roomNo: k, subtotal: map[k] }));
  }, [postings]);

  // Handlers that also call logReservationChange if provided
  const onSubmitCharge = async () => {
    try {
      await submitCharge();
      if (typeof logReservationChange === "function") {
        logReservationChange("add_charge", { description: chargeForm.description, qty: chargeForm.qtyStr, unit: chargeForm.unitStr });
      }
    } catch (err) {
      console.error("onSubmitCharge failed", err);
    }
  };

  const onSubmitPayment = async () => {
    try {
      await submitPayment();
      if (typeof logReservationChange === "function") {
        logReservationChange("add_payment", { amount: paymentForm.amountStr, method: paymentForm.method });
      }
    } catch (err) {
      console.error("onSubmitPayment failed", err);
    }
  };

  return (
    <div className="reservation-section">
      <h3 className="section-title">Folio & Payments</h3>

      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div><strong>Charges:</strong> {currency} {fmtMoney(displayChargesTotal)}</div>
          <div><strong>Payments:</strong> {currency} {fmtMoney(displayPaymentsTotal)}</div>
          <div><strong>Balance:</strong> {currency} {fmtMoney(displayBalance)}</div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Room charges</div>
        {roomLines.length === 0 ? <div style={{ color: "#64748b" }}>No room postings</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {roomLines.map((r) => (
              <div key={r.roomNo} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderRadius: 6, background: "#fafafa" }}>
                <div>Room {r.roomNo}</div>
                <div>{currency} {fmtMoney(r.subtotal)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Other charges</div>
        {(displayChargeLines && displayChargeLines.length) ? (
          <div style={{ display: "grid", gap: 8 }}>
            {displayChargeLines.map((p) => (
              <div key={p.id || `${p.description}-${Math.random()}`} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderRadius: 6 }}>
                <div>{p.description || p.accountCode || "-"}</div>
                <div>{currency} {fmtMoney(Number(p.amount || 0))}</div>
              </div>
            ))}
          </div>
        ) : <div style={{ color: "#64748b" }}>No other charges</div>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {canOperate && (
          <>
            <button className="btn btn-primary" onClick={() => setShowAddCharge && setShowAddCharge(true)}>Add charge</button>
            <button className="btn btn-primary" onClick={() => setShowAddPayment && setShowAddPayment(true)}>Add payment</button>
          </>
        )}
        <button className="btn btn-secondary" onClick={() => printCheckInForm && printCheckInForm()}>Print Check-In Form</button>
        <button className="btn btn-secondary" onClick={() => printCheckOutBill && printCheckOutBill()}>Print Check-Out Bill</button>
      </div>

      {/* Add Charge Modal (simple, immediate typing allowed) */}
      {showAddCharge && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div style={{ width: 520, maxWidth: "95%", background: "white", padding: 18, borderRadius: 10 }}>
            <h4 style={{ marginTop: 0 }}>Add Charge</h4>
            <div style={{ display: "grid", gap: 10 }}>
              <input placeholder="Description" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
              <div style={{ display: "flex", gap: 8 }}>
                <input placeholder="Qty" value={chargeForm.qtyStr} onChange={(e) => setChargeForm({ ...chargeForm, qtyStr: e.target.value })} style={{ flex: 1 }} />
                <input placeholder="Unit amount" value={chargeForm.unitStr} onChange={(e) => setChargeForm({ ...chargeForm, unitStr: e.target.value })} style={{ flex: 1 }} />
                <select value={chargeForm.accountCode} onChange={(e) => setChargeForm({ ...chargeForm, accountCode: e.target.value })} style={{ width: 140 }}>
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowAddCharge(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { await onSubmitCharge(); }}>Add charge</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment Modal */}
      {showAddPayment && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div style={{ width: 440, maxWidth: "95%", background: "white", padding: 18, borderRadius: 10 }}>
            <h4 style={{ marginTop: 0 }}>Add Payment</h4>
            <div style={{ display: "grid", gap: 10 }}>
              <input placeholder="Amount" value={paymentForm.amountStr} onChange={(e) => setPaymentForm({ ...paymentForm, amountStr: e.target.value })} />
              <input placeholder="Reference / notes" value={paymentForm.refNo} onChange={(e) => setPaymentForm({ ...paymentForm, refNo: e.target.value })} />
              <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
                <option value="qris">QRIS</option>
                <option value="ota">OTA</option>
              </select>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button className="btn btn-secondary" onClick={() => setShowAddPayment(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { await onSubmitPayment(); }}>Add payment</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
