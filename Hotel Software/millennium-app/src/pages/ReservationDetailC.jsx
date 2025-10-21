// src/pages/ReservationDetailC.jsx
import React, { useMemo } from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailC(props) {
  const {
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
    isAdmin,
    printCheckInForm = null,
    printCheckOutBill = null,
  } = props;

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
}
