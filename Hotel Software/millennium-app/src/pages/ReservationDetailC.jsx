// src/pages/ReservationDetailC.jsx
import React, { useEffect, useState } from "react";
import "../styles/ReservationDetail.css";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function ReservationDetailC({
  reservation,
  chargeLines = [],
  chargesTotal = 0,
  payments = [],
  paymentsTotal = 0,
  balance = 0,
  showAddCharge,
  setShowAddCharge,
  chargeForm,
  setChargeForm,
  submitCharge,
  showAddPayment,
  setShowAddPayment,
  paymentForm,
  setPaymentForm,
  submitPayment,
  printRef,
  printMode,
  chargePreviewTotal,
  paymentPreviewAmount,
  formatCurrencyPreview,
  fmt = (d) => d
}) {
  const [templates, setTemplates] = useState({
    checkInTemplate: { header: "Hotel", body: "<p>Check-in</p>", footer: "" },
    checkOutTemplate: { header: "Hotel", body: "<p>Check-out</p>", footer: "" }
  });

  useEffect(() => {
    let mounted = true;
    async function loadTpl() {
      try {
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (snap.exists() && mounted) {
          const data = snap.data();
          setTemplates({
            checkInTemplate: data.checkInTemplate || templates.checkInTemplate,
            checkOutTemplate: data.checkOutTemplate || templates.checkOutTemplate
          });
        }
      } catch (err) {
        console.warn("load templates", err);
      }
    }
    loadTpl();
    return () => { mounted = false; };
  }, []);

  function renderTemplateHtml(mode) {
    const tpl = mode === "checkin" ? templates.checkInTemplate : templates.checkOutTemplate;
    const placeholders = {
      "{{guestName}}": reservation?.guestName || "",
      "{{roomNumber}}": Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : (reservation?.roomNumber || ""),
      "{{checkInDate}}": fmt(reservation?.checkInDate),
      "{{checkOutDate}}": fmt(reservation?.checkOutDate),
      "{{balance}}": formatCurrencyPreview(balance),
      "{{staffName}}": "Frontdesk"
    };
    let body = tpl.body || "";
    Object.entries(placeholders).forEach(([k, v]) => { body = body.split(k).join(v); });
    const header = tpl.header || "";
    const footer = tpl.footer || "";
    return `<div style="font-family: Arial, sans-serif; color: #111;">
      <div style="text-align:center; font-weight:700; font-size:18px; margin-bottom:10px;">${header}</div>
      <hr/>
      <div style="margin:10px 0;">${body}</div>
      <hr/>
      <div style="text-align:center; font-size:12px; margin-top:8px;">${footer}</div>
    </div>`;
  }

  return (
    <div className="reservation-detail-container card">
      <div className="card-header">
        <h3>Folio & Payments</h3>
      </div>
      <div className="card-body">
        <div className="summary-bar">
          <div className="summary-item"><div className="summary-label">Charges</div><div className="summary-value">{formatCurrencyPreview(chargesTotal)}</div></div>
          <div className="summary-item"><div className="summary-label">Payments</div><div className="summary-value">{formatCurrencyPreview(paymentsTotal)}</div></div>
          <div className="summary-item"><div className="summary-label">Balance</div><div className="summary-value text-red">{formatCurrencyPreview(balance)}</div></div>
        </div>

        <section>
          <h4>Itemized Charges</h4>
          <div className="charges-list">
            {chargeLines.length ? chargeLines.map(p => (
              <div key={p.id || Math.random()} className="charge-row">
                <div className="charge-desc">{p.description}</div>
                <div className="charge-amt">{formatCurrencyPreview(p.amount)}</div>
              </div>
            )) : <div className="muted">No charges</div>}
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <h4>Payments</h4>
          <div className="charges-list">
            {payments.length ? payments.map(p => (
              <div key={p.id || Math.random()} className="charge-row">
                <div className="charge-desc">{p.method} {p.refNo ? `(${p.refNo})` : ""}</div>
                <div className="charge-amt">{formatCurrencyPreview(p.amount)}</div>
              </div>
            )) : <div className="muted">No payments</div>}
          </div>
        </section>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowAddCharge(true)}>Add Charge</button>
          <button className="btn btn-outline" onClick={() => setShowAddPayment(true)}>Add Payment</button>
        </div>

        {/* Add Charge Modal */}
        {showAddCharge && (
          <div className="modal" role="dialog">
            <div className="modal-content">
              <div className="modal-header"><h4>Add Charge</h4></div>
              <div className="modal-body">
                <input placeholder="Description" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input placeholder="Qty" value={chargeForm.qtyStr} onChange={(e) => setChargeForm({ ...chargeForm, qtyStr: e.target.value })} />
                  <input placeholder="Unit amount (numbers only)" value={chargeForm.unitStr} onChange={(e) => setChargeForm({ ...chargeForm, unitStr: e.target.value })} />
                </div>
                <select value={chargeForm.accountCode} onChange={(e) => setChargeForm({ ...chargeForm, accountCode: e.target.value })} style={{ marginTop: 8 }}>
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>
                <div className="muted" style={{ marginTop: 8 }}>Preview total: {chargePreviewTotal()}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddCharge(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submitCharge}>Add</button>
              </div>
            </div>
          </div>
        )}

        {/* Add Payment Modal */}
        {showAddPayment && (
          <div className="modal" role="dialog">
            <div className="modal-content">
              <div className="modal-header"><h4>Add Payment</h4></div>
              <div className="modal-body">
                <input placeholder="Amount" value={paymentForm.amountStr} onChange={(e) => setPaymentForm({ ...paymentForm, amountStr: e.target.value })} />
                <input placeholder="Ref / Notes" value={paymentForm.refNo} onChange={(e) => setPaymentForm({ ...paymentForm, refNo: e.target.value })} style={{ marginTop: 8 }} />
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })} style={{ marginTop: 8 }}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="qris">QRIS</option>
                  <option value="ota">OTA</option>
                </select>
                <div className="muted" style={{ marginTop: 8 }}>Preview: {paymentPreviewAmount()}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddPayment(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={submitPayment}>Add</button>
              </div>
            </div>
          </div>
        )}

        {/* Printable content */}
        <div style={{ display: printMode ? "block" : "none" }}>
          <div ref={printRef} className="printable" dangerouslySetInnerHTML={{ __html: renderTemplateHtml(printMode) }} />
        </div>
      </div>
    </div>
  );
}
