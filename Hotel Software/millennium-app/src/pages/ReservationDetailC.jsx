// src/pages/ReservationDetailC.jsx
import React, { useEffect, useMemo, useState } from "react";
import "../styles/ReservationDetail.css";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Presentational folio & payments component.
 * - Shows itemized charges, payments, totals
 * - Modals to add charge/payment (no debounce on input — free typing)
 * - Links print action to admin template stored at admin_print_templates/default
 * - Hides print buttons depending on reservation status:
 *    - Hide "Print check-out bill" when reservation is still checked-in (only show if checked-out)
 *    - Hide "Print check-in form" when reservation is checked-out
 *
 * - On print, this component renders printable HTML into a ref (dangerouslySetInnerHTML) using admin template placeholders.
 */

export default function ReservationDetailC({
  reservation,
  postings = [],
  visiblePostings = [],
  displayChargeLines = [],
  displayChargesTotal = 0,
  displayPaymentsTotal = 0,
  displayBalance = 0,
  payments = [],
  canOperate = false,
  isAdmin = false,
  showAddCharge = false,
  setShowAddCharge = () => {},
  chargeForm = {},
  setChargeForm = () => {},
  submitCharge = async () => {},
  showAddPayment = false,
  setShowAddPayment = () => {},
  paymentForm = {},
  setPaymentForm = () => {},
  submitPayment = async () => {},
  printRef = null,
  printMode = null,
  printCheckOutBill = null,
  fmt = (d) => (d ? new Date(d).toLocaleString() : "-"),
  guest = null
}) {
  const [templates, setTemplates] = useState({
    checkInTemplate: { header: "Hotel", body: "<p>Check-in</p>", footer: "" },
    checkOutTemplate: { header: "Hotel", body: "<p>Check-out</p>", footer: "" }
  });

  // load admin print template (admin_print_templates/default)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // helpers
  const fmtIdr = (n) => `IDR ${Number(n || 0).toLocaleString("id-ID")}`;

  // derive items
  const chargeLines = useMemo(() => (displayChargeLines || []).slice(), [displayChargeLines]);
  const paymentLines = useMemo(() => (payments || []).filter(p => ((p.status || "") + "").toLowerCase() !== "void"), [payments]);

  // charge preview (no debounce; immediate)
  const chargePreviewTotal = () => {
    const qty = Math.max(1, Number((chargeForm.qtyStr && chargeForm.qtyStr.replace(/[^\d]/g, "")) || 0) || 1);
    const unit = Math.max(0, Number((chargeForm.unitStr && chargeForm.unitStr.replace(/[^\d]/g, "")) || 0));
    return fmtIdr(qty * unit);
  };
  const paymentPreviewAmount = () => {
    const amt = Math.max(0, Number((paymentForm.amountStr && paymentForm.amountStr.replace(/[^\d]/g, "")) || 0));
    return fmtIdr(amt);
  };

  // Rendering printable HTML using admin templates (safe guards)
  function renderTemplateHtml(mode) {
    if (!mode || typeof mode !== "string") return "";
    const tpl = mode === "checkin" ? templates.checkInTemplate : (mode === "checkout" ? templates.checkOutTemplate : { header: "", body: "", footer: "" });
    if (!tpl || typeof tpl.body !== "string") return "";

    const placeholders = {
      "{{guestName}}": reservation?.guestName || guest?.name || "",
      "{{roomNumber}}": Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : (reservation?.roomNumber || ""),
      "{{checkInDate}}": fmt(reservation?.checkInDate),
      "{{checkOutDate}}": fmt(reservation?.checkOutDate),
      "{{balance}}": fmtIdr(displayBalance),
      "{{staffName}}": (reservation?.createdBy || "Frontdesk")
    };

    let body = tpl.body || "";
    Object.entries(placeholders).forEach(([key, val]) => {
      body = body.split(key).join(val);
    });

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

  // If printMode is active and valid, we render printable area
  const printable = (typeof printMode === "string");

  return (
    <div className="reservation-detail-container card">
      <div className="card-header"><h3>Folio & Payments</h3></div>

      <div className="card-body">
        <div className="summary-bar" style={{ display: "flex", gap: 12 }}>
          <div className="summary-item"><div className="summary-label">Charges</div><div className="summary-value">{fmtIdr(displayChargesTotal)}</div></div>
          <div className="summary-item"><div className="summary-label">Payments</div><div className="summary-value">{fmtIdr(displayPaymentsTotal)}</div></div>
          <div className="summary-item"><div className="summary-label">Balance</div><div className="summary-value" style={{ color: displayBalance > 0 ? "#e11d48" : "#16a34a" }}>{fmtIdr(displayBalance)}</div></div>
        </div>

        <section style={{ marginTop: 12 }}>
          <h4>Itemized Charges</h4>
          <div className="charges-list">
            {chargeLines.length ? chargeLines.map(p => (
              <div key={p.id || Math.random()} className="charge-row">
                <div className="charge-desc">{p.description}</div>
                <div className="charge-amt">{fmtIdr(p.amount)}</div>
              </div>
            )) : <div className="muted">No charges</div>}
          </div>
        </section>

        <section style={{ marginTop: 12 }}>
          <h4>Payments</h4>
          <div className="charges-list">
            {paymentLines.length ? paymentLines.map(p => (
              <div key={p.id || Math.random()} className="charge-row">
                <div className="charge-desc">{p.method} {p.refNo ? `(${p.refNo})` : ""}</div>
                <div className="charge-amt">{fmtIdr(p.amount)}</div>
              </div>
            )) : <div className="muted">No payments</div>}
          </div>
        </section>

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn btn-outline" onClick={() => setShowAddCharge(true)}>Add Charge</button>
          <button className="btn btn-outline" onClick={() => setShowAddPayment(true)}>Add Payment</button>

          {/* Print buttons — show/hide depending on reservation.status */}
          {reservation && (reservation.status || "").toLowerCase() !== "checked-out" && (
            // Hide print-checkout while still checked-in — show print-checkin only if checked-in
            (reservation.status || "").toLowerCase() === "checked-in" && (
              <button className="btn btn-secondary" onClick={() => { /* print check-in form action is handled at parent */ window.alert("Use Print form on top header (or parent)"); }}>Print Check-In Form</button>
            )
          )}

          {reservation && (reservation.status || "").toLowerCase() === "checked-out" && (
            <button className="btn btn-secondary" onClick={() => { if (printCheckOutBill) printCheckOutBill(); }}>Print Check-Out Bill</button>
          )}
        </div>

        {/* Add Charge Modal */}
        {showAddCharge && (
          <div className="modal" role="dialog">
            <div className="modal-content">
              <div className="modal-header"><h4>Add Charge</h4></div>
              <div className="modal-body">
                <label>Description</label>
                <input placeholder="Description" value={chargeForm.description} onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label>Qty</label>
                    <input placeholder="Qty" value={chargeForm.qtyStr} onChange={(e) => setChargeForm({ ...chargeForm, qtyStr: e.target.value })} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label>Unit amount</label>
                    <input placeholder="Unit amount (numbers only)" value={chargeForm.unitStr} onChange={(e) => setChargeForm({ ...chargeForm, unitStr: e.target.value })} />
                  </div>
                </div>

                <label style={{ marginTop: 8 }}>Account</label>
                <select value={chargeForm.accountCode} onChange={(e) => setChargeForm({ ...chargeForm, accountCode: e.target.value })}>
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>

                <div className="muted" style={{ marginTop: 8 }}>Preview total: {chargePreviewTotal()}</div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddCharge(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { await submitCharge(); }}>Add</button>
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
                <label>Amount</label>
                <input placeholder="Amount" value={paymentForm.amountStr} onChange={(e) => setPaymentForm({ ...paymentForm, amountStr: e.target.value })} />
                <div className="muted" style={{ marginTop: 8 }}>Preview: {paymentPreviewAmount()}</div>

                <label style={{ marginTop: 8 }}>Ref / Notes</label>
                <input placeholder="Ref / Notes" value={paymentForm.refNo} onChange={(e) => setPaymentForm({ ...paymentForm, refNo: e.target.value })} />

                <label style={{ marginTop: 8 }}>Method</label>
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="qris">QRIS</option>
                  <option value="ota">OTA</option>
                </select>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddPayment(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { await submitPayment(); }}>Add</button>
              </div>
            </div>
          </div>
        )}

        {/* printable content (rendered only if we are in print mode) */}
{/* Printable section for admin print templates */}
        {printMode && (
          <div
            ref={printRef}
            className="printable"
            style={{
              display: "block",
              background: "#fff",
              color: "#000",
             padding: "24px",
              fontFamily: "Arial, sans-serif",
              fontSize: "13px",
              width: "100%",
              boxSizing: "border-box"
            }}
            dangerouslySetInnerHTML={{
              __html: renderTemplateHtml(printMode)
            }}
          />
        )}
      </div>
    </div>
  );
}
