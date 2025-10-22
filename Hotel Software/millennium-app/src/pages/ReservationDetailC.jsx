// src/pages/ReservationDetailC.jsx
import React, { useEffect, useMemo, useState } from "react";
import "../styles/ReservationDetail.css";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Props:
 * - reservation, guest, postings, payments, displayChargeLines, displayChargesTotal, displayPaymentsTotal, displayBalance
 * - showAddCharge, setShowAddCharge, chargeForm, setChargeForm, submitCharge
 * - showAddPayment, setShowAddPayment, paymentForm, setPaymentForm, submitPayment
 * - printRef, printMode ('checkin' or 'checkout') to render the selected admin template
 */
export default function ReservationDetailC({
  reservation,
  guest,
  postings = [],
  payments = [],
  displayChargeLines = [],
  displayChargesTotal = 0,
  displayPaymentsTotal = 0,
  displayBalance = 0,
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
  settings = { currency: "IDR" },
  fmt = (d) => (d ? new Date(d).toLocaleString() : "-"),
}) {
  const [adminTemplates, setAdminTemplates] = useState({
    checkInTemplate: { header: "Hotel", body: "<p>Check-in</p>", footer: "" },
    checkOutTemplate: { header: "Hotel", body: "<p>Check-out</p>", footer: "" }
  });

  // fetch admin templates once (from Firestore doc path 'admin_print_templates/default')
  useEffect(() => {
    let mounted = true;
    async function loadTpl() {
      try {
        const tdoc = await getDoc(doc(db, "admin_print_templates", "default"));
        if (!mounted) return;
        if (tdoc.exists()) {
          setAdminTemplates(tdoc.data());
        }
      } catch (err) {
        console.warn("Failed to load admin print templates:", err);
      }
    }
    loadTpl();
    return () => { mounted = false; };
  }, []);

  // prepare printable HTML by replacing placeholders
  const makePrintableHtml = (mode) => {
    const tpl = mode === "checkin" ? adminTemplates.checkInTemplate : adminTemplates.checkOutTemplate;
    if (!tpl) return "<div>No template</div>";

    const placeholders = {
      "{{guestName}}": guest?.name || reservation?.guestName || "",
      "{{roomNumber}}": Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : (reservation?.roomNumber || ""),
      "{{checkInDate}}": fmt(reservation?.checkInDate),
      "{{checkOutDate}}": fmt(reservation?.checkOutDate),
      "{{balance}}": `${settings.currency || "IDR"} ${Number(displayBalance || 0).toLocaleString("id-ID")}`,
      "{{staffName}}": "Frontdesk",
    };

    let html = (tpl.body || "");
    Object.entries(placeholders).forEach(([k,v]) => {
      html = html.split(k).join(v);
    });

    const header = (tpl.header || "");
    const footer = (tpl.footer || "");
    return `
      <div style="font-family: Arial, sans-serif; color: #111;">
        <div style="text-align:center; font-weight:700; font-size:18px; margin-bottom:10px;">${header}</div>
        <hr/>
        <div style="margin:10px 0;">${html}</div>
        <hr/>
        <div style="text-align:center; font-size:12px; margin-top:8px;">${footer}</div>
      </div>
    `;
  };

  // compute room lines subtotal
  const roomLines = useMemo(() => {
    const roomPostings = (postings || []).filter(p => ((p.accountCode || "") + "").toUpperCase() === "ROOM" && ((p.status || "") + "").toLowerCase() !== "void");
    const map = {};
    for (const p of roomPostings) {
      const rn = p.roomNumber || "—";
      map[rn] = (map[rn] || 0) + Number(p.amount || 0);
    }
    return Object.keys(map).map(k => ({ roomNo: k, subtotal: map[k] }));
  }, [postings]);

  return (
    <div className="reservation-detail-container card">
      <div className="card-header">
        <h3>Folio & Payments</h3>
      </div>
      <div className="card-body">
        <div className="summary-bar">
          <div className="summary-item"><div className="summary-label">Charges</div><div className="summary-value">{settings.currency} {Number(displayChargesTotal || 0).toLocaleString("id-ID")}</div></div>
          <div className="summary-item"><div className="summary-label">Payments</div><div className="summary-value">{settings.currency} {Number(displayPaymentsTotal || 0).toLocaleString("id-ID")}</div></div>
          <div className="summary-item"><div className="summary-label">Balance</div><div className="summary-value text-red">{settings.currency} {Number(displayBalance || 0).toLocaleString("id-ID")}</div></div>
        </div>

        <section>
          <h4>Itemized Charges</h4>
          <div className="charges-list">
            {displayChargeLines.map(p => (
              <div key={p.id || `${p.description}-${Math.random()}`} className="charge-row">
                <div className="charge-desc">{p.description}</div>
                <div className="charge-amt">{settings.currency} {Number(p.amount || 0).toLocaleString("id-ID")}</div>
              </div>
            ))}
            {displayChargeLines.length === 0 && <div className="muted">No charges</div>}
          </div>
        </section>

        <section>
          <h4>Payments</h4>
          <div className="charges-list">
            {payments.map(p => (
              <div key={p.id} className="payment-row">
                <div className="charge-desc">{p.method} {p.refNo ? `(${p.refNo})` : ""}</div>
                <div className="charge-amt">{settings.currency} {Number(p.amount || 0).toLocaleString("id-ID")}</div>
              </div>
            ))}
            {payments.length === 0 && <div className="muted">No payments</div>}
          </div>
        </section>

        {/* Add charge / payment dialogs (simple inline modals) */}
        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn btn-outline" onClick={() => setShowAddCharge(true)}>Add Charge</button>
          <button className="btn btn-outline" onClick={() => setShowAddPayment(true)}>Add Payment</button>
        </div>

        {showAddCharge && (
          <div className="modal" role="dialog" style={{ display: "block" }}>
            <div className="modal-content">
              <div className="modal-header"><h4>Add Charge</h4></div>
              <div className="modal-body">
                <input placeholder="Description" value={chargeForm.description} onChange={(e) => setChargeForm({...chargeForm, description: e.target.value})} />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <input placeholder="Qty" value={chargeForm.qtyStr} onChange={(e) => setChargeForm({...chargeForm, qtyStr: e.target.value})} />
                  <input placeholder="Unit amount" value={chargeForm.unitStr} onChange={(e) => setChargeForm({...chargeForm, unitStr: e.target.value})} />
                </div>
                <select value={chargeForm.accountCode} onChange={(e) => setChargeForm({...chargeForm, accountCode: e.target.value})} style={{ marginTop: 8 }}>
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setShowAddCharge(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={async () => { await submitCharge(); }}>Add</button>
              </div>
            </div>
          </div>
        )}

        {showAddPayment && (
          <div className="modal" role="dialog" style={{ display: "block" }}>
            <div className="modal-content">
              <div className="modal-header"><h4>Add Payment</h4></div>
              <div className="modal-body">
                <input placeholder="Amount" value={paymentForm.amountStr} onChange={(e) => setPaymentForm({...paymentForm, amountStr: e.target.value})} />
                <input placeholder="Reference / Notes" value={paymentForm.refNo} onChange={(e) => setPaymentForm({...paymentForm, refNo: e.target.value})} />
                <select value={paymentForm.method} onChange={(e) => setPaymentForm({...paymentForm, method: e.target.value})} >
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

        {/* Printable area (hidden for normal render; printed when printMode is set) */}
        <div style={{ display: printMode ? "block" : "none" }}>
          <div ref={printRef} className="printable">
            <div dangerouslySetInnerHTML={{ __html: makePrintableHtml(printMode) }} />
          </div>
        </div>
      </div>
    </div>
  );
}
