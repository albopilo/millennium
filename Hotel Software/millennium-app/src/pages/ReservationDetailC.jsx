// src/pages/ReservationDetailC.jsx
import React, { useMemo } from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailC({
  reservation,
  displayChargeLines = [],
  displayChargesTotal = 0,
  displayPaymentsTotal = 0,
  displayBalance = 0,
  currency = "IDR",
  fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID")),
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
  canOperate,
  fmt = (d) => (d ? new Date(d).toLocaleString() : "-"),
  postings = [],
  payments = [],
  guest,
  logReservationChange = () => {},
}) {
  // === Room-based subtotal aggregation ===
  const roomLines = useMemo(() => {
    const roomPostings = (postings || []).filter(
      (p) =>
        ((p.accountCode || "") + "").toUpperCase() === "ROOM" &&
        ((p.status || "") + "").toLowerCase() !== "void"
    );
    const map = {};
    for (const p of roomPostings) {
      const rn = p.roomNumber || "—";
      map[rn] = (map[rn] || 0) + Number(p.amount || 0);
    }
    return Object.keys(map).map((k) => ({ roomNo: k, subtotal: map[k] }));
  }, [postings]);

  // === Handlers ===
  const onSubmitCharge = async () => {
    try {
      await submitCharge();
      logReservationChange("add_charge", { ...chargeForm });
    } catch (err) {
      console.error("Charge failed:", err);
    }
  };

  const onSubmitPayment = async () => {
    try {
      await submitPayment();
      logReservationChange("add_payment", { ...paymentForm });
    } catch (err) {
      console.error("Payment failed:", err);
    }
  };

  return (
    <div className="reservation-detail-container">
      {/* === Folio Summary === */}
      <div className="card">
        <div className="card-header">
          <h3>Folio & Payments</h3>
        </div>

        <div className="card-body">
          <div className="summary-bar">
            <div className="summary-item">
              <div className="summary-label">Charges</div>
              <div className="summary-value text-blue">
                {currency} {fmtMoney(displayChargesTotal)}
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-label">Payments</div>
              <div className="summary-value text-green">
                {currency} {fmtMoney(displayPaymentsTotal)}
              </div>
            </div>
            <div className="summary-item">
              <div className="summary-label">Balance</div>
              <div
                className={`summary-value ${
                  displayBalance > 0 ? "text-red" : "text-green"
                }`}
              >
                {currency} {fmtMoney(displayBalance)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* === Room Charges === */}
      <div className="card">
        <div className="card-header">
          <h4>Room Charges</h4>
        </div>
        <div className="card-body">
          {roomLines.length === 0 ? (
            <div className="empty-state">No room postings.</div>
          ) : (
            <div className="invoice-list">
              {roomLines.map((r) => (
                <div key={r.roomNo} className="invoice-line">
                  <div>Room {r.roomNo}</div>
                  <div className="text-end">
                    {currency} {fmtMoney(r.subtotal)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* === Other Charges === */}
      <div className="card">
        <div className="card-header">
          <h4>Other Charges</h4>
        </div>
        <div className="card-body">
          {displayChargeLines.length === 0 ? (
            <div className="empty-state">No additional charges.</div>
          ) : (
            <div className="invoice-list">
              {displayChargeLines.map((p) => (
                <div key={p.id || p.description} className="invoice-line">
                  <div>{p.description || p.accountCode}</div>
                  <div className="text-end">
                    {currency} {fmtMoney(p.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* === Payments === */}
      <div className="card">
        <div className="card-header">
          <h4>Payments</h4>
        </div>
        <div className="card-body">
          {payments.length === 0 ? (
            <div className="empty-state">No recorded payments.</div>
          ) : (
            <div className="invoice-list">
              {payments.map((p, i) => (
                <div key={i} className="invoice-line">
                  <div>
                    {fmt(p.date)} <br />
                    <small>{p.method?.toUpperCase()}</small>
                  </div>
                  <div className="text-end">
                    {currency} {fmtMoney(p.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* === Add Buttons === */}
      {canOperate && (
        <div className="btn-group">
          <button
            className="btn btn-primary"
            onClick={() => setShowAddCharge(true)}
          >
            + Add Charge
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowAddPayment(true)}
          >
            + Add Payment
          </button>
        </div>
      )}

      {/* === Add Charge Modal === */}
      {showAddCharge && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Charge</h3>
            <div className="modal-body">
              <input
                placeholder="Description"
                value={chargeForm.description}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, description: e.target.value })
                }
              />
              <div className="modal-row">
                <input
                  placeholder="Qty"
                  value={chargeForm.qtyStr}
                  onChange={(e) =>
                    setChargeForm({ ...chargeForm, qtyStr: e.target.value })
                  }
                />
                <input
                  placeholder="Unit"
                  value={chargeForm.unitStr}
                  onChange={(e) =>
                    setChargeForm({ ...chargeForm, unitStr: e.target.value })
                  }
                />
                <select
                  value={chargeForm.accountCode}
                  onChange={(e) =>
                    setChargeForm({
                      ...chargeForm,
                      accountCode: e.target.value,
                    })
                  }
                >
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddCharge(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={onSubmitCharge}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Add Payment Modal === */}
      {showAddPayment && (
        <div className="modal-overlay">
          <div className="modal-card">
            <h3>Add Payment</h3>
            <div className="modal-body">
              <input
                placeholder="Amount"
                value={paymentForm.amountStr}
                onChange={(e) =>
                  setPaymentForm({
                    ...paymentForm,
                    amountStr: e.target.value,
                  })
                }
              />
              <input
                placeholder="Reference / Notes"
                value={paymentForm.refNo}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, refNo: e.target.value })
                }
              />
              <select
                value={paymentForm.method}
                onChange={(e) =>
                  setPaymentForm({ ...paymentForm, method: e.target.value })
                }
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
                <option value="qris">QRIS</option>
                <option value="ota">OTA</option>
              </select>
            </div>

            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddPayment(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={onSubmitPayment}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
