// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  addDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import DOMPurify from "dompurify";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailA
 * - Full-featured reservation detail & front-desk operations
 * - Loads: reservation, guest, rooms, channels, rates, events, settings, templates
 * - Real-time: postings, payments, stays, logs
 * - Actions: doCheckIn, doCheckOut, changeRoom, upgradeRoom (transactional)
 * - submitCharge / submitPayment (no debounce)
 * - Prints linked to settings/printTemplates (AdminPrintTemplate)
 *
 * Note: Print logic is kept inside this file (option A) and uses DOMPurify.
 */

const DEFAULT_COMPANY = {
  companyName: "MILLENNIUM INN",
  companyAddress: "Jl. Example No. 1, City",
  companyVatNumber: "",
  companyPhone: "",
};

export default function ReservationDetailA({ currentUser = null, permissions = [] }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName = currentUser?.displayName || currentUser?.name || currentUser?.email || "frontdesk";
  const isAllowed = (perm) => permissions.includes("*") || permissions.includes(perm);

  // Core data
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [templates, setTemplates] = useState({});

  // Real-time collections
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [stays, setStays] = useState([]);
  const [logs, setLogs] = useState([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "" });
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "" });

  // small helpers
  const fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 }));
  const fmtDate = (v) => (v ? new Date(v).toLocaleString() : "-");
  const showToast = (text, type = "info") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // -------------------------
  // Initial load (static collections + reservation + templates)
  // -------------------------
  useEffect(() => {
    if (!id) return;

    let unsubPostings = null;
    let unsubPayments = null;
    let unsubStays = null;
    let unsubLogs = null;

    const init = async () => {
      setLoading(true);
      try {
        // load reservation
        const resSnap = await getDoc(doc(db, "reservations", id));
        if (!resSnap.exists()) {
          showToast("Reservation not found.", "error");
          navigate("/calendar", { replace: true });
          return;
        }
        const res = { id: resSnap.id, ...resSnap.data() };
        setReservation(res);

        // guest
        if (res.guestId) {
          const gSnap = await getDoc(doc(db, "guests", res.guestId));
          setGuest(gSnap.exists() ? { id: gSnap.id, ...gSnap.data() } : null);
        } else {
          setGuest(null);
        }

        // load supporting static collections (rooms, channels, rates, events) -- single-shot
        const [roomsSnap, channelsSnap, ratesSnap, eventsSnap, settingsSnap, tplSnap] = await Promise.all([
          getDocs(collection(db, "rooms")),
          getDocs(collection(db, "channels")),
          getDocs(collection(db, "rates")),
          getDocs(collection(db, "events")),
          getDoc(doc(db, "settings", "general")),
          getDoc(doc(db, "settings", "printTemplates")),
        ]);

        setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setChannels(channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        if (settingsSnap.exists()) setSettings((s) => ({ ...s, ...(settingsSnap.data() || {}) }));
        if (tplSnap.exists()) setTemplates(tplSnap.data());

        // real-time: postings for this reservation
        unsubPostings = onSnapshot(
          query(collection(db, "postings"), where("reservationId", "==", id), orderBy("createdAt", "asc")),
          (snap) => setPostings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => console.error("postings snapshot error", err)
        );

        // real-time: payments
        unsubPayments = onSnapshot(
          query(collection(db, "payments"), where("reservationId", "==", id), orderBy("capturedAt", "asc")),
          (snap) => setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => console.error("payments snapshot error", err)
        );

        // real-time: stays subcollection
        unsubStays = onSnapshot(
          query(collection(doc(db, "reservations", id), "stays")),
          (snap) => setStays(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => console.error("stays snapshot error", err)
        );

        // real-time: logs
        unsubLogs = onSnapshot(
          query(collection(doc(db, "reservations", id), "logs"), orderBy("createdAt", "desc")),
          (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => console.error("logs snapshot error", err)
        );
      } catch (err) {
        console.error("init error", err);
        showToast("Failed to load reservation data", "error");
      } finally {
        setLoading(false);
      }
    };

    init();

    return () => {
      if (unsubPostings) unsubPostings();
      if (unsubPayments) unsubPayments();
      if (unsubStays) unsubStays();
      if (unsubLogs) unsubLogs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // -------------------------
  // Derived folio values (single source of truth)
  // -------------------------
  const visiblePostings = useMemo(() => postings.filter((p) => ((p.status || "") + "").toLowerCase() !== "void"), [postings]);

  const chargesTotal = useMemo(() => visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0), [visiblePostings]);
  const paymentsTotal = useMemo(() => payments.reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const balance = useMemo(() => chargesTotal - paymentsTotal, [chargesTotal, paymentsTotal]);

  // breakdown: room-based subtotal if postings include roomNumber
  const roomSubtotals = useMemo(() => {
    const map = {};
    for (const p of visiblePostings) {
      if (((p.accountCode || "") + "").toUpperCase() === "ROOM") {
        const rn = p.roomNumber || "—";
        map[rn] = (map[rn] || 0) + Number(p.amount || 0);
      }
    }
    return Object.keys(map).map((k) => ({ roomNo: k, subtotal: map[k] }));
  }, [visiblePostings]);

  // -------------------------
  // Audit helper (creates a log entry under reservation/logs)
  // -------------------------
  const writeLog = async (action, before = {}, after = {}, meta = {}) => {
    try {
      await addDoc(collection(doc(db, "reservations", id), "logs"), {
        action,
        by: actorName,
        before,
        after,
        meta,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      console.error("writeLog error", err);
    }
  };

  // -------------------------
  // Actions: Check-In (transactional)
  // - transition booked -> checked-in
  // - create stays subcollection docs via transaction (safe tx.set on new refs)
  // -------------------------
  const doCheckIn = async (opts = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if (((r.status || "") + "").toLowerCase() !== "booked") {
          throw new Error("Only 'booked' reservations can be checked-in");
        }

        const nowIso = new Date().toISOString();

        // update reservation status
        tx.update(reservationRef, {
          status: "checked-in",
          checkInDate: nowIso,
          updatedAt: serverTimestamp(),
        });

        // create stays: one doc per room inside reservation/{id}/stays
        const roomNumbers = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? r.roomNumbers : (r.roomNumber ? [r.roomNumber] : []);
        for (const rn of roomNumbers) {
          const staysCollection = collection(reservationRef, "stays");
          // create a new doc ref with client id and tx.set to keep atomic guarantee
          const newStayRef = doc(staysCollection);
          tx.set(newStayRef, {
            roomNumber: rn,
            status: "open",
            checkInAt: nowIso,
            createdBy: actorName,
            createdAt: serverTimestamp(),
          });
        }

        // log (within transaction)
        const logsRef = collection(reservationRef, "logs");
        const logRef = doc(logsRef);
        tx.set(logRef, {
          action: "check-in",
          by: actorName,
          before: { status: r.status || "" },
          after: { status: "checked-in", checkInDate: nowIso },
          meta: opts.meta || null,
          createdAt: serverTimestamp(),
        });
      });

      showToast("Checked in successfully", "success");
    } catch (err) {
      console.error("doCheckIn error", err);
      showToast(err.message || "Check-in failed", "error");
      throw err;
    }
  };

  // -------------------------
  // Actions: Check-Out (transactional)
  // - close stays
  // - optionally auto-post a checkout room charge (configurable)
  // - set reservation to checked-out
  // -------------------------
  const doCheckOut = async ({ autoPost = true } = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if (((r.status || "") + "").toLowerCase() !== "checked-in") {
          throw new Error("Only 'checked-in' reservations can be checked-out");
        }

        const nowIso = new Date().toISOString();

        // close open stays
        const staysColl = collection(reservationRef, "stays");
        const staysSnap = await getDocs(query(staysColl));
        const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open"));

        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, {
            status: "closed",
            checkOutAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        }

        // Optionally auto-post a checkout room adjustment posting into global postings
        // We generate a client-side id and tx.set the posting for atomicity
        const shouldAutoPost = settings.autoPostRoomChargeOnCheckout === true || autoPost === true;
        if (shouldAutoPost) {
          const postingsColl = collection(db, "postings");
          const newPostingRef = doc(postingsColl);
          tx.set(newPostingRef, {
            reservationId: id,
            accountCode: "ROOM",
            description: "Room Charge (checkout adjustment)",
            amount: 0, // staff can edit later or compute from rates
            status: "posted",
            createdAt: serverTimestamp(),
            createdBy: actorName,
          });
        }

        // update reservation
        tx.update(reservationRef, {
          status: "checked-out",
          checkOutDate: nowIso,
          updatedAt: serverTimestamp(),
        });

        // log
        const logsRef = collection(reservationRef, "logs");
        const logRef = doc(logsRef);
        tx.set(logRef, {
          action: "check-out",
          by: actorName,
          before: { status: r.status || "" },
          after: { status: "checked-out", checkOutDate: nowIso },
          meta: { autoPostApplied: shouldAutoPost },
          createdAt: serverTimestamp(),
        });
      });

      showToast("Checked out successfully", "success");
    } catch (err) {
      console.error("doCheckOut error", err);
      showToast(err.message || "Check-out failed", "error");
      throw err;
    }
  };

  // -------------------------
  // changeRoom: replace a room number in reservation.roomNumbers and update matching open stay docs
  // -------------------------
  const changeRoom = async ({ fromRoom, toRoom, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        const currentRooms = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? [...r.roomNumbers] : (r.roomNumber ? [r.roomNumber] : []);
        const idx = currentRooms.indexOf(fromRoom);
        if (idx === -1) throw new Error("From-room not found in reservation assignment");
        currentRooms[idx] = toRoom;

        // update reservation rooms
        tx.update(reservationRef, {
          roomNumbers: currentRooms,
          updatedAt: serverTimestamp(),
        });

        // update stays: find open stay with fromRoom and update its roomNumber
        const staysColl = collection(reservationRef, "stays");
        const staysSnap = await getDocs(query(staysColl));
        const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open") && d.data().roomNumber === fromRoom);
        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
        }

        // log
        const logsRef = collection(reservationRef, "logs");
        const logRef = doc(logsRef);
        tx.set(logRef, {
          action: "change-room",
          by: actorName,
          before: { roomNumbers: r.roomNumbers || [] },
          after: { roomNumbers: currentRooms },
          meta: { fromRoom, toRoom, note },
          createdAt: serverTimestamp(),
        });
      });

      showToast("Room changed", "success");
    } catch (err) {
      console.error("changeRoom error", err);
      showToast(err.message || "Change room failed", "error");
      throw err;
    }
  };

  // -------------------------
  // upgradeRoom: change room and optionally create an upgrade posting
  // -------------------------
  const upgradeRoom = async ({ fromRoom, toRoom, upgradeCharge = 0, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        const currentRooms = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? [...r.roomNumbers] : (r.roomNumber ? [r.roomNumber] : []);
        const idx = currentRooms.indexOf(fromRoom);
        if (idx === -1) throw new Error("From-room not found");
        currentRooms[idx] = toRoom;

        tx.update(reservationRef, { roomNumbers: currentRooms, updatedAt: serverTimestamp() });

        // update stays
        const staysColl = collection(reservationRef, "stays");
        const staysSnap = await getDocs(query(staysColl));
        const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open") && d.data().roomNumber === fromRoom);
        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
        }

        // if upgradeCharge > 0 create a posting in global postings via tx.set
        if (Number(upgradeCharge) > 0) {
          const postingsColl = collection(db, "postings");
          const newPostingRef = doc(postingsColl);
          tx.set(newPostingRef, {
            reservationId: id,
            accountCode: "UPGRADE",
            description: `Upgrade ${fromRoom} → ${toRoom}` + (note ? ` (${note})` : ""),
            amount: Number(upgradeCharge),
            status: "posted",
            createdAt: serverTimestamp(),
            createdBy: actorName,
          });
        }

        // log
        const logsRef = collection(reservationRef, "logs");
        const logRef = doc(logsRef);
        tx.set(logRef, {
          action: "upgrade-room",
          by: actorName,
          before: { roomNumbers: r.roomNumbers || [] },
          after: { roomNumbers: currentRooms },
          meta: { fromRoom, toRoom, upgradeCharge, note },
          createdAt: serverTimestamp(),
        });
      });

      showToast("Room upgraded", "success");
    } catch (err) {
      console.error("upgradeRoom error", err);
      showToast(err.message || "Upgrade failed", "error");
      throw err;
    }
  };

  // -------------------------
  // submitCharge (no debounce)
  // - parse qty/unit
  // - create posting in postings collection
  // - status: posted if already checked-in else forecast
  // -------------------------
  const submitCharge = async ({ description, qtyStr, unitStr, accountCode = "MISC", roomNumber = null }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const qty = parseFloat(qtyStr) || 1;
    const unit = parseFloat(unitStr) || 0;
    const amount = qty * unit;
    if (!description || !description.trim()) throw new Error("Description required");
    if (amount <= 0) throw new Error("Charge amount must be > 0");

    try {
      // create posting
      await addDoc(collection(db, "postings"), {
        reservationId: id,
        accountCode: (accountCode || "MISC").toUpperCase(),
        description: description.trim(),
        quantity: qty,
        unitAmount: unit,
        amount,
        roomNumber: roomNumber || null,
        status: ((reservation.status || "").toLowerCase() === "checked-in") ? "posted" : "forecast",
        createdAt: serverTimestamp(),
        createdBy: actorName,
      });

      await writeLog("add-charge", {}, {}, { description, qty, unit, amount, accountCode, roomNumber });
      showToast("Charge added", "success");
    } catch (err) {
      console.error("submitCharge error", err);
      showToast(err.message || "Failed to add charge", "error");
      throw err;
    }
  };

  // -------------------------
  // submitPayment (no debounce)
  // -------------------------
  const submitPayment = async ({ amountStr, method = "cash", refNo = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const amt = parseFloat(amountStr) || 0;
    if (amt <= 0) throw new Error("Payment must be > 0");

    try {
      await addDoc(collection(db, "payments"), {
        reservationId: id,
        amount: amt,
        method,
        refNo,
        capturedAt: serverTimestamp(),
        capturedBy: actorName,
      });

      await writeLog("add-payment", {}, {}, { amount: amt, method, refNo });
      showToast("Payment recorded", "success");
    } catch (err) {
      console.error("submitPayment error", err);
      showToast(err.message || "Failed to add payment", "error");
      throw err;
    }
  };

  // -------------------------
  // Print helpers (keep inside this file per option A)
  // - Reads templates from 'templates' state (loaded from settings/printTemplates)
  // - Replaces placeholders and sanitizes with DOMPurify
  // - Shows folio table for checkout
  // -------------------------
  const replacePlaceholders = (html = "", data = {}) => {
    if (!html) return "";
    return html.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
      const k = key.trim();
      return data[k] !== undefined && data[k] !== null ? String(data[k]) : "";
    });
  };

  const openPrintWindow = (html) => {
    const w = window.open("", "_blank", "width=900,height=800");
    if (!w) {
      showToast("Pop-up blocked. Allow pop-ups for printing.", "error");
      return;
    }
    w.document.write(`
      <html>
        <head>
          <title>Print</title>
          <style>
            body { font-family: Arial, Helvetica, sans-serif; color:#111; padding:20px; }
            table { border-collapse: collapse; width: 100%; margin-top: 8px; }
            th, td { border: 1px solid #ddd; padding: 8px; }
            th { background: #f6f8fa; text-align: left; }
          </style>
        </head>
        <body>${html}</body>
      </html>
    `);
    w.document.close();
    w.focus();
  };

  const printCheckInForm = () => {
    const tpl = templates?.checkInTemplate || { header: "<h2>{{companyName}}</h2>", body: "<p>Check-in for {{guestName}}</p>", footer: "{{signatureLine}}" };
    const data = {
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestAddress: guest?.address || "",
      guestPhone: guest?.phone || guest?.mobile || "",
      roomNumber: Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate ? new Date(reservation.checkInDate).toLocaleString() : new Date().toLocaleString(),
      staffName: actorName,
      companyName: settings.companyName || DEFAULT_COMPANY.companyName,
      companyAddress: settings.companyAddress || DEFAULT_COMPANY.companyAddress,
      companyVatNumber: settings.companyVatNumber || DEFAULT_COMPANY.companyVatNumber,
      signatureLine: "<div style='margin-top:24px;'>Signature: __________________________</div>",
    };

    const header = replacePlaceholders(tpl.header || "", data);
    const body = replacePlaceholders(tpl.body || "", data);
    const footer = replacePlaceholders(tpl.footer || "", data);

    const html = `<div style="text-align:center">${header}</div><hr/>${DOMPurify.sanitize(body)}<hr/>${DOMPurify.sanitize(footer)}`;
    openPrintWindow(html);
  };

  const printCheckOutBill = () => {
    const tpl = templates?.checkOutTemplate || { header: "<h2>{{companyName}}</h2>", body: "<p>Bill for {{guestName}}</p>", footer: "{{signatureLine}}" };
    const data = {
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestAddress: guest?.address || "",
      guestPhone: guest?.phone || guest?.mobile || "",
      roomNumber: Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate ? new Date(reservation.checkInDate).toLocaleString() : "-",
      checkOutDate: new Date().toLocaleString(),
      balance: fmtMoney(balance),
      totalCharges: fmtMoney(chargesTotal),
      totalPayments: fmtMoney(paymentsTotal),
      staffName: actorName,
      companyName: settings.companyName || DEFAULT_COMPANY.companyName,
      companyAddress: settings.companyAddress || DEFAULT_COMPANY.companyAddress,
      companyVatNumber: settings.companyVatNumber || DEFAULT_COMPANY.companyVatNumber,
      companyPhone: settings.companyPhone || DEFAULT_COMPANY.companyPhone,
      signatureLine: "<div style='margin-top:16px;'>Guest Signature: __________________________</div>",
    };

    // folio table
    const itemsHtml = visiblePostings.length
      ? `<table>
          <thead><tr><th>Description</th><th style="text-align:right">Amount (${settings.currency || "IDR"})</th></tr></thead>
          <tbody>
            ${visiblePostings.map((p) => `<tr><td>${p.description || p.accountCode || "-"}</td><td style="text-align:right">${fmtMoney(Number(p.amount || 0))}</td></tr>`).join("")}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th style="text-align:right">${fmtMoney(chargesTotal)}</th></tr>
            <tr><th>Payments</th><th style="text-align:right">-${fmtMoney(paymentsTotal)}</th></tr>
            <tr><th>Balance</th><th style="text-align:right">${fmtMoney(balance)}</th></tr>
          </tfoot>
        </table>`
      : "<p>No charges</p>";

    const header = replacePlaceholders(tpl.header || "", data);
    const body = replacePlaceholders(tpl.body || "", data);
    const footer = replacePlaceholders(tpl.footer || "", data);

    const html = `<div style="text-align:center">${header}</div><hr/>${DOMPurify.sanitize(body)}${itemsHtml}<hr/>${DOMPurify.sanitize(footer)}`;
    openPrintWindow(html);
  };

  // -------------------------
  // UI guard
  // -------------------------
  if (loading) return <div className="p-6">Loading reservation…</div>;
  if (!reservation) return <div className="p-6 text-gray-600">Reservation not found.</div>;

  const statusLower = ((reservation.status || "") + "").toLowerCase();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Toast */}
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}

      <h1 className="page-title">Reservation — {reservation.id}</h1>

      {/* Top summary & actions (delegated to B) */}
      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        stays={stays}
        settings={settings}
        rooms={rooms}
        channels={channels}
        rates={rates}
        events={events}
        canOperate={isAllowed("canOperateFrontDesk") || isAllowed("canEditReservations")}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        changeRoom={changeRoom}
        upgradeRoom={upgradeRoom}
        printCheckInForm={() => { if (statusLower !== "checked-out") printCheckInForm(); }}
        printCheckOutBill={() => { if (statusLower === "checked-out") printCheckOutBill(); }}
        balance={balance}
      />

      {/* Folio & payments (ReservationDetailC is the single source for folio UI) */}
      <ReservationDetailC
        reservation={reservation}
        postings={postings}
        payments={payments}
        roomSubtotals={roomSubtotals}
        displayChargeLines={visiblePostings}
        displayChargesTotal={chargesTotal}
        displayPaymentsTotal={paymentsTotal}
        displayBalance={balance}
        currency={settings.currency || "IDR"}
        fmtMoney={fmtMoney}
        // charge/payment modal controls
        showAddCharge={showAddCharge}
        setShowAddCharge={setShowAddCharge}
        chargeForm={chargeForm}
        setChargeForm={setChargeForm}
        submitCharge={(form) => submitCharge(form || { ...chargeForm })}
        showAddPayment={showAddPayment}
        setShowAddPayment={setShowAddPayment}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        submitPayment={(form) => submitPayment(form || { ...paymentForm })}
        canOperate={isAllowed("canOperateFrontDesk") || isAllowed("canEditReservations")}
      />

      {/* Logs */}
      <div className="log-card">
        <h3>Logs</h3>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="muted">No logs yet.</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="log-entry">
                <div className="log-action">{(l.action || "unknown").toUpperCase()}</div>
                <div className="log-meta">by {l.by} • {l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000).toLocaleString() : "-"}</div>
                <div className="log-detail muted">{l.meta ? JSON.stringify(l.meta) : ""}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
