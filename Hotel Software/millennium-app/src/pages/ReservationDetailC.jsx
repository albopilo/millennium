// src/pages/ReservationDetailC.jsx
import React, { useMemo, useState } from "react";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailC
 * - Folio listing, add charge, add payment modals
 * - All numeric inputs are plain text-bound (no debounce)
 */

export default function ReservationDetailC({
  reservation,
  postings = [],
  payments = [],
  submitCharge,
  submitPayment,
  currency = "IDR",
  fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID")),
}) {
  const [showCharge, setShowCharge] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "" });
  const [submitting, setSubmitting] = useState(false);

  const visiblePostings = useMemo(() => postings.filter((p) => ((p.status || "") + "").toLowerCase() !== "void"), [postings]);

  const handleAddCharge = async () => {
    try {
      setSubmitting(true);
      await submitCharge(chargeForm);
      setShowCharge(false);
      setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
      alert("Charge added");
    } catch (err) {
      alert(err.message || "Add charge failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddPayment = async () => {
    try {
      setSubmitting(true);
      await submitPayment(paymentForm);
      setShowPayment(false);
      setPaymentForm({ amountStr: "", method: "cash", refNo: "" });
      alert("Payment added");
    } catch (err) {
      alert(err.message || "Add payment failed");
    } finally {
      setSubmitting(false);
    }
  };

  const chargesTotal = visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = chargesTotal - paymentsTotal;

  return (
    <div className="card panel">
      <div className="panel-header">
        <h3>Folio & Payments</h3>
        <div style={{ textAlign: "right" }}>
          <div className="muted">Charges: {currency} {fmtMoney(chargesTotal)}</div>
          <div className="muted">Payments: {currency} {fmtMoney(paymentsTotal)}</div>
          <div style={{ fontWeight: 700 }}>Balance: {currency} {fmtMoney(balance)}</div>
        </div>
      </div>

      <div className="panel-body">
        <div className="subsection">
          <h4>Charges</h4>
          {visiblePostings.length === 0 ? <div className="muted">No charges</div> : visiblePostings.map((p) => (
            <div key={p.id} className="line-row">
              <div>{p.description || p.accountCode}</div>
              <div>{currency} {fmtMoney(p.amount)}</div>
            </div>
          ))}
        </div>

        <div className="subsection">
          <h4>Payments</h4>
          {payments.length === 0 ? <div className="muted">No payments</div> : payments.map((p) => (
            <div key={p.id} className="line-row">
              <div>{new Date(p.capturedAt?.seconds ? p.capturedAt.seconds * 1000 : p.capturedAt || Date.now()).toLocaleString()} <span className="muted">({p.method})</span></div>
              <div>{currency} {fmtMoney(p.amount)}</div>
            </div>
          ))}
        </div>

        <div className="action-bar">
          <button className="btn btn-primary" onClick={() => setShowCharge(true)}>+ Add Charge</button>
          <button className="btn btn-primary" onClick={() => setShowPayment(true)}>+ Add Payment</button>
        </div>
      </div>

      {/* Add Charge Modal */}
      {showCharge && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Charge</h3>
            <label>Description</label>
            <input value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} placeholder="e.g., Minibar" />
            <div className="modal-row">
              <div>
                <label>Qty</label>
                <input value={chargeForm.qtyStr} onChange={(e) => setChargeForm({ ...chargeForm, qtyStr: e.target.value })} placeholder="1" />
              </div>
              <div>
                <label>Unit</label>
                <input value={chargeForm.unitStr} onChange={(e) => setChargeForm({ ...chargeForm, unitStr: e.target.value })} placeholder="50000" />
              </div>
              <div>
                <label>Account</label>
                <select value={chargeForm.accountCode} onChange={(e) => setChargeForm({ ...chargeForm, accountCode: e.target.value })}>
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="UPGRADE">UPGRADE</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCharge(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddCharge} disabled={submitting}>{submitting ? "Adding…" : "Add Charge"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Payment Modal */}
      {showPayment && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Payment</h3>
            <label>Amount</label>
            <input value={paymentForm.amountStr} onChange={(e) => setPaymentForm({ ...paymentForm, amountStr: e.target.value })} placeholder="100000" />
            <label>Reference</label>
            <input value={paymentForm.refNo} onChange={(e) => setPaymentForm({ ...paymentForm, refNo: e.target.value })} placeholder="Ref no or note" />
            <label>Method</label>
            <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
              <option value="qris">QRIS</option>
            </select>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowPayment(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleAddPayment} disabled={submitting}>{submitting ? "Adding…" : "Add Payment"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
