// src/pages/ReservationDetailC.jsx
import React, { useMemo } from "react";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailC
 * ------------------
 * Pure presentation layer for folio and payments section.
 * Uses modals and handlers from parent ReservationDetailA.
 * - All monetary inputs are instant (no debounce)
 * - Unified modal structure (same markup as ReservationDetailA)
 * - Displays charges, payments, and room subtotals
 * - Supports linked print actions (AdminPrintTemplate)
 */

export default function ReservationDetailC({
  reservation,
  guest,
  postings = [],
  payments = [],
  currency = "IDR",
  fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 }),
  // Modal controls passed from parent
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
  canOperate = false,
  printCheckInForm,
  printCheckOutBill,
}) {
  // === Derived Values ===
  const visiblePostings = useMemo(
    () => postings.filter((p) => ((p.status || "") + "").toLowerCase() !== "void"),
    [postings]
  );

  const chargesTotal = visiblePostings.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paymentsTotal = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const balance = chargesTotal - paymentsTotal;

  // === Room Subtotals (optional) ===
  const roomSubtotals = useMemo(() => {
    const map = {};
    for (const p of visiblePostings) {
      const room = p.roomNumber || "—";
      map[room] = (map[room] || 0) + Number(p.amount || 0);
    }
    return Object.entries(map).map(([room, subtotal]) => ({ room, subtotal }));
  }, [visiblePostings]);

  // === UI ===
  return (
    <div className="card panel">
      {/* Header */}
      <div className="panel-header">
        <h3>Folio & Payments</h3>
        <div style={{ textAlign: "right" }}>
          <div className="muted">
            Charges: {currency} {fmtMoney(chargesTotal)}
          </div>
          <div className="muted">
            Payments: {currency} {fmtMoney(paymentsTotal)}
          </div>
          <div style={{ fontWeight: 700 }}>
            Balance: {currency} {fmtMoney(balance)}
          </div>
        </div>
      </div>

      {/* Folio Body */}
      <div className="panel-body space-y-4">
        {/* === Room Subtotals === */}
        {roomSubtotals.length > 0 && (
          <div className="subsection">
            <h4>Room Summary</h4>
            {roomSubtotals.map((r) => (
              <div key={r.room} className="line-row">
                <div>Room {r.room}</div>
                <div>{currency} {fmtMoney(r.subtotal)}</div>
              </div>
            ))}
          </div>
        )}

        {/* === Charges === */}
        <div className="subsection">
          <h4>Charges</h4>
          {visiblePostings.length === 0 ? (
            <div className="muted">No charges recorded.</div>
          ) : (
            visiblePostings.map((p) => (
              <div key={p.id || p.description} className="line-row">
                <div>{p.description || p.accountCode}</div>
                <div>{currency} {fmtMoney(p.amount)}</div>
              </div>
            ))
          )}
        </div>

        {/* === Payments === */}
        <div className="subsection">
          <h4>Payments</h4>
          {payments.length === 0 ? (
            <div className="muted">No payments recorded.</div>
          ) : (
            payments.map((p) => (
              <div key={p.id || p.refNo} className="line-row">
                <div>
                  {new Date(
                    p.capturedAt?.seconds
                      ? p.capturedAt.seconds * 1000
                      : p.capturedAt || Date.now()
                  ).toLocaleString()}
                  <br />
                  <span className="muted">({p.method?.toUpperCase()})</span>
                </div>
                <div>{currency} {fmtMoney(p.amount)}</div>
              </div>
            ))
          )}
        </div>

        {/* === Actions === */}
        {canOperate && (
          <div className="action-bar flex-wrap">
            <button className="btn btn-primary" onClick={() => setShowAddCharge(true)}>
              + Add Charge
            </button>
            <button className="btn btn-primary" onClick={() => setShowAddPayment(true)}>
              + Add Payment
            </button>

            {/* Print Actions */}
            {reservation?.status?.toLowerCase() === "booked" && (
              <button className="btn btn-secondary" onClick={printCheckInForm}>
                🖨 Print Check-In Form
              </button>
            )}
            {reservation?.status?.toLowerCase() === "checked-out" && (
              <button className="btn btn-secondary" onClick={printCheckOutBill}>
                🧾 Print Check-Out Bill
              </button>
            )}
          </div>
        )}
      </div>

      {/* === Add Charge Modal === */}
      {showAddCharge && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-md w-96">
            <h3 className="text-lg font-semibold mb-4">Add Charge</h3>
            <label className="block text-sm mb-1">Description</label>
            <input
              className="border rounded-md w-full mb-3 p-2"
              placeholder="e.g., Room Service"
              value={chargeForm.description}
              onChange={(e) =>
                setChargeForm({ ...chargeForm, description: e.target.value })
              }
            />

            <div className="flex gap-3 mb-3">
              <input
                className="border rounded-md w-1/3 p-2"
                placeholder="Qty"
                value={chargeForm.qtyStr}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, qtyStr: e.target.value })
                }
              />
              <input
                className="border rounded-md w-1/3 p-2"
                placeholder="Unit"
                value={chargeForm.unitStr}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, unitStr: e.target.value })
                }
              />
              <select
                className="border rounded-md w-1/3 p-2"
                value={chargeForm.accountCode}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, accountCode: e.target.value })
                }
              >
                <option value="MISC">MISC</option>
                <option value="ROOM">ROOM</option>
                <option value="DEPOSIT">DEPOSIT</option>
                <option value="UPGRADE">UPGRADE</option>
              </select>
            </div>

            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md"
                onClick={() => setShowAddCharge(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-md"
                onClick={submitCharge}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Add Payment Modal === */}
      {showAddPayment && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-md w-96">
            <h3 className="text-lg font-semibold mb-4">Add Payment</h3>

            <label className="block text-sm mb-1">Amount</label>
            <input
              type="text"
              className="border rounded-md w-full mb-3 p-2"
              placeholder="100000"
              value={paymentForm.amountStr}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, amountStr: e.target.value })
              }
            />

            <label className="block text-sm mb-1">Reference / Note</label>
            <input
              className="border rounded-md w-full mb-3 p-2"
              placeholder="Ref number or note"
              value={paymentForm.refNo}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, refNo: e.target.value })
              }
            />

            <label className="block text-sm mb-1">Payment Method</label>
            <select
              className="border rounded-md w-full mb-4 p-2"
              value={paymentForm.method}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, method: e.target.value })
              }
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Bank Transfer</option>
              <option value="qris">QRIS</option>
              <option value="ota">OTA</option>
            </select>

            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md"
                onClick={() => setShowAddPayment(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-600 text-white rounded-md"
                onClick={submitPayment}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
