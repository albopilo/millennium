// src/pages/ReservationDetailA.jsx
import React, { useEffect, useState, useMemo, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  doc,
  getDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import DOMPurify from "dompurify";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailA
 * ------------------------------------------------------------
 * Objectives:
 *  - Real-time reservation financial overview (charges, payments, balance)
 *  - Transaction-safe check-in/out logic
 *  - Manual charge/payment entry (no debounce)
 *  - Smart printing from dynamic admin templates
 *  - Improved UI feedback and data safety
 */

const DEFAULT_COMPANY = {
  companyName: "MILLENNIUM INN",
  companyAddress: "Jl. Example No. 1, City",
  companyVatNumber: "",
  companyPhone: "",
};

export default function ReservationDetailA({ currentUser = null, permissions = [] }) {
  const { id } = useParams();
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({});
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const actor = currentUser?.displayName || currentUser?.name || "system";

  // Utility: show quick feedback
  const showToast = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3500);
  };

  // Format helpers
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  /** ================= LOADERS ================= */
  useEffect(() => {
    if (!id) return;
    setLoading(true);

    // Reservation + guest (once)
    (async () => {
      try {
        const resSnap = await getDoc(doc(db, "reservations", id));
        if (!resSnap.exists()) {
          setReservation(null);
          setLoading(false);
          return;
        }
        const res = { id: resSnap.id, ...resSnap.data() };
        setReservation(res);

        if (res.guestId) {
          const gSnap = await getDoc(doc(db, "guests", res.guestId));
          setGuest(gSnap.exists() ? { id: gSnap.id, ...gSnap.data() } : null);
        }

        // Settings & templates
        const [settingsSnap, tplSnap] = await Promise.all([
          getDoc(doc(db, "settings", "general")),
          getDoc(doc(db, "settings", "printTemplates")),
        ]);
        setSettings({ ...DEFAULT_COMPANY, ...settingsSnap.data() });
        setTemplates(tplSnap.data() || {});
      } catch (err) {
        console.error("load error", err);
        showToast("Failed to load reservation", "error");
      } finally {
        setLoading(false);
      }
    })();

    // Realtime listeners
    const unsubPostings = onSnapshot(
      query(collection(db, "postings"), where("reservationId", "==", id)),
      (snap) => setPostings(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubPayments = onSnapshot(
      query(collection(db, "payments"), where("reservationId", "==", id)),
      (snap) => setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubLogs = onSnapshot(
      query(collection(doc(db, "reservations", id), "logs"), orderBy("createdAt", "desc")),
      (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );

    return () => {
      unsubPostings();
      unsubPayments();
      unsubLogs();
    };
  }, [id]);

  /** ================= COMPUTED ================= */
  const visiblePostings = useMemo(
    () => postings.filter((p) => (p.status || "").toLowerCase() !== "void"),
    [postings]
  );
  const chargesTotal = visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = chargesTotal - paymentsTotal;
  const status = (reservation?.status || "").toLowerCase();

  /** ================= LOGGING ================= */
  const writeLog = async (action, meta = {}) => {
    try {
      await addDoc(collection(doc(db, "reservations", id), "logs"), {
        action,
        by: actor,
        meta,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("log error", err);
    }
  };

  /** ================= ACTIONS ================= */
  const submitCharge = async ({ description, qtyStr, unitStr, accountCode = "MISC" }) => {
    const qty = parseFloat(qtyStr);
    const unit = parseFloat(unitStr);
    const total = qty * unit;
    if (!description?.trim()) return showToast("Description required", "error");
    if (isNaN(total) || total <= 0) return showToast("Invalid amount", "error");

    await addDoc(collection(db, "postings"), {
      reservationId: id,
      description: description.trim(),
      accountCode: accountCode.toUpperCase(),
      quantity: qty,
      unitAmount: unit,
      amount: total,
      status: "posted",
      createdAt: serverTimestamp(),
      createdBy: actor,
    });

    await writeLog("add-charge", { description, total });
    showToast("Charge added", "success");
  };

  const submitPayment = async ({ amountStr, method = "cash", refNo = "" }) => {
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return showToast("Invalid payment", "error");

    await addDoc(collection(db, "payments"), {
      reservationId: id,
      amount,
      method,
      refNo,
      capturedAt: serverTimestamp(),
      capturedBy: actor,
    });

    await writeLog("add-payment", { amount, method });
    showToast("Payment added", "success");
  };

  const doCheckIn = async () => {
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "reservations", id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if ((r.status || "").toLowerCase() !== "booked")
          throw new Error("Already checked in/out");
        tx.update(ref, { status: "checked-in", checkInDate: new Date().toISOString(), updatedAt: serverTimestamp() });
      });
      await writeLog("check-in");
      showToast("Guest checked in", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const doCheckOut = async () => {
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "reservations", id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if ((r.status || "").toLowerCase() !== "checked-in")
          throw new Error("Must be checked-in first");
        tx.update(ref, { status: "checked-out", checkOutDate: new Date().toISOString(), updatedAt: serverTimestamp() });
      });
      await writeLog("check-out");
      showToast("Guest checked out", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  /** ================= PRINT ================= */
  const replaceTokens = (tpl, data) =>
    tpl.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => data[key.trim()] ?? "");

  const openPrintWindow = (html) => {
    const win = window.open("", "_blank", "width=900,height=800");
    win.document.write(`<html><body>${html}</body></html>`);
    win.document.close();
  };

  const printTemplate = (type) => {
    const tpl = templates?.[type] || {};
    const data = {
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestPhone: guest?.phone || "-",
      guestAddress: guest?.address || "-",
      roomNumber: Array.isArray(reservation?.roomNumbers)
        ? reservation.roomNumbers.join(", ")
        : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate
        ? new Date(reservation.checkInDate).toLocaleString()
        : "-",
      checkOutDate: reservation?.checkOutDate
        ? new Date(reservation.checkOutDate).toLocaleString()
        : "-",
      totalCharges: fmtMoney(chargesTotal),
      totalPayments: fmtMoney(paymentsTotal),
      balance: fmtMoney(balance),
      ...settings,
    };

    // Include folio table in checkout print
    const folio =
      type === "checkOutTemplate"
        ? `<table border="1" cellspacing="0" cellpadding="4" width="100%">
            <thead><tr><th>Description</th><th style="text-align:right">Amount (${settings.currency || "IDR"})</th></tr></thead>
            <tbody>${visiblePostings
              .map(
                (p) =>
                  `<tr><td>${p.description || p.accountCode}</td><td style="text-align:right">${fmtMoney(
                    p.amount
                  )}</td></tr>`
              )
              .join("")}</tbody>
            <tfoot>
              <tr><th>Total</th><th style="text-align:right">${fmtMoney(chargesTotal)}</th></tr>
              <tr><th>Payments</th><th style="text-align:right">-${fmtMoney(paymentsTotal)}</th></tr>
              <tr><th>Balance</th><th style="text-align:right">${fmtMoney(balance)}</th></tr>
            </tfoot>
          </table>`
        : "";

    const html = `
      <div style="font-family:sans-serif;padding:20px">
        ${DOMPurify.sanitize(replaceTokens(tpl.header || "<h2>{{companyName}}</h2>", data))}
        <hr/>
        ${DOMPurify.sanitize(replaceTokens(tpl.body || "", data))}
        ${folio}
        <hr/>
        ${DOMPurify.sanitize(replaceTokens(tpl.footer || "", data))}
      </div>
    `;
    openPrintWindow(html);
  };

  /** ================= UI ================= */
  if (loading) return <div className="p-6 text-gray-500">Loading reservation...</div>;
  if (!reservation) return <div className="p-6 text-gray-500">Reservation not found.</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="page-title">Reservation — {reservation.id}</h1>

      {message && <div className={`toast toast-${message.type}`}>{message.text}</div>}

      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        settings={settings}
        balance={balance}
        canOperate={permissions.includes("*") || permissions.includes("canOperateFrontDesk")}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        printCheckInForm={() =>
          status !== "checked-out" && printTemplate("checkInTemplate")
        }
        printCheckOutBill={() =>
          status === "checked-out" && printTemplate("checkOutTemplate")
        }
      />

      <ReservationDetailC
        reservation={reservation}
        postings={postings}
        payments={payments}
        submitCharge={submitCharge}
        submitPayment={submitPayment}
        currency={settings.currency || "IDR"}
        fmtMoney={fmtMoney}
      />

      <div className="log-card">
        <h3>Logs</h3>
        {logs.map((l) => (
          <div key={l.id} className="log-entry">
            <strong>{l.action}</strong> — {l.by} (
            {l.createdAt?.seconds
              ? new Date(l.createdAt.seconds * 1000).toLocaleString()
              : "—"}
            )
          </div>
        ))}
      </div>
    </div>
  );
}
