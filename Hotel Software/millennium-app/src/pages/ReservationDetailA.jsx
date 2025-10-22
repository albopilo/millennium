// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  runTransaction,
  addDoc,
  updateDoc,
  setDoc,
  onSnapshot,
  orderBy
} from "firebase/firestore";
import { db } from "../firebase"; // adjust path if needed
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

/**
 * Full controller: fetch reservation, rates, show UI, create forecasts per-room-per-day,
 * ensure deposit postings, convert forecasts at check-in, handle add charge/payment,
 * preview helpers for live IDR display (no input debounce).
 */

function onlyDigits(s = "") {
  return (s + "").replace(/[^\d]/g, "");
}
function toInt(s = "") {
  const n = parseInt(onlyDigits(s), 10);
  return Number.isNaN(n) ? 0 : n;
}
function fmtIdr(n = 0) {
  return `IDR ${Number(n || 0).toLocaleString("id-ID")}`;
}
function iterateDates(checkIn, checkOut) {
  // accepts Date or timestamp-like values
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const out = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (cur < end) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}
function isWeekend(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun ... 6 Sat
  return day === 0 || day === 6;
}

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName = currentUser?.displayName || currentUser?.email || "frontdesk";

  // permissions
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canOverrideBilling = can("canOverrideBilling");

  // data state
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [rates, setRates] = useState([]);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  const printRef = React.useRef(null);
  const [printMode, setPrintMode] = useState(null);

  // UI local forms
  const [assignRooms, setAssignRooms] = useState([]);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "" });

  // load reservation + related data
  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const resSnap = await getDoc(doc(db, "reservations", id));
      if (!resSnap.exists()) {
        navigate("/calendar");
        return;
      }
      const res = { id: resSnap.id, ...resSnap.data() };
      setReservation(res);
      setAssignRooms(Array.isArray(res.roomNumbers) ? [...res.roomNumbers] : (res.roomNumber ? [res.roomNumber] : []));

      const [roomsSnap, staysSnap, postingsSnap, paymentsSnap, ratesSnap, settingsSnap] = await Promise.all([
        getDocs(collection(db, "rooms")),
        getDocs(query(collection(db, "stays"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id))),
        getDocs(collection(db, "rates")),
        getDoc(doc(db, "settings", "general"))
      ]);

      setRooms(roomsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setStays(staysSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPostings(postingsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPayments(paymentsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setRates(ratesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
    } catch (err) {
      console.error("loadAll error", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!reservation?.id) return;
    const q = query(collection(doc(db, "reservations", reservation.id), "logs"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [reservation?.id]);

  // Rate lookup: find rate doc that matches reservation.channel + roomType
  function findRateForRoom(roomType, channelId) {
    // try exact match: both roomType and channelId
    let found = rates.find(r => (r.roomType || "") === (roomType || "") && (r.channelId || "") === (channelId || ""));
    if (found) return found;

    // try match only roomType
    found = rates.find(r => (r.roomType || "") === (roomType || ""));
    if (found) return found;

    // try channel default
    found = rates.find(r => (r.channelId || "") === (channelId || ""));
    return found || null;
  }

  // Create forecast postings per-room-per-night
  async function createForecastRoomPostings(resDoc, assignedRooms = []) {
    if (!resDoc || !resDoc.checkInDate || !resDoc.checkOutDate) return [];
    const nights = iterateDates(resDoc.checkInDate, resDoc.checkOutDate);
    if (!nights.length) return [];

    const created = [];
    for (const roomNumber of assignedRooms) {
      // find room document to get roomType (room docs may store roomType)
      const roomDoc = rooms.find(r => (r.roomNumber || r.id) + "" === (roomNumber + ""));
      const roomType = roomDoc?.roomType || resDoc.roomType || "";

      for (const night of nights) {
        // pick appropriate rate document (channel-specific)
        const rateDoc = findRateForRoom(roomType, resDoc.channel);
        const unit = rateDoc
          ? (isWeekend(night) ? Number(rateDoc.weekendRate || 0) : Number(rateDoc.weekdayRate || 0))
          : Number(resDoc.rate || 0);

        const desc = rateDoc?.name ? `${rateDoc.name} — ${night.toLocaleDateString()}` : `Room ${roomNumber} — ${night.toLocaleDateString()}`;

        const posting = {
          reservationId: resDoc.id,
          stayId: null,
          roomNumber,
          description: desc,
          amount: unit,
          tax: 0,
          service: 0,
          quantity: 1,
          unitAmount: unit,
          accountCode: "ROOM",
          status: "forecast",
          date: night.toISOString(),
          createdAt: new Date(),
          createdBy: actorName
        };
        const ref = await addDoc(collection(db, "postings"), posting);
        created.push({ id: ref.id, ...posting });
      }
    }
    return created;
  }

  // Ensure deposit posting per room (doesn't duplicate existing active deposits)
  async function ensureDepositPosting(resDoc, assignedRooms = []) {
    const depositPerRoom = Number(resDoc.depositPerRoom ?? settings.depositPerRoom ?? 0);
    if (!depositPerRoom || depositPerRoom <= 0) return [];
    const created = [];
    for (const roomNumber of assignedRooms) {
      const q = query(collection(db, "postings"),
        where("reservationId", "==", resDoc.id),
        where("roomNumber", "==", roomNumber),
        where("accountCode", "==", "DEPOSIT"));
      const snap = await getDocs(q);
      const hasActive = snap.docs.some(d => ((d.data()?.status || "") + "").toLowerCase() !== "void");
      if (!hasActive) {
        const posting = {
          reservationId: resDoc.id,
          stayId: null,
          roomNumber,
          description: "Security deposit",
          amount: depositPerRoom,
          tax: 0,
          service: 0,
          quantity: 1,
          unitAmount: depositPerRoom,
          accountCode: "DEPOSIT",
          status: "forecast",
          date: resDoc.checkInDate,
          createdAt: new Date(),
          createdBy: actorName
        };
        const ref = await addDoc(collection(db, "postings"), posting);
        created.push({ id: ref.id, ...posting });
      }
    }
    return created;
  }

  // Convert forecast postings to posted (used on check-in)
  async function convertForecastsToPosted(reservationId) {
    const q = query(collection(db, "postings"), where("reservationId", "==", reservationId), where("status", "==", "forecast"));
    const snap = await getDocs(q);
    const updates = [];
    for (const d of snap.docs) {
      const pRef = doc(db, "postings", d.id);
      await updateDoc(pRef, { status: "posted", postedAt: new Date() });
      updates.push(d.id);
    }
    return updates;
  }

  // Submit charge (parses on submit; no input debounce)
  async function submitCharge() {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description.trim()) { alert("Description required"); return; }
    if (total <= 0) { alert("Total must be > 0"); return; }
    const status = (reservation?.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";
    await addDoc(collection(db, "postings"), {
      reservationId: reservation.id,
      stayId: null,
      roomNumber: null,
      description: chargeForm.description.trim(),
      amount: total,
      tax: 0,
      service: 0,
      quantity: qty,
      unitAmount: unit,
      accountCode: (chargeForm.accountCode || "MISC").toUpperCase(),
      status,
      createdAt: new Date(),
      createdBy: actorName
    });
    setShowAddCharge(false);
    setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
    await loadAll();
  }

  // Submit payment
  async function submitPayment() {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) { alert("Payment must be > 0"); return; }
    await addDoc(collection(db, "payments"), {
      reservationId: reservation.id,
      stayId: null,
      method: paymentForm.method || "cash",
      amount: amt,
      refNo: paymentForm.refNo || "",
      capturedAt: new Date(),
      capturedBy: actorName,
      type: "payment"
    });
    setShowAddPayment(false);
    setPaymentForm({ amountStr: "", method: "cash", refNo: "" });
    await loadAll();
  }

  // Check-in flow (create stays, convert forecasts, ensure deposit)
  async function doCheckIn() {
    if (!reservation) return;
    if (!assignRooms.length) { alert("Assign at least one room"); return; }
    setLoading(true);
    try {
      await runTransaction(db, async (tx) => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation missing");
        for (const roomNumber of assignRooms) {
          const stayRef = doc(collection(db, "stays"));
          tx.set(stayRef, {
            reservationId: reservation.id,
            guestId: reservation.guestId || null,
            guestName: reservation.guestName || "",
            roomNumber,
            checkInDate: reservation.checkInDate,
            checkOutDate: reservation.checkOutDate,
            openedAt: new Date(),
            closedAt: null,
            status: "open",
            currency: settings.currency || "IDR",
            createdBy: actorName
          });
          // mark room occupied (room doc id presumed to be roomNumber)
          tx.update(doc(db, "rooms", roomNumber), { status: "Occupied", lastOccupiedAt: new Date() });
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });

      // convert forecasts then ensure deposits
      await convertForecastsToPosted(reservation.id);
      await ensureDepositPosting(reservation, assignRooms);
      await loadAll();
      alert("Checked in");
    } catch (err) {
      console.error("doCheckIn error:", err);
      alert("Check-in failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  }

  // Check-out flow (close stays, create HK tasks, mark reservation checked-out)
  async function doCheckOut() {
    if (!reservation) return;
    // compute balance
    const charges = (postings || []).filter(p => (p.status || "").toLowerCase() !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const pays = (payments || []).filter(p => (p.status || "").toLowerCase() !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = charges - pays;
    if (balance > 0.01 && !canOverrideBilling) {
      alert(`Outstanding ${fmtIdr(balance)}. Override required to check out.`);
      return;
    }
    setLoading(true);
    try {
      await runTransaction(db, async (tx) => {
        const openStays = stays.filter(s => (s.status || "") === "open");
        for (const s of openStays) {
          tx.update(doc(db, "stays", s.id), { status: "closed", closedAt: new Date() });
          tx.update(doc(db, "rooms", s.roomNumber), { status: "Vacant Dirty" });
          const taskRef = doc(collection(db, "hk_tasks"));
          tx.set(taskRef, {
            roomNumber: s.roomNumber,
            date: new Date().toISOString().slice(0, 10),
            type: "clean",
            status: "pending",
            createdAt: new Date(),
            createdBy: actorName,
            reservationId: reservation.id
          });
        }
        tx.update(doc(db, "reservations", reservation.id), { status: "checked-out", checkedOutAt: new Date() });
      });
      await loadAll();
      alert("Checked out");
    } catch (err) {
      console.error("doCheckOut error:", err);
      alert("Check-out failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  }

  // Print actions (link to admin print template via ReservationDetailC)
  function printCheckInForm() {
    if (!reservation) return;
    if ((reservation.status || "").toLowerCase() === "checked-out") return;
    setPrintMode("checkin");
    setTimeout(() => { window.print(); setPrintMode(null); }, 80);
  }
  function printCheckOutForm() {
    if (!reservation) return;
    if ((reservation.status || "").toLowerCase() !== "checked-out") return;
    setPrintMode("checkout");
    setTimeout(() => { window.print(); setPrintMode(null); }, 80);
  }

  // Derived visible postings & totals
  const visiblePostings = useMemo(() => (postings || []).filter(p => ((p.status || "") + "").toLowerCase() !== "void"), [postings]);
  const chargeLines = useMemo(() => visiblePostings.filter(p => ((p.accountCode || "") + "").toUpperCase() !== "PAY"), [visiblePostings]);
  const paymentsTotal = useMemo(() => (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const chargesTotal = useMemo(() => chargeLines.reduce((s, p) => s + Number(p.amount || 0), 0), [chargeLines]);
  const balanceTotal = chargesTotal - paymentsTotal;

  // Live preview helpers (IDR -> 'id-ID')
  const formatCurrencyPreview = (rawNumberOrStr) => {
    const num = Number(rawNumberOrStr || 0);
    return `IDR ${Number(num || 0).toLocaleString("id-ID")}`;
  };
  const chargePreviewTotal = () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    return formatCurrencyPreview(qty * unit);
  };
  const paymentPreviewAmount = () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    return formatCurrencyPreview(amt);
  };

  if (loading || !reservation) return <div style={{ padding: 20 }}>Loading reservation…</div>;

  return (
    <div>
      <ReservationDetailB
        reservation={reservation}
        assignRooms={assignRooms}
        setAssignRooms={async (next) => {
          setAssignRooms(next);
          try {
            await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
            // create forecasts for newly assigned rooms (basic strategy: create forecasts for assigned rooms)
            await createForecastRoomPostings(reservation, next);
            await ensureDepositPosting(reservation, next);
            await loadAll();
          } catch (err) { console.error("setAssignRooms persist error", err); }
        }}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        printCheckInForm={printCheckInForm}
        printCheckOutForm={printCheckOutForm}
        stays={stays}
        fmt={(d) => (d ? new Date(d).toLocaleString() : "-")}
      />

      <ReservationDetailC
        reservation={reservation}
        chargeLines={chargeLines}
        chargesTotal={chargesTotal}
        payments={payments}
        paymentsTotal={paymentsTotal}
        balance={balanceTotal}
        showAddCharge={showAddCharge}
        setShowAddCharge={setShowAddCharge}
        chargeForm={chargeForm}
        setChargeForm={setChargeForm}
        submitCharge={submitCharge}
        showAddPayment={showAddPayment}
        setShowAddPayment={setShowAddPayment}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        submitPayment={submitPayment}
        printRef={printRef}
        printMode={printMode}
        chargePreviewTotal={chargePreviewTotal}
        paymentPreviewAmount={paymentPreviewAmount}
        formatCurrencyPreview={formatCurrencyPreview}
        fmt={(d) => (d ? new Date(d).toLocaleString() : "-")}
      />
    </div>
  );
}
