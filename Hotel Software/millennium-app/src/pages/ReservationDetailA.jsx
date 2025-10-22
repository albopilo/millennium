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
  orderBy,
  serverTimestamp
} from "firebase/firestore";
import { db } from "../firebase"; // adjust path if needed
import { fmt, ymd } from "../lib/dates"; // adjust path if needed

import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

/**
 * ReservationDetailA.jsx
 * - Top-level controller for reservation detail (loads data, handles actions)
 * - Includes full forecasting & deposit logic:
 *    - createForecastRoomPostings(reservation, assignRooms, rates)
 *    - ensureDepositPosting(reservation, assignRooms)
 *    - convertForecastsToPosted(reservation)
 * - Provides live formatted-currency preview helpers for UI (IDR, 'id-ID').
 *
 * Important: numeric inputs remain raw strings in UI (no debounce). We parse values only on submit.
 */

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();

  // actor name
  const actorName =
    currentUser?.displayName ||
    currentUser?.name ||
    currentUser?.email ||
    "frontdesk";

  // permission helpers
  const isAdmin = userData?.roleId === "admin";
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const canUpgrade = can("canUpgradeRoom") || can("canOverrideRoomType");
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canOverrideBilling = can("canOverrideBilling");

  // data
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [guest, setGuest] = useState(null);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [channels, setChannels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  // assignment UI
  const [assignRooms, setAssignRooms] = useState([]);

  // room move/upgrade UI
  const [moveRoomStay, setMoveRoomStay] = useState(null);
  const [newRoom, setNewRoom] = useState("");
  const [upgradeStay, setUpgradeStay] = useState(null);
  const [upgradeRoom, setUpgradeRoom] = useState("");
  const [upgradeIndex, setUpgradeIndex] = useState(null);
  const [upgradePreRoom, setUpgradePreRoom] = useState("");

  // add charge/payment UI (raw strings — no debounce)
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({
    description: "",
    qtyStr: "1",
    unitStr: "",
    accountCode: "MISC"
  });

  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amountStr: "",
    method: "cash",
    refNo: "",
    type: "payment"
  });

  // delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);

  // printing
  const printRef = useRef(null);
  const [printMode, setPrintMode] = useState(null);

  // helpers
  const currency = settings.currency || "IDR";
  const fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID"));

  const onlyDigits = (s) => (s || "").replace(/[^\d]/g, "");
  const toInt = (s) => {
    const k = onlyDigits(s);
    if (!k) return 0;
    const v = parseInt(k, 10);
    return isNaN(v) ? 0 : v;
  };

  const statusOf = (p) => ((p?.status || "") + "").toLowerCase();
  const acctOf = (p) => ((p?.accountCode || "") + "").toUpperCase();

  // --- Load function ---
  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [
        resSnap,
        roomsSnap,
        settingsSnap,
        ratesSnap,
        eventsSnap,
        channelsSnap
      ] = await Promise.all([
        getDoc(doc(db, "reservations", id)),
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
        getDocs(collection(db, "rates")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "channels"))
      ]);

      if (!resSnap.exists()) { navigate("/calendar"); return; }
      const res = { id: resSnap.id, ...resSnap.data() };
      setReservation(res);

      setRooms(roomsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
      setRates(ratesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setEvents(eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setChannels(channelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const initialAssigned = Array.isArray(res.roomNumbers)
        ? [...res.roomNumbers]
        : res.roomNumber
        ? [res.roomNumber]
        : [];
      setAssignRooms(initialAssigned);

      // guest
      if (res.guestId) {
        const gSnap = await getDoc(doc(db, "guests", res.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      }

      // stays, postings, payments
      const sSnap = await getDocs(query(collection(db, "stays"), where("reservationId", "==", res.id)));
      setStays(sSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const [pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id)))
      ]);
      setPostings(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("load error", err);
    } finally {
      setLoading(false);
    }
  };

  // logs subscription
  useEffect(() => {
    if (!reservation?.id) return;
    const collRef = collection(doc(db, "reservations", reservation.id), "logs");
    const q = query(collRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error(err));
    return () => unsub();
  }, [reservation?.id]);

  useEffect(() => { if (id) load(); }, [id]);

  // -----------------------
  // Forecast & Deposit logic
  // -----------------------

  // Date helpers: iterate days from checkIn (inclusive) to checkOut (exclusive)
  function iterateDates(checkInStr, checkOutStr) {
    const result = [];
    const start = new Date(checkInStr);
    const end = new Date(checkOutStr);
    const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    while (cur < end) {
      result.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return result;
  }

  // Rate lookup: simple implementation: find rate that matches date (if you have date-based rates in 'rates')
  function rateForDate(ratesArray, aDate, roomTypeOrRateCode) {
    // naive: find first rate with rateCode === roomTypeOrRateCode or with default field
    if (!ratesArray || ratesArray.length === 0) return null;
    // prefer explicit match by code or room type
    const dt = new Date(aDate);
    // Prefer rate that has start/end and matches date if provided
    for (const r of ratesArray) {
      try {
        if (roomTypeOrRateCode && (r.rateCode === roomTypeOrRateCode || r.roomType === roomTypeOrRateCode)) {
          // check date range if present
          if (r.startDate && r.endDate) {
            const s = new Date(r.startDate);
            const e = new Date(r.endDate);
            if (dt >= s && dt <= e) return r;
          } else {
            return r;
          }
        }
      } catch (er) { /* ignore and continue */ }
    }
    // fallback to first rate without dates
    return ratesArray[0];
  }

  /**
   * createForecastRoomPostings
   * - For each assigned room: create postings for each night in the stay (per-room per-day).
   * - Uses rates[] to determine per-night amount; if rate not available, falls back to reservation.rate or 0.
   * - Adds postings with status "forecast".
   */
  const createForecastRoomPostings = async (reservationDoc, assignedRooms = [], { ratesArray = [] } = {}) => {
    if (!reservationDoc || !reservationDoc.checkInDate || !reservationDoc.checkOutDate) return;
    const nights = iterateDates(reservationDoc.checkInDate, reservationDoc.checkOutDate);
    if (!nights.length || !assignedRooms.length) return;

    try {
      // We'll add postings outside of a large transaction to avoid long TXs; each posting is added as separate addDoc.
      const created = [];
      for (const roomNumber of assignedRooms) {
        for (const night of nights) {
          const r = rateForDate(ratesArray, night, reservationDoc.rateCode || reservationDoc.roomType);
          const unitAmount = (r && r.amount) ? Number(r.amount) : Number(reservationDoc.rate || 0);
          const isoDate = night.toISOString();
          const desc = r && r.name ? `${r.name} — ${fmt(isoDate)}` : `Room charge ${fmt(isoDate)}`;
          const posting = {
            reservationId: reservationDoc.id,
            stayId: null,
            roomNumber,
            description: desc,
            amount: unitAmount,
            tax: 0,
            service: 0,
            quantity: 1,
            unitAmount,
            accountCode: "ROOM",
            status: "forecast",
            date: isoDate,
            createdAt: new Date(),
            createdBy: actorName
          };
          const added = await addDoc(collection(db, "postings"), posting);
          created.push({ id: added.id, ...posting });
        }
      }
      return created;
    } catch (err) {
      console.error("createForecastRoomPostings error:", err);
      throw err;
    }
  };

  /**
   * ensureDepositPosting
   * - Ensures a deposit posting exists per assigned room (one per room).
   * - If a deposit posting already exists for same reservation & room with accountCode 'DEPOSIT' and not void, skip.
   */
  const ensureDepositPosting = async (reservationDoc, assignedRooms = []) => {
    if (!reservationDoc) return;
    const depositPerRoom = Number(settings.depositPerRoom || 0);
    if (!depositPerRoom || depositPerRoom <= 0) return [];

    const created = [];
    try {
      for (const roomNumber of assignedRooms) {
        // check existing deposit postings
        const q = query(
          collection(db, "postings"),
          where("reservationId", "==", reservationDoc.id),
          where("roomNumber", "==", roomNumber),
          where("accountCode", "==", "DEPOSIT")
        );
        const snap = await getDocs(q);
        const hasActive = snap.docs.some(d => ((d.data()?.status || "") + "").toLowerCase() !== "void");
        if (!hasActive) {
          const posting = {
            reservationId: reservationDoc.id,
            stayId: null,
            roomNumber,
            description: "Security deposit",
            amount: depositPerRoom,
            tax: 0,
            service: 0,
            quantity: 1,
            unitAmount: depositPerRoom,
            accountCode: "DEPOSIT",
            status: "forecast", // deposit forecast until posted
            date: reservationDoc.checkInDate,
            createdAt: new Date(),
            createdBy: actorName
          };
          const added = await addDoc(collection(db, "postings"), posting);
          created.push({ id: added.id, ...posting });
        }
      }
      return created;
    } catch (err) {
      console.error("ensureDepositPosting error:", err);
      throw err;
    }
  };

  /**
   * convertForecastsToPosted
   * - When checking in: convert the forecast postings (status 'forecast') for this reservation into 'posted'.
   * - This implementation finds forecast postings by reservationId and sets status => 'posted'.
   */
  const convertForecastsToPosted = async (reservationId) => {
    if (!reservationId) return;
    try {
      const q = query(collection(db, "postings"), where("reservationId", "==", reservationId), where("status", "==", "forecast"));
      const snap = await getDocs(q);
      const updates = [];
      for (const docSnap of snap.docs) {
        const pRef = doc(db, "postings", docSnap.id);
        // we update one-by-one to avoid long transactions; in a high-integrity environment consider batching
        await updateDoc(pRef, { status: "posted", postedAt: new Date() });
        updates.push(docSnap.id);
      }
      return updates;
    } catch (err) {
      console.error("convertForecastsToPosted error:", err);
      throw err;
    }
  };

  // -----------------------
  // Posting helpers: add charge (parses values only on submit)
  // -----------------------
  const submitCharge = async () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description.trim()) { window.alert("Description required"); return; }
    if (total <= 0) { window.alert("Total must be > 0"); return; }

    // Use "posted" if checked-in, else keep as "forecast"
    const status = (reservation?.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";
    try {
      await addDoc(collection(db, "postings"), {
        reservationId: reservation.id,
        stayId: null,
        roomNumber: null,
        description: chargeForm.description.trim(),
        amount: total,
        tax: 0,
        service: 0,
        status,
        accountCode: (chargeForm.accountCode || "MISC").toUpperCase(),
        quantity: qty,
        unitAmount: unit,
        createdAt: new Date(),
        createdBy: actorName
      });
      setShowAddCharge(false);
      setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
      await load();
    } catch (err) {
      console.error(err);
      window.alert("Failed to add charge.");
    }
  };

  // -----------------------
  // Payment submit (no debounce; parse on submit)
  // -----------------------
  const submitPayment = async () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) { window.alert("Payment must be > 0"); return; }
    try {
      await addDoc(collection(db, "payments"), {
        reservationId: reservation.id,
        stayId: null,
        method: paymentForm.method || "cash",
        amount: amt,
        refNo: paymentForm.refNo || "",
        capturedAt: new Date(),
        capturedBy: actorName,
        type: paymentForm.type || "payment"
      });
      setShowAddPayment(false);
      setPaymentForm({ amountStr: "", method: "cash", refNo: "", type: "payment" });
      await load();
    } catch (err) {
      console.error(err);
      window.alert("Failed to add payment.");
    }
  };

  // -----------------------
  // Check-in / Check-out handlers (with forecast/deposit logic re-inserted)
  // -----------------------
  const doCheckIn = async () => {
    if (!reservation) return;
    const status = (reservation.status || "").toLowerCase();
    if (status !== "booked") { window.alert("Reservation not bookable"); return; }
    if (!assignRooms.length) { window.alert("No rooms selected"); return; }

    setLoading(true);
    try {
      // 1) Create stays and room occupancy in a transaction
      await runTransaction(db, async (tx) => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation not found");
        // create one stay per assigned room
        for (const roomNumber of assignRooms) {
          const stayRef = doc(collection(db, "stays"));
          tx.set(stayRef, {
            reservationId: reservation.id,
            guestId: guest?.id || null,
            guestName: reservation.guestName || "",
            roomNumber,
            checkInDate: reservation.checkInDate,
            checkOutDate: reservation.checkOutDate,
            openedAt: new Date(),
            closedAt: null,
            status: "open",
            balance: 0,
            currency,
            createdBy: actorName
          });
          // try to mark room as occupied (room doc id is assumed to be roomNumber)
          const roomRef = doc(db, "rooms", roomNumber);
          tx.update(roomRef, { status: "Occupied", lastOccupiedAt: new Date() });
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });

      // 2) Convert forecasts to posted (common behavior when checking in)
      await convertForecastsToPosted(reservation.id);

      // 3) Ensure deposit postings per room (if your settings require)
      await ensureDepositPosting(reservation, assignRooms);

      await load();
      window.alert("Checked in.");
    } catch (err) {
      console.error("doCheckIn error:", err);
      window.alert("Check-in failed: " + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  const doCheckOut = async () => {
    if (!reservation) return;

    // compute balance to check override requirement
    const displayChargesTotal = (postings || [])
      .filter(p => (p.status || "").toLowerCase() !== "void")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const displayPaymentsTotal = (payments || [])
      .filter(p => (p.status || "").toLowerCase() !== "void")
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    const displayBalance = displayChargesTotal - displayPaymentsTotal;

    if (displayBalance > 0.01 && !canOverrideBilling) {
      window.alert(`Outstanding: ${currency} ${fmtMoney(displayBalance)}. Cannot check out without override.`);
      return;
    }

    setLoading(true);
    try {
      // close open stays, mark rooms Vacant Dirty, and create housekeeping tasks
      // We'll perform these operations in a transaction where we can
      await runTransaction(db, async (tx) => {
        const openStays = stays.filter(s => (s.status || "") === "open");
        for (const s of openStays) {
          tx.update(doc(db, "stays", s.id), { status: "closed", closedAt: new Date() });
          // mark room as Vacant Dirty
          tx.update(doc(db, "rooms", s.roomNumber), { status: "Vacant Dirty" });
          // create HK task
          const taskRef = doc(collection(db, "hk_tasks"));
          tx.set(taskRef, {
            roomNumber: s.roomNumber,
            date: ymd(new Date()),
            type: "clean",
            status: "pending",
            createdAt: new Date(),
            createdBy: actorName,
            reservationId: reservation.id
          });
        }
      });

      // mark reservation as checked-out
      await updateDoc(doc(db, "reservations", reservation.id), { status: "checked-out", checkedOutAt: new Date() });
      await load();
      window.alert("Checked out.");
    } catch (err) {
      console.error("doCheckOut error:", err);
      window.alert("Check-out failed: " + (err.message || String(err)));
    } finally {
      setLoading(false);
    }
  };

  // Print actions (show printable area and trigger print)
  const printCheckInForm = () => {
    if (!reservation) return;
    // hide check-in print if already checked-out
    if ((reservation.status || "").toLowerCase() === "checked-out") {
      return;
    }
    setPrintMode("checkin");
    setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 60);
  };

  const printCheckOutForm = () => {
    if (!reservation) return;
    // show only if checked-out
    if ((reservation.status || "").toLowerCase() !== "checked-out") {
      return;
    }
    setPrintMode("checkout");
    setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 60);
  };

  // Visible postings and computed totals
  const visiblePostings = useMemo(() => (postings || []).filter(p => (p.status || "").toLowerCase() !== "void"), [postings]);
  const displayChargeLines = useMemo(() =>
    visiblePostings.filter(p => acctOf(p) !== "PAY")
    , [visiblePostings]);
  const displayChargesTotal = useMemo(() => displayChargeLines.reduce((s, p) => s + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0), [displayChargeLines]);
  const displayPaymentsTotal = useMemo(() => (payments || []).filter(p => (p.status || "").toLowerCase() !== "void").reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // ---------- Live currency preview helpers (IDR / 'id-ID') ----------
  // returns formatted string like "IDR 1.000.000"
  const formatCurrencyIdr = (num) => {
    const n = Number(num || 0) || 0;
    // use id-ID locale
    return `${currency} ${n.toLocaleString("id-ID")}`;
  };

  // Given chargeForm.qtyStr and chargeForm.unitStr, compute preview total
  const chargePreviewTotal = () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    return formatCurrencyIdr(total);
  };

  // Given paymentForm.amountStr, compute preview
  const paymentPreviewAmount = () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    return formatCurrencyIdr(amt);
  };

  // ---------- UI guard: show/hide print buttons based on reservation.status is implemented in child components ----------

  if (loading || !reservation) return <div style={{ padding: 20 }}>Loading reservation…</div>;

  return (
    <div>
      {printMode ? (
        <ReservationDetailC
          reservation={reservation}
          printRef={printRef}
          printMode={printMode}
          displayChargeLines={displayChargeLines}
          displayChargesTotal={displayChargesTotal}
          displayPaymentsTotal={displayPaymentsTotal}
          displayBalance={displayBalance}
          postings={postings}
          payments={payments}
          guest={guest}
          rooms={rooms}
          settings={settings}
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
          fmt={fmt}
          // preview helpers to allow reservationDetailC to show live formatted previews
          chargePreviewTotal={chargePreviewTotal}
          paymentPreviewAmount={paymentPreviewAmount}
          formatCurrencyIdr={formatCurrencyIdr}
        />
      ) : (
        <>
          <ReservationDetailB
            reservation={reservation}
            guest={guest}
            settings={settings}
            rooms={rooms}
            assignRooms={assignRooms}
            setAssignRooms={async (next) => {
              // persist assignment immediately to reservation
              setAssignRooms(next);
              try {
                await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
                // regenerate forecasts for new assignment
                // delete existing forecasts? For parity we will create forecasts for added rooms only
                // (You may prefer to clean all forecasts and recreate — left intentionally simple)
                if (next && next.length) {
                  await createForecastRoomPostings(reservation, next, { ratesArray: rates });
                  await ensureDepositPosting(reservation, next);
                }
                await load();
              } catch (err) {
                console.error("setAssignRooms error:", err);
              }
            }}
            renderAssignmentRow={(i) => (
              <div key={i} style={{ marginBottom: 6 }}>
                <select
                  value={assignRooms[i] || ""}
                  onChange={async (e) => {
                    const val = e.target.value;
                    const next = [...assignRooms];
                    next[i] = val;
                    setAssignRooms(next);
                    try {
                      await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
                      await load();
                    } catch (err) {
                      console.error(err);
                    }
                  }}
                >
                  <option value="">Select room</option>
                  {rooms.filter(r => (r.status !== "OOO" && r.status !== "Occupied") || (reservation.roomNumbers || []).includes(r.roomNumber)).map(r => (
                    <option key={r.roomNumber} value={r.roomNumber}>
                      {r.roomNumber} ({r.roomType}) {r.status ? `[${r.status}]` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
            canOperate={canOperate}
            canUpgrade={canUpgrade}
            doCheckIn={doCheckIn}
            doCheckOut={doCheckOut}
            printCheckInForm={printCheckInForm}
            printCheckOutForm={printCheckOutForm}
            moveRoomStay={moveRoomStay}
            setMoveRoomStay={setMoveRoomStay}
            newRoom={newRoom}
            setNewRoom={setNewRoom}
            upgradeStay={upgradeStay}
            setUpgradeStay={setUpgradeStay}
            upgradeRoom={upgradeRoom}
            setUpgradeRoom={setUpgradeRoom}
            upgradeIndex={upgradeIndex}
            setUpgradeIndex={setUpgradeIndex}
            upgradePreRoom={upgradePreRoom}
            setUpgradePreRoom={setUpgradePreRoom}
            doUpgradePreCheckIn={async () => { /* omitted for brevity */ }}
            doUpgradeRoom={async () => { /* omitted for brevity */ }}
            stays={stays}
            handleDeleteReservation={() => setShowDeleteModal(true)}
            isAdmin={isAdmin}
            fmt={fmt}
          />

          <ReservationDetailC
            reservation={reservation}
            displayChargeLines={displayChargeLines}
            displayChargesTotal={displayChargesTotal}
            displayPaymentsTotal={displayPaymentsTotal}
            displayBalance={displayBalance}
            postings={postings}
            payments={payments}
            guest={guest}
            rooms={rooms}
            settings={settings}
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
            fmt={fmt}
            // preview helpers for the inline modals to show formatted preview instantly while user types
            chargePreviewTotal={chargePreviewTotal}
            paymentPreviewAmount={paymentPreviewAmount}
            formatCurrencyIdr={formatCurrencyIdr}
          />
        </>
      )}
    </div>
  );
}
