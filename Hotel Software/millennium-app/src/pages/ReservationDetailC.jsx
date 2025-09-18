// src/pages/ReservationDetailC.jsx
import React from "react";

// NOTE: This component is a self-contained presentational + printable Folio.
// Changes in this version:
// - Exposes printCheckInForm / printCheckOutBill props and renders Print buttons
//   in the folio area depending on reservation.status.
// - Makes the payment amount input more resilient (text input + inputMode numeric,
//   and uses functional state updates for setPaymentForm to avoid stale closures).
// - Computes deposit total from existing non-void DEPOSIT postings (defensive).
// - Defensive defaults to avoid crashes when props are missing.

export default function ReservationDetailC(props) {
  // destructure props and give safe defaults
  const {
    // printable
    printRef,
    printMode = null,
    printCheckInForm = null,
    printCheckOutBill = null,

    // reservation + related data (may be undefined initially)
    reservation = null,
    settings = {},
    fmtDMY = (d) => (d ? new Date(d).toLocaleDateString() : "-"),
    calcNights = () => 0,
    adultsChildren = () => "-",
    assignRooms = [],
    rooms = [],
    postings = [],
    getEventForDate = () => null,
    rateFor = () => 0,

    // UI helpers
    currency = "IDR",
    fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID")),

    // folio props (either parent computed or we'll compute fallback)
    visiblePostings = null, // optional, array of postings
    displayChargeLines = null, // optional pre-computed lines
    displayChargesTotal = null,
    displayPaymentsTotal = null,
    displayBalance = null,

    // actions & UI state passed from parent (optional)
    canOperate = false,
    canUpgrade = false,
    canOverrideBilling = false,
    showAddCharge = false,
    setShowAddCharge = () => {},
    chargeForm = { description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" },
    setChargeForm = () => {},
    submitCharge = async () => {},
    showAddPayment = false,
    setShowAddPayment = () => {},
    paymentForm = { amountStr: "", method: "cash", refNo: "", type: "payment" },
    setPaymentForm = () => {},
    submitPayment = async () => {},
    cancelReservation = () => {},
    isAdmin = false,

    // delete modal stuff
    showDeleteModal = false,
    deleteReason = "",
    setDeleteReason = () => {},
    deleting = false,
    closeDeleteModal = () => {},
    deleteReservation = async () => {},
    confirmDeleteReservation = async () => {},
    // additional missing values previously causing no-undef
    guest,
    fmt,

    // extra: display totals if parent provided, else compute
    payments = [],
  } = props;

  // Defensive local helpers
  const safeVisiblePostings = Array.isArray(displayChargeLines)
    ? displayChargeLines
    : Array.isArray(visiblePostings)
    ? visiblePostings
    : Array.isArray(postings)
    ? postings.filter((p) => (p.status || "posted") !== "void")
    : [];

  // If displayChargeLines provided explicitly use it; otherwise compute targetStatus + filter
  const isBooked = (reservation?.status || "").toLowerCase() === "booked";
  const targetStatus = isBooked ? "forecast" : "posted";

  const lines =
    Array.isArray(displayChargeLines) ?
      displayChargeLines :
      safeVisiblePostings.filter((p) => ((p.status || "") + "").toLowerCase() === targetStatus && (p.accountCode || "") !== "PAY");

  // Totals (use provided totals if present; otherwise compute)
  const computedChargesTotal =
    typeof displayChargesTotal === "number"
      ? displayChargesTotal
      : lines.reduce((sum, p) => sum + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0);

  const computedPaymentsTotal =
    typeof displayPaymentsTotal === "number"
      ? displayPaymentsTotal
      : (Array.isArray(payments) ? payments.filter((p) => p.status !== "void" && p.status !== "refunded") : []).reduce(
          (sum, p) => sum + Number(p.amount || 0),
          0
        );

  const computedBalance =
    typeof displayBalance === "number" ? displayBalance : computedChargesTotal - computedPaymentsTotal;

  // deposit computed from existing (non-void) DEPOSIT postings for accuracy
  const computedDepositTotal = postings
    .filter(
      (p) =>
        ((p.accountCode || "") + "").toUpperCase() === "DEPOSIT" &&
        ((p.status || "") + "").toLowerCase() !== "void"
    )
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // inner FolioTotals component (defensive)
  function FolioTotals() {
    const resStatus = ((reservation?.status || "") + "").toLowerCase();

    return (
      <div className="reservation-form folio" style={{ marginBottom: 12, width: "100%" }}>
        <h4 style={{ marginBottom: 8 }}>Folio</h4>

        <div className="folio-header">
          <div className="h-desc">Description</div>
          <div className="h-account">Account</div>
          <div className="h-status">Status</div>
          <div className="h-amount">Amount</div>
        </div>

        <div className="folio-lines">
          {lines.length === 0 ? (
            <div className="folio-empty">No charges yet.</div>
          ) : (
            lines.map((p) => (
              <div key={p.id || `${p.description}-${Math.random()}`} className="folio-line">
                <div className="f-desc">{p.description || "-"}</div>
                <div className="f-account">{p.accountCode || "-"}</div>
                <div className="f-status">{p.status || "-"}</div>
                <div className="f-amount">
                  {currency} {fmtMoney(Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="folio-totals">
          <div className="tot-row">
            <div className="t-label">Charges</div>
            <div className="t-value">{currency} {fmtMoney(computedChargesTotal)}</div>
          </div>
          <div className="tot-row">
            <div className="t-label">Payments</div>
            <div className="t-value">{currency} {fmtMoney(computedPaymentsTotal)}</div>
          </div>
          <div className="tot-row">
            <div className="t-label">Deposit</div>
            <div className="t-value">{currency} {fmtMoney(computedDepositTotal)}</div>
          </div>
          <div className="tot-row grand">
            <div className="t-label">Balance</div>
            <div className="t-value">{currency} {fmtMoney(computedBalance)}</div>
          </div>
        </div>

        {/* Actions: show Print buttons depending on reservation status */}
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canOperate && (
            <>
              <button onClick={() => (typeof setShowAddCharge === "function" ? setShowAddCharge((s) => !s) : null)}>
                Add charge
              </button>
              <button onClick={() => (typeof setShowAddPayment === "function" ? setShowAddPayment((s) => !s) : null)}>
                Add payment
              </button>
            </>
          )}

          {/* Print Check-in Form: only visible when reservation is checked-in */}
          {resStatus === "checked-in" && typeof printCheckInForm === "function" && (
            <button onClick={printCheckInForm}>Print Check-in Form</button>
          )}

          {/* Print Check-out Bill: only visible when reservation is checked-out */}
          {resStatus === "checked-out" && typeof printCheckOutBill === "function" && (
            <button onClick={printCheckOutBill}>Print Check-out Bill</button>
          )}

          {isAdmin && (
            <button style={{ marginLeft: 8 }} onClick={cancelReservation}>
              Cancel Reservation
            </button>
          )}
        </div>

        {showAddCharge && (
          <div style={{ marginTop: 12 }}>
            <h5>Add Charge</h5>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                placeholder="Description"
                value={chargeForm.description}
                onChange={(e) => setChargeForm({ ...chargeForm, description: e.target.value })}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  placeholder="Qty"
                  value={chargeForm.qtyStr}
                  onChange={(e) => setChargeForm({ ...chargeForm, qtyStr: e.target.value })}
                />
                <input
                  placeholder="Unit amount"
                  value={chargeForm.unitStr}
                  onChange={(e) => setChargeForm({ ...chargeForm, unitStr: e.target.value })}
                />
                <select
                  value={chargeForm.accountCode}
                  onChange={(e) => setChargeForm({ ...chargeForm, accountCode: e.target.value })}
                >
                  <option value="MISC">MISC</option>
                  <option value="ROOM">ROOM</option>
                  <option value="DEPOSIT">DEPOSIT</option>
                  <option value="ADJ">ADJ</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={submitCharge}>Save charge</button>
                <button onClick={() => setShowAddCharge(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showAddPayment && (
          <div style={{ marginTop: 12 }}>
            <h5>Add Payment</h5>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                placeholder="Amount"
                // use text input + inputMode numeric to allow flexible edits (no coercion on every keystroke)
                type="text"
                inputMode="numeric"
                value={paymentForm.amountStr}
                onChange={(e) =>
                  // functional update to avoid stale closure issues if parent passes a setter
                  setPaymentForm((prev) => ({ ...prev, amountStr: e.target.value }))
                }
              />
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, method: e.target.value }))}
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank Transfer</option>
                </select>
                <input
                  placeholder="Reference / notes"
                  value={paymentForm.refNo}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, refNo: e.target.value }))}
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={async () => {
                    // call parent submitPayment (parent is responsible for validation and clearing)
                    await submitPayment();
                    // after submit, ensure local input is cleared if parent didn't (best-effort defensive)
                    try {
                      setPaymentForm((prev) => ({ ...prev, amountStr: "" }));
                      setShowAddPayment(false);
                    } catch (e) {
                      // ignore
                    }
                  }}
                >
                  Save payment
                </button>
                <button
                  onClick={() => {
                    // clear local payment form
                    setPaymentForm((prev) => ({ ...prev, amountStr: "", refNo: "" }));
                    setShowAddPayment(false);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Printable + delete modal are rendered below; they also guard against missing reservation
  return (
    <div>
      {/* render internal FolioTotals (only once, here) */}
      <FolioTotals />

     {/* Printable section */}
<div
  ref={printRef}
  className="printable"
  style={{ display: printMode ? "block" : "none", padding: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}
>
  {/* HEADER */}
  <div style={{ textAlign: "center", marginBottom: 12 }}>
    <div style={{ fontSize: 20, fontWeight: 700 }}>MILLENNIUM INN</div>
    <div>{settings?.hotelAddress || "Jl Kapten Muslim No 178, Medan"}</div>
    <div>{settings?.hotelPhone || "Telp: (061) 1234567"}</div>
    <hr style={{ margin: "12px 0" }} />
  </div>

  {/* CHECK-IN FORM */}
  {printMode === "checkin" && (
    <div>
      <h3 style={{ textAlign: "center", marginBottom: 16 }}>FORMULIR CHECK-IN</h3>

      {/* Guest Info */}
      <table style={{ width: "100%", marginBottom: 12 }}>
        <tbody>
          <tr>
            <td><strong>Tamu</strong></td>
            <td>{reservation?.guestName || "-"}</td>
            <td><strong>Perusahaan</strong></td>
            <td>{reservation?.company || "-"}</td>
          </tr>
          <tr>
            <td><strong>Alamat</strong></td>
            <td>{guest?.address || reservation?.guestAddress || "-"}</td>
            <td><strong>Kota</strong></td>
            <td>{guest?.city || reservation?.guestCity || "-"}</td>
          </tr>
          <tr>
            <td><strong>Telepon</strong></td>
            <td>{guest?.phone || reservation?.guestPhone || "-"}</td>
            <td><strong>Email</strong></td>
            <td>{guest?.email || reservation?.guestEmail || "-"}</td>
          </tr>
          <tr>
            <td><strong>Tgl Check-In</strong></td>
            <td>{fmt(reservation?.checkInDate)}</td>
            <td><strong>Tgl Check-Out</strong></td>
            <td>{fmt(reservation?.checkOutDate)}</td>
          </tr>
          <tr>
            <td><strong>Lama</strong></td>
            <td>{calcNights(reservation)} Malam</td>
            <td><strong>Dewasa/Anak</strong></td>
            <td>{adultsChildren(reservation)}</td>
          </tr>
        </tbody>
      </table>

      {/* Room List */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }} border="1" cellPadding="6">
        <thead>
          <tr style={{ background: "#f2f2f2" }}>
            <th>No</th>
            <th>Kamar</th>
            <th>Tipe</th>
            <th>Tarif / Malam</th>
            <th>Subtotal</th>
          </tr>
        </thead>
        <tbody>
          {reservation?.roomNumbers?.map((roomNo, idx) => {
            const roomType = rooms.find(r => r.roomNumber === roomNo)?.roomType || "-";
            const rate = Math.round(Number(rateFor(roomType, reservation?.channel, new Date(reservation.checkInDate?.toDate?.() || reservation.checkInDate))) || 0);
            return (
              <tr key={roomNo}>
                <td>{idx + 1}</td>
                <td>{roomNo}</td>
                <td>{roomType}</td>
                <td>{currency} {fmtMoney(rate)}</td>
                <td>{currency} {fmtMoney(rate * calcNights(reservation))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ textAlign: "right", marginBottom: 24 }}>
        <div>Subtotal: {currency} {fmtMoney(computedChargesTotal)}</div>
        <div>Deposit: {currency} {fmtMoney(computedDepositTotal)}</div>
      </div>

      {/* Signatures */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
        <div style={{ textAlign: "center", width: "40%" }}>
          <div>____________________</div>
          <div>Tanda Tangan Tamu</div>
        </div>
        <div style={{ textAlign: "center", width: "40%" }}>
          <div>____________________</div>
          <div>Petugas ({reservation?.createdBy || "Hotel Staff"})</div>
        </div>
      </div>
    </div>
  )}

  {/* CHECK-OUT BILL */}
  {printMode === "checkout" && (
    <div>
      <h3 style={{ textAlign: "center", marginBottom: 16 }}>CHECK-OUT BILL</h3>

      {/* Folio Breakdown */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }} border="1" cellPadding="6">
        <thead>
          <tr style={{ background: "#f2f2f2" }}>
            <th>Description</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((p, idx) => (
            <tr key={p.id || idx}>
              <td>{p.description}</td>
              <td style={{ textAlign: "right" }}>
                {currency} {fmtMoney(Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Totals */}
      <div style={{ textAlign: "right", marginBottom: 24 }}>
        <div>Total Charges: {currency} {fmtMoney(computedChargesTotal)}</div>
        <div>Payments: {currency} {fmtMoney(computedPaymentsTotal)}</div>
        <div>Deposit: {currency} {fmtMoney(computedDepositTotal)}</div>
        <div style={{ fontWeight: 700, marginTop: 8 }}>Balance: {currency} {fmtMoney(computedBalance)}</div>
      </div>

      {/* Signatures */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40 }}>
        <div style={{ textAlign: "center", width: "40%" }}>
          <div>____________________</div>
          <div>Tanda Tangan Tamu</div>
        </div>
        <div style={{ textAlign: "center", width: "40%" }}>
          <div>____________________</div>
          <div>Petugas ({reservation?.createdBy || "Hotel Staff"})</div>
        </div>
      </div>
    </div>
  )}
</div>

    </div>
  );
}
