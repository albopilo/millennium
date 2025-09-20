// src/pages/ReservationDetailC.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function ReservationDetailC(props) {
  const {
    // printable
    printRef,
    printMode = null,
    printCheckInForm = null,
    printCheckOutBill = null,

    // reservation + related data (may be undefined initially)
    reservation = null,
    settings = {},
    fmt = (d) => (d ? new Date(d).toLocaleString() : "-"),
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
    visiblePostings = null,
    displayChargeLines = null,
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

    // delete modal stuff (keep if parent uses)
    showDeleteModal = false,
    deleteReason = "",
    setDeleteReason = () => {},
    deleting = false,
    closeDeleteModal = () => {},
    deleteReservation = async () => {},
    confirmDeleteReservation = async () => {},

    // additional
    guest,

    // payments array passed from parent
    payments = [],

    // logging callback: implement logging (who/where) in ReservationDetailB.jsx or parent
    logReservationChange = () => {},

    // OPTIONAL hook: parent can pass a function to persist early-departure postings/payments
    // signature: async ({ penalty, refund, unusedNights, actualCheckOutDate }) => { ... }
    applyEarlyDepartureAdjustments = null,
  } = props;

  // 🔹 NEW: load print template config
  const [templateConfig, setTemplateConfig] = useState({
    header: "MILLENNIUM INN",
    footer: "Thank you for staying with us!",
    showPaymentBreakdown: true,
    paymentTypes: ["Cash", "QRIS", "OTA", "Debit", "Credit"],
  });

  // 🔹 NEW: load early departure policy (fallback to settings prop)
  const [earlyDepartureConfig, setEarlyDepartureConfig] = useState({
    penaltyPercent: 0,
    refundPercent: 0,
  });

  useEffect(() => {
    async function loadTemplate() {
      try {
        const snap = await getDoc(doc(db, "settings", "printTemplates"));
        if (snap.exists()) {
          const data = snap.data();
          setTemplateConfig((prev) => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.error("Failed to load printTemplates:", err);
      }
    }
    loadTemplate();
  }, []);

  useEffect(() => {
    let mounted = true;
    async function loadEarlyDeparture() {
      try {
        // prefer explicit settings prop if it contains earlyDeparture
        if (settings && settings.earlyDeparture) {
          if (!mounted) return;
          setEarlyDepartureConfig((prev) => ({ ...prev, ...settings.earlyDeparture }));
          return;
        }
        const snap = await getDoc(doc(db, "settings", "earlyDeparture"));
        if (!mounted) return;
        if (snap.exists()) {
          setEarlyDepartureConfig((prev) => ({ ...prev, ...snap.data() }));
        }
      } catch (err) {
        console.error("Failed to load earlyDeparture settings:", err);
      }
    }
    loadEarlyDeparture();
    return () => {
      mounted = false;
    };
  }, [settings]);

  // Defensive posted lines selection (fallback precedence)
  const safeVisiblePostings = Array.isArray(displayChargeLines)
    ? displayChargeLines
    : Array.isArray(visiblePostings)
    ? visiblePostings
    : Array.isArray(postings)
    ? postings.filter((p) => ((p.status || "posted") + "").toLowerCase() !== "void")
    : [];

  const isBooked = ((reservation?.status || "") + "").toLowerCase() === "booked";
  const targetStatus = isBooked ? "forecast" : "posted";

  // Base lines selection (we exclude PAY lines as before)
  let baseLines =
    Array.isArray(displayChargeLines)
      ? displayChargeLines
      : safeVisiblePostings.filter(
          (p) =>
            (((p.status || "") + "").toLowerCase() === targetStatus ||
              (((p.status || "") + "").toLowerCase() === "posted" && targetStatus === "posted")) &&
            ((p.accountCode || "") + "").toUpperCase() !== "PAY"
        );

  // IMPORTANT: exclude DEPOSIT from "charges" — deposits are not revenue
  const lines = baseLines.filter((p) => ((p.accountCode || "") + "").toUpperCase() !== "DEPOSIT");

  // Totals (charges exclude DEPOSIT now)
  const computedChargesTotal =
    typeof displayChargesTotal === "number"
      ? displayChargesTotal
      : lines.reduce((sum, p) => sum + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0);

  // valid payments: exclude void/refunded
  const validPayments = Array.isArray(payments)
    ? payments.filter((p) => {
        const st = ((p.status || "") + "").toLowerCase();
        return st !== "void" && st !== "refunded";
      })
    : [];

  const computedPaymentsTotal =
    typeof displayPaymentsTotal === "number"
      ? displayPaymentsTotal
      : validPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // deposit computed from existing (non-void) DEPOSIT postings for accuracy
  const computedDepositTotal = postings
    .filter(
      (p) =>
        ((p.accountCode || "") + "").toUpperCase() === "DEPOSIT" &&
        ((p.status || "") + "").toLowerCase() !== "void"
    )
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  // === Aggregate postings, room charges and other charges ===
  const activePostings = Array.isArray(postings)
    ? postings.filter((p) => (((p.status || "") + "").toLowerCase() !== "void"))
    : [];

  // Room postings (posted by accountCode 'ROOM')
  const roomPostings = activePostings.filter(
    (p) => (((p.accountCode || "") + "").toUpperCase() === "ROOM")
  );

  // Other charge postings (exclude ROOM, DEPOSIT, PAY)
  const otherChargePostings = activePostings.filter((p) => {
    const ac = ((p.accountCode || "") + "").toUpperCase();
    return ac !== "ROOM" && ac !== "DEPOSIT" && ac !== "PAY";
  });

  // Map room postings to roomNumber => posted total (if posting includes roomNumber)
  const postingsByRoom = {};
  roomPostings.forEach((p) => {
    const rn = p.roomNumber || p.room || p.roomNo || null;
    const amt = Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0);
    if (rn) {
      postingsByRoom[String(rn)] = (postingsByRoom[String(rn)] || 0) + amt;
    }
  });

  const nights = typeof calcNights === "function" ? Math.max(1, calcNights(reservation)) : 1;

  // Build per-room rate/subtotal details (prefer posted totals if available, otherwise use rateFor)
  const roomChargeDetails = (Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers : []).map(
    (roomNo) => {
      const roomType = rooms.find((r) => r.roomNumber === roomNo)?.roomType || "-";
      const postedTotal = postingsByRoom[String(roomNo)] || null;
      let rate = 0;
      let subtotal = 0;
      if (postedTotal && nights > 0) {
        rate = Math.round(postedTotal / nights);
        subtotal = postedTotal;
      } else {
        rate = Math.round(
          Number(
            rateFor(
              roomType,
              reservation?.channel,
              new Date(reservation.checkInDate?.toDate?.() || reservation.checkInDate)
            )
          ) || 0
        );
        subtotal = rate * nights;
      }
      return { roomNo, roomType, rate, subtotal };
    }
  );

  const roomChargesTotal = roomChargeDetails.reduce((s, r) => s + Number(r.subtotal || 0), 0);
  const otherChargesTotal = otherChargePostings.reduce(
    (s, p) => s + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0),
    0
  );

  // final combined charges total (excludes deposits)
  const finalChargesTotal = roomChargesTotal + otherChargesTotal;

  // Balance (assume deposit returned at checkout, so subtract it)
  const computedBalance =
    typeof displayBalance === "number"
      ? displayBalance
      : computedChargesTotal - computedPaymentsTotal - computedDepositTotal;

  // Helper to normalize payment method strings into canonical types used by the template
  function mapMethodToType(method) {
    if (!method) return "Other";
    const m = (method + "").toLowerCase();
    if (m.includes("cash")) return "Cash";
    if (m.includes("qris") || m.includes("qr") || m.includes("qrcode")) return "QRIS";
    if (m.includes("ota")) return "OTA";
    if (m.includes("debit")) return "Debit";
    if (m.includes("credit")) return "Credit";
    if (m.includes("card")) return "Credit";
    if (m.includes("bank") || m.includes("transfer") || m.includes("va")) return "Bank";
    return "Other";
  }

  // Compute paymentsByType in a robust way by mapping each payment to a canonical label
  const paymentsByType = {};
  const typesList = Array.isArray(templateConfig.paymentTypes)
    ? templateConfig.paymentTypes.slice()
    : ["Cash", "QRIS", "OTA", "Debit", "Credit"];

  // initialize
  for (const t of typesList) paymentsByType[t] = 0;
  paymentsByType["Other"] = paymentsByType["Other"] || 0;

  for (const p of validPayments) {
    const t = mapMethodToType(p.method || p.type || "");
    if (!paymentsByType[t] && typesList.indexOf(t) === -1) paymentsByType[t] = 0;
    paymentsByType[t] = (paymentsByType[t] || 0) + Number(p.amount || 0);
  }

  // -------------------------
  // Early departure preview
  // -------------------------
  // Skip preview if there are already early-departure lines persisted (we don't want to double-count).
  const hasPersistedEarlyDepartureLines = activePostings.some((p) =>
    ["EARLY_PENALTY", "EARLY_REFUND", "EARLY_DEPARTURE"].includes(((p.accountCode || "") + "").toUpperCase())
  );

  function _toDate(v) {
    if (!v) return null;
    return typeof v?.toDate === "function" ? v.toDate() : new Date(v);
  }

  function computeEarlyDeparturePreview({ actualCheckoutDate = new Date() } = {}) {
    // if policy zeros out both -> no adjustment.
    const penaltyPercent = Number(earlyDepartureConfig?.penaltyPercent || 0);
    const refundPercent = Number(earlyDepartureConfig?.refundPercent || 0);
    if (penaltyPercent === 0 && refundPercent === 0) {
      return { applicable: false, unusedNights: 0, unusedAmount: 0, penalty: 0, refund: 0 };
    }
    // if persisted already, don't preview (prevents double counting)
    if (hasPersistedEarlyDepartureLines) {
      return { applicable: false, unusedNights: 0, unusedAmount: 0, penalty: 0, refund: 0 };
    }

    const checkIn = _toDate(reservation?.checkInDate) || new Date();
    const scheduledCheckOut = _toDate(reservation?.checkOutDate) || new Date(checkIn.getTime() + nights * 24 * 3600 * 1000);
    // scheduled nights already in variable 'nights'
    const scheduledNights = nights;

    // compute actual nights stayed using actualCheckoutDate
    const aCheckout = actualCheckoutDate instanceof Date ? actualCheckoutDate : new Date(actualCheckoutDate);
    // normalize time-of-day: we want integer count of nights; use difference in ms divided by 24h and round up
    const msPerDay = 24 * 3600 * 1000;
    let actualNights = Math.max(1, Math.ceil((aCheckout - checkIn) / msPerDay));
    if (!isFinite(actualNights) || actualNights < 0) actualNights = 1;

    const unusedNights = Math.max(0, scheduledNights - actualNights);
    if (unusedNights <= 0) {
      return { applicable: false, unusedNights: 0, unusedAmount: 0, penalty: 0, refund: 0 };
    }

    // compute per-night total (sum of room rates per night)
    const perNightTotal = roomChargeDetails.reduce((s, r) => s + Number(r.rate || 0), 0);
    const unusedAmount = perNightTotal * unusedNights;

    const penalty = Math.round((unusedAmount * penaltyPercent) / 100);
    const refund = Math.round((unusedAmount * refundPercent) / 100);

    return {
      applicable: true,
      unusedNights,
      unusedAmount,
      penalty,
      refund,
      perNightTotal,
      actualNights,
    };
  }

  // preview based on "if checkout now"
  const previewNow = computeEarlyDeparturePreview({ actualCheckoutDate: new Date() });

  // compute adjusted totals (UI-only preview)
  const computedChargesTotalAdjusted = computedChargesTotal + (previewNow.penalty || 0);
  const computedPaymentsTotalAdjusted = computedPaymentsTotal + (previewNow.refund || 0);
  const computedBalanceAdjusted = (computedBalance || 0) + (previewNow.penalty || 0) - (previewNow.refund || 0);

  // action wrappers that also call the logging callback (logger should be provided by ReservationDetailB.jsx)
  const handleSubmitCharge = async () => {
    const snapshot = { ...chargeForm };
    try {
      await submitCharge();
      if (typeof logReservationChange === "function") {
        logReservationChange({
          reservationId: reservation?.id || reservation?.reservationId || null,
          action: "add_charge",
          data: snapshot,
          ts: Date.now(),
        });
      }
    } catch (err) {
      console.error("submitCharge failed:", err);
      throw err;
    }
  };

  const handleSubmitPayment = async () => {
    const snapshot = { ...paymentForm };
    try {
      await submitPayment();
      if (typeof logReservationChange === "function") {
        logReservationChange({
          reservationId: reservation?.id || reservation?.reservationId || null,
          action: "add_payment",
          data: snapshot,
          ts: Date.now(),
        });
      }
    } catch (err) {
      console.error("submitPayment failed:", err);
      throw err;
    }
  };

  const handleCancelReservation = async () => {
    try {
      await cancelReservation();
      if (typeof logReservationChange === "function") {
        logReservationChange({
          reservationId: reservation?.id || reservation?.reservationId || null,
          action: "cancel_reservation",
          data: { reason: deleteReason || null },
          ts: Date.now(),
        });
      }
    } catch (err) {
      console.error("cancelReservation failed:", err);
      throw err;
    }
  };

  // --------- UPDATED handleCheckout: call optional apply hook BEFORE actual checkout -------------
  const handleCheckout = async () => {
    try {
      // compute preview based on "checkout now"
      const adj = computeEarlyDeparturePreview({ actualCheckoutDate: new Date() });

      // If parent provided applyEarlyDepartureAdjustments, call it so parent can persist postings/payments
      if (adj.applicable && typeof applyEarlyDepartureAdjustments === "function") {
        try {
          await applyEarlyDepartureAdjustments({
            penalty: adj.penalty,
            refund: adj.refund,
            unusedNights: adj.unusedNights,
            perNightTotal: adj.perNightTotal,
            actualCheckOutDate: new Date(),
          });
          // record in change log
          if (typeof logReservationChange === "function") {
            logReservationChange({
              reservationId: reservation?.id || reservation?.reservationId || null,
              action: "apply_early_departure_adjustment",
              data: { penalty: adj.penalty, refund: adj.refund, unusedNights: adj.unusedNights },
            });
          }
        } catch (err) {
          console.error("applyEarlyDepartureAdjustments failed:", err);
          // Continue to attempt checkout even if the optional persistence failed (you can change this)
        }
      }

      // then perform actual checkout via parent callback
      if (typeof props.checkoutReservation === "function") {
        await props.checkoutReservation();
      } else if (typeof props.doCheckOut === "function") {
        await props.doCheckOut();
      }

      if (typeof logReservationChange === "function") {
        logReservationChange({
          reservationId: reservation?.id || reservation?.reservationId || null,
          action: "checkout",
          data: null,
          ts: Date.now(),
        });
      }
    } catch (err) {
      console.error("handleCheckout failed:", err);
      throw err;
    }
  };

  // inner FolioTotals component (defensive)
  function FolioTotals() {
    const resStatusRaw = ((reservation?.status || "") + "").toLowerCase();
    // be tolerant of different status string styles: 'checked-out', 'checked_out', 'checkedout', 'checked out'
    const isCheckedOut = /checked[-_ ]?out/i.test(resStatusRaw);
    const isCheckedIn = /checked[-_ ]?in/i.test(resStatusRaw);

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

          {/* Previewed EARLY DEPARTURE rows (UI-only unless parent persists them) */}
          {previewNow.applicable && !isCheckedOut && (
            <>
              <div className="tot-row">
                <div className="t-label">Early departure penalty</div>
                <div className="t-value">{currency} {fmtMoney(previewNow.penalty)}</div>
              </div>
              <div className="tot-row">
                <div className="t-label">Early departure refund</div>
                <div className="t-value">-{currency} {fmtMoney(previewNow.refund)}</div>
              </div>
            </>
          )}

          <div className="tot-row grand">
            <div className="t-label">Balance</div>
            <div className="t-value">
              {currency} {fmtMoney(isCheckedOut ? computedBalance : computedBalanceAdjusted)}
            </div>
          </div>
        </div>

        {/* Actions: show Print buttons depending on reservation status */}
        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Add charge/payment not allowed after checkout */}
          {canOperate && !isCheckedOut && (
            <>
              <button onClick={() => (typeof setShowAddCharge === "function" ? setShowAddCharge((s) => !s) : null)}>
                Add charge
              </button>
              <button onClick={() => (typeof setShowAddPayment === "function" ? setShowAddPayment((s) => !s) : null)}>
                Add payment
              </button>
            </>
          )}

          {/* Checkout button: visible when checked-in; also shown (disabled) when already checked-out */}
          {canOperate && (
            <button onClick={handleCheckout} disabled={isCheckedOut || !canOperate}>
              {isCheckedOut ? "Checkout (already checked-out)" : "Checkout"}
            </button>
          )}

          {/* Optional helper to apply adjustments then checkout (visible only if preview applies) */}
          {!isCheckedOut && previewNow.applicable && (
            <button
              onClick={async () => {
                try {
                  // If parent gave an apply hook we call it, then we call handleCheckout
                  if (typeof applyEarlyDepartureAdjustments === "function") {
                    await applyEarlyDepartureAdjustments({
                      penalty: previewNow.penalty,
                      refund: previewNow.refund,
                      unusedNights: previewNow.unusedNights,
                      perNightTotal: previewNow.perNightTotal,
                      actualCheckOutDate: new Date(),
                    });
                    if (typeof logReservationChange === "function") {
                      logReservationChange({
                        reservationId: reservation?.id || reservation?.reservationId || null,
                        action: "apply_early_departure_adjustment",
                        data: { penalty: previewNow.penalty, refund: previewNow.refund, unusedNights: previewNow.unusedNights },
                      });
                    }
                  } else {
                    // no apply hook: we still let the user checkout; the preview remains UI-only.
                    console.log("No applyEarlyDepartureAdjustments() provided — preview only.");
                  }
                  await handleCheckout();
                } catch (err) {
                  console.error("apply & checkout failed", err);
                }
              }}
            >
              Apply adjustment & Checkout
            </button>
          )}

           {/* Print Check-in Form */}
          {isCheckedIn && typeof printCheckInForm === "function" && (
            <button onClick={printCheckInForm}>Print Check-in Form</button>
          )}

          {/* Print Check-out Bill */}
          {isCheckedOut && typeof printCheckOutBill === "function" && (
            <button onClick={printCheckOutBill}>Print Check-out Bill</button>
          )}

          {/* Cancel allowed only if not checked-out */}
          {isAdmin && !isCheckedOut && (
            <button style={{ marginLeft: 8 }} onClick={handleCancelReservation}>
              Cancel Reservation
            </button>
          )}
        </div>

        {showAddCharge && !isCheckedOut && (
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
                <button onClick={handleSubmitCharge}>Save charge</button>
                <button onClick={() => setShowAddCharge(false)}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        {showAddPayment && !isCheckedOut && (
          <div style={{ marginTop: 12 }}>
            <h5>Add Payment</h5>
            <div style={{ display: "grid", gap: 8 }}>
              <input
                placeholder="Amount"
                type="text"
                inputMode="numeric"
                value={paymentForm.amountStr}
                onChange={(e) => setPaymentForm((prev) => ({ ...prev, amountStr: e.target.value }))}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={paymentForm.method}
                  onChange={(e) => setPaymentForm((prev) => ({ ...prev, method: e.target.value }))}
                >
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="qris">QRIS</option>
                  <option value="ota">OTA</option>
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
                    await handleSubmitPayment();
                    setPaymentForm((prev) => ({ ...prev, amountStr: "" }));
                    setShowAddPayment(false);
                  }}
                >
                  Save payment
                </button>
                <button
                  onClick={() => {
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

  // Printable + delete modal are rendered below
  return (
    <div>
      {/* render internal FolioTotals (only once, here) */}
      <FolioTotals />

      {/* Printable section: only render if printMode is active */}
      {printMode && (
        <div
          ref={printRef}
          className="printable"
          style={{ padding: 16, fontFamily: "Arial, sans-serif", fontSize: 13 }}
        >
          {/* HEADER */}
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{templateConfig.header}</div>
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

              {/* Room + Deposit Table */}
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
                  {roomChargeDetails.map((rDetail, idx) => (
                    <tr key={rDetail.roomNo || idx}>
                      <td>{idx + 1}</td>
                      <td>{rDetail.roomNo}</td>
                      <td>{rDetail.roomType}</td>
                      <td style={{ textAlign: "right" }}>
                        {currency} {fmtMoney(rDetail.rate)}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {currency} {fmtMoney(rDetail.subtotal)}
                      </td>
                    </tr>
                  ))}
                  {otherChargePostings.length > 0 && (
                    <>
                      <tr>
                        <td colSpan={5} style={{ background: "#fafafa", fontWeight: 600 }}>
                          Other charges
                        </td>
                      </tr>
                      {otherChargePostings.map((p, i) => (
                        <tr key={`other-${i}`}>
                          <td />
                          <td colSpan={2}>{p.description || p.accountCode || "Charge"}</td>
                          <td style={{ textAlign: "right" }}>
                            {currency} {fmtMoney(Number(p.amount || 0))}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {currency}{" "}
                            {fmtMoney(Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0))}
                          </td>
                        </tr>
                      ))}
                    </>
                  )}


                  {/* Deposit Row */}
                  {computedDepositTotal > 0 && (
                    <tr>
                      <td colSpan={4}>
                        <strong>Deposit</strong>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {currency} {fmtMoney(computedDepositTotal)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Totals */}
              <div style={{ textAlign: "right", marginBottom: 24 }}>
                <div>
                  <strong>Grand Total:</strong> {currency} {fmtMoney(finalChargesTotal)}
                </div>
                {templateConfig.showPaymentBreakdown && (
                  <div style={{ marginTop: 12, textAlign: "left" }}>
                    <h4>Payment Breakdown</h4>
                    <table style={{ width: "100%", borderCollapse: "collapse" }} border="1" cellPadding="6">
                      <tbody>
                        {Object.keys(paymentsByType)
                          .filter((t) => (paymentsByType[t] || 0) > 0)
                          .map((type) => (
                          <tr key={type}>
                            <td>{type}</td>
                            <td style={{ textAlign: "right" }}>
                              {currency} {fmtMoney(paymentsByType[type] || 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CHECK-OUT BILL */}
          {printMode === "checkout" && (
            <div>
              <h3 style={{ textAlign: "center", marginBottom: 16 }}>CHECK-OUT BILL</h3>

              {/* Charges Table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }} border="1" cellPadding="6">
                <thead>
                  <tr style={{ background: "#f2f2f2" }}>
                    <th>Description</th>
                    <th style={{ textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                    {roomChargeDetails.map((r, i) => (
                      <tr key={`roomc-${i}`}>
                        <td>{`Room ${r.roomNo} (${r.roomType})`}</td>
                        <td style={{ textAlign: "right" }}>
                          {currency} {fmtMoney(r.subtotal)}
                        </td>
                      </tr>
                    ))}

                    {lines.map((p, idx) => (
                      <tr key={p.id || idx}>
                        <td>{p.description}</td>
                       <td style={{ textAlign: "right" }}>
                          {currency}{" "}
                          {fmtMoney(
                            Number(p.amount || 0) +
                              Number(p.tax || 0) +
                              Number(p.service || 0)
                          )}
                        </td>
                      </tr>
                    ))}

                    {/* Print preview of early-departure adjustments if present (either persisted or computed preview) */}
                    {(() => {
                      // if persisted posted lines exist, they were included in `lines` already;
                      // if not persisted, but preview is applicable, print those preview rows
                      if (!hasPersistedEarlyDepartureLines && previewNow.applicable) {
                        return (
                          <>
                            <tr>
                              <td>Early departure penalty</td>
                              <td style={{ textAlign: "right" }}>{currency} {fmtMoney(previewNow.penalty)}</td>
                            </tr>
                            <tr>
                              <td>Early departure refund</td>
                              <td style={{ textAlign: "right" }}>-{currency} {fmtMoney(previewNow.refund)}</td>
                            </tr>
                          </>
                        );
                      }
                      return null;
                    })()}
                  </tbody>
              </table>

              {/* Payments Table */}
              {validPayments.length > 0 && (
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }} border="1" cellPadding="6">
                  <thead>
                    <tr style={{ background: "#f9f9f9" }}>
                      <th>Payment Method</th>
                      <th>Reference</th>
                      <th style={{ textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validPayments.map((p, idx) => (
                      <tr key={p.id || idx}>
                        <td>{mapMethodToType(p.method)}</td>
                        <td>{p.refNo || "-"}</td>
                        <td style={{ textAlign: "right" }}>
                          {currency} {fmtMoney(Number(p.amount || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Totals */}
              <div style={{ textAlign: "right", marginBottom: 24 }}>
                <div>
                  Total Charges: {currency} {fmtMoney(computedChargesTotal + (previewNow.applicable && !hasPersistedEarlyDepartureLines ? previewNow.penalty : 0))}
                </div>
                <div>
                  Total Payments: {currency} {fmtMoney(computedPaymentsTotal + (previewNow.applicable && !hasPersistedEarlyDepartureLines ? previewNow.refund : 0))}
                </div>
                <div>
                  Total Deposit: {currency} {fmtMoney(computedDepositTotal)}
                </div>
                <div style={{ fontWeight: 700, marginTop: 8 }}>
                  Balance: {currency} {fmtMoney(computedBalance + (previewNow.applicable && !hasPersistedEarlyDepartureLines ? (previewNow.penalty - previewNow.refund) : 0))}
                </div>

                {templateConfig.showPaymentBreakdown && (
                  <div style={{ marginTop: 12, textAlign: "left" }}>
                    <h4>Payment Breakdown</h4>
                    <table style={{ width: "100%", borderCollapse: "collapse" }} border="1" cellPadding="6">
                      <tbody>
                        {Object.keys(paymentsByType)
                          .filter((t) => (paymentsByType[t] || 0) > 0)
                          .map((type) => (
                            <tr key={type}>
                              <td>{type}</td>
                              <td style={{ textAlign: "right" }}>
                                {currency} {fmtMoney(paymentsByType[type] || 0)}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* FOOTER */}
              {templateConfig.footer && (
                <div style={{ textAlign: "center", marginTop: 40, fontStyle: "italic" }}>
                  {templateConfig.footer}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
