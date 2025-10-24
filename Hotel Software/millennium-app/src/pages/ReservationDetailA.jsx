// src/pages/ReservationDetailA.jsx
import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  addDoc,
  orderBy,
  onSnapshot,
  runTransaction,
} from "firebase/firestore";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

/**
 * ReservationDetailA — Refactored robust controller for reservation view.
 * Objectives:
 * - Retain all logic (load, check-in/out, postings, payments, logging, printing)
 * - Improve structure, reliability, readability
 * - Modularize core logic and Firestore transactions
 */

export default function ReservationDetailA({
  permissions = [],
  currentUser = null,
  userData = null,
}) {
  // ========== [region: ROUTING / META] ==========
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName =
    currentUser?.displayName || currentUser?.email || userData?.name || "frontdesk";

  // ========== [region: PERMISSIONS] ==========
  const can = useCallback(
    (p) => permissions.includes(p) || permissions.includes("*"),
    [permissions]
  );
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canUpgrade = can("canUpgradeRoom") || can("canOverrideRoomType");
  const canOverrideBilling = can("canOverrideBilling");
  const isAdmin = userData?.roleId === "admin";

  // ========== [region: STATE MANAGEMENT] ==========
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [logs, setLogs] = useState([]);
  const [assignRooms, setAssignRooms] = useState([]);
  const [loading, setLoading] = useState(false);

  // UI Modals
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [chargeForm, setChargeForm] = useState({
    description: "",
    qtyStr: "1",
    unitStr: "",
    accountCode: "MISC",
  });
  const [paymentForm, setPaymentForm] = useState({
    amountStr: "",
    method: "cash",
    refNo: "",
    type: "payment",
  });

  // Print
  const printRef = useRef(null);
  const [printMode, setPrintMode] = useState(null);
  const printReadyResolverRef = useRef(null);

  const createPrintReadyPromise = () =>
    new Promise((resolve) => {
      printReadyResolverRef.current = resolve;
    });

  // Defensive concurrency
  const creatingForecastsRef = useRef(false);
  const skippedZeroRateWarningsRef = useRef(new Set());

  // ========== [region: UTILITIES] ==========
  const onlyDigits = (s) => (s || "").replace(/[^\d]/g, "");
  const toInt = (s) => (onlyDigits(s) ? parseInt(onlyDigits(s), 10) : 0);
  const fmtIdr = (n) => `IDR ${Number(n || 0).toLocaleString("id-ID")}`;
  const statusOf = (x) => (x?.status || "").toLowerCase();
  const acctOf = (x) => (x?.accountCode || "").toUpperCase();
  const safeDate = (x) =>
    x?.toDate ? x.toDate() : new Date(x || Date.now());

  // Helper for fmt timestamps (robust)
  const fmt = useCallback((raw) => {
    if (!raw && raw !== 0) return "-";
    let d = null;
    try {
      if (typeof raw?.toDate === "function") d = raw.toDate();
      else if (raw?.seconds) d = new Date(raw.seconds * 1000);
      else if (raw instanceof Date) d = raw;
      else if (typeof raw === "number") d = new Date(raw);
      else if (typeof raw === "string") d = new Date(raw);
      else d = new Date(raw);
    } catch {
      d = null;
    }
    return d && !isNaN(d.getTime()) ? d.toLocaleString() : "-";
  }, []);

  // ========== [region: CORE LOGIC HELPERS] ==========

  /** ensures deposit posting exists for reservation */
  const ensureDepositPosting = useCallback(async (resObj, assignedRooms = []) => {
    const depositPerRoom = Number(resObj.depositPerRoom ?? settings.depositPerRoom ?? 0);
    const depositTotal = depositPerRoom * assignedRooms.length;
    if (depositTotal <= 0) return;

    const depositId = `${resObj.id}_DEPOSIT`;
    const ref = doc(db, "postings", depositId);
    const desiredStatus =
      statusOf(resObj) === "checked-in" ? "posted" : "forecast";

    await setDoc(
      ref,
      {
        reservationId: resObj.id,
        description: "Security Deposit",
        amount: depositTotal,
        accountCode: "DEPOSIT",
        status: desiredStatus,
        createdAt: new Date(),
        createdBy: actorName,
      },
      { merge: true }
    );
  }, [settings, actorName]);

  /** compute rate based on multiple fallbacks */
  const rateFor = useCallback(
    (roomType, channelName, date, roomDoc = null, channelList = null) => {
      const normalize = (s) => (s || "").trim().toLowerCase();
      const channelId = normalize(channelName);
      const rtype = (roomType || "").trim();

      let rd = rates.find(
        (r) =>
          normalize(r.roomType) === normalize(rtype) &&
          normalize(r.channelId) === channelId
      );
      if (!rd) rd = rates.find((r) => normalize(r.roomType) === normalize(rtype));
      if (rd) {
        if (channelId === "direct") {
          const isWeekend = [0, 6].includes(date.getDay());
          return isWeekend ? rd.weekendRate || 0 : rd.weekdayRate || 0;
        }
        return rd.price || rd.baseRate || rd.nightlyRate || 0;
      }
      // fallback to room doc
      if (roomDoc?.defaultRate) return roomDoc.defaultRate;
      return 0;
    },
    [rates]
  );

  /** create forecast postings per room-night */
  const createForecastRoomPostings = useCallback(
    async (res, assigned, g, allRooms, chList) => {
      if (!res || creatingForecastsRef.current) return;
      creatingForecastsRef.current = true;
      try {
        const nights = [];
        const ci = safeDate(res.checkInDate);
        const co = safeDate(res.checkOutDate);
        for (let d = new Date(ci); d < co; d.setDate(d.getDate() + 1)) {
          nights.push(new Date(d));
        }

        const pSnap = await getDocs(
          query(collection(db, "postings"), where("reservationId", "==", res.id))
        );
        const existing = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

        for (const roomNumber of assigned) {
          const roomDoc = allRooms.find((r) => r.roomNumber === roomNumber);
          if (!roomDoc) continue;
          for (const d of nights) {
            const description = `Room charge ${roomDoc.roomType} ${d
              .toISOString()
              .slice(0, 10)}`;
            if (
              existing.some(
                (e) =>
                  acctOf(e) === "ROOM" &&
                  e.roomNumber === roomNumber &&
                  e.description === description
              )
            )
              continue;

            const base = rateFor(roomDoc.roomType, res.channel, d, roomDoc, chList);
            if (!base || base <= 0) continue;
            await addDoc(collection(db, "postings"), {
              reservationId: res.id,
              roomNumber,
              description,
              amount: base,
              status: "forecast",
              accountCode: "ROOM",
              createdAt: new Date(),
              createdBy: actorName,
            });
          }
        }
      } finally {
        creatingForecastsRef.current = false;
      }
    },
    [rateFor, actorName]
  );

  // ========== [region: LOAD & SUBSCRIPTIONS] ==========
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resSnap, roomsSnap, settingsSnap, ratesSnap, evSnap, chSnap] =
        await Promise.all([
          getDoc(doc(db, "reservations", id)),
          getDocs(collection(db, "rooms")),
          getDoc(doc(db, "settings", "general")),
          getDocs(collection(db, "rates")),
          getDocs(collection(db, "events")),
          getDocs(collection(db, "channels")),
        ]);

      if (!resSnap.exists()) {
        navigate("/calendar");
        return;
      }
      const res = { id: resSnap.id, ...resSnap.data() };
      if (statusOf(res) === "deleted") {
        navigate("/calendar");
        return;
      }
      setReservation(res);
      setRooms(roomsSnap.docs.map((d) => d.data()));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
      setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEvents(evSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setChannels(chSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const assigned = Array.isArray(res.roomNumbers)
        ? res.roomNumbers
        : res.roomNumber
        ? [res.roomNumber]
        : [];
      setAssignRooms(assigned);

      if (res.guestId) {
        const gSnap = await getDoc(doc(db, "guests", res.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      }

      const [stSnap, postSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, "stays"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id))),
      ]);
      setStays(stSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPostings(postSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("load() failed", err);
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  useEffect(() => {
    if (!reservation?.id) return;
    const collRef = collection(doc(db, "reservations", reservation.id), "logs");
    const q = query(collRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) =>
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, [reservation?.id]);

  // ========== [region: CRUD & ACTIONS] ==========
  const logReservationChange = async (action, details = {}) => {
    if (!reservation?.id) return;
    try {
      await addDoc(collection(doc(db, "reservations", reservation.id), "logs"), {
        action,
        details,
        createdAt: new Date(),
        createdBy: actorName,
      });
    } catch (err) {
      console.warn("logReservationChange failed", err);
    }
  };

  const handleEditReservation = async (updates = {}) => {
    if (!reservation?.id) return;
    const payload = { ...updates, updatedAt: new Date(), updatedBy: actorName };
    await updateDoc(doc(db, "reservations", reservation.id), payload);
    await logReservationChange("edit", { updates: payload });
    await load();
  };

  const handleDeleteReservation = async () => {
    if (!reservation?.id) return;
    if (!window.confirm("Delete this reservation permanently?")) return;
    await updateDoc(doc(db, "reservations", reservation.id), {
      status: "deleted",
      deletedAt: new Date(),
      deletedBy: actorName,
    });
    await logReservationChange("delete");
    navigate("/calendar");
  };

  const submitCharge = async () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description?.trim() || total <= 0) return alert("Invalid charge");
    await addDoc(collection(db, "postings"), {
      reservationId: reservation.id,
      description: chargeForm.description.trim(),
      amount: total,
      accountCode: chargeForm.accountCode.toUpperCase(),
      status: statusOf(reservation) === "checked-in" ? "posted" : "forecast",
      createdAt: new Date(),
      createdBy: actorName,
    });
    setShowAddCharge(false);
    setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
    await load();
  };

  const submitPayment = async () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) return alert("Invalid payment amount");
    await addDoc(collection(db, "payments"), {
      reservationId: reservation.id,
      method: paymentForm.method,
      amount: amt,
      refNo: paymentForm.refNo || "",
      capturedAt: new Date(),
      capturedBy: actorName,
      type: paymentForm.type,
    });
    setShowAddPayment(false);
    await logReservationChange("payment_added", { amount: amt, method: paymentForm.method });
    await load();
  };

  const doCheckIn = async () => {
    if (!reservation || !assignRooms.length)
      return alert("Assign at least one room first.");
    setLoading(true);
    try {
      const stayMap = {};
      await runTransaction(db, async (tx) => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation missing.");
        for (const rn of assignRooms) {
          const sRef = doc(collection(db, "stays"));
          tx.set(sRef, {
            reservationId: reservation.id,
            roomNumber: rn,
            status: "open",
            checkInDate: reservation.checkInDate,
            checkOutDate: reservation.checkOutDate,
            openedAt: new Date(),
            createdBy: actorName,
          });
          stayMap[rn] = sRef.id;
          tx.update(doc(db, "rooms", rn), { status: "Occupied" });
        }
        tx.update(resRef, {
          status: "checked-in",
          checkedInAt: new Date(),
          roomNumbers: assignRooms,
        });
      });
      await ensureDepositPosting(reservation, assignRooms);
      await logReservationChange("check_in");
      await load();
    } finally {
      setLoading(false);
    }
  };

  const doCheckOut = async () => {
    const totalCharges = postings.reduce((s, p) => s + Number(p.amount || 0), 0);
    const totalPayments = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = totalCharges - totalPayments;
    if (balance > 0.01 && !canOverrideBilling)
      return alert(`Outstanding ${fmtIdr(balance)} — override required.`);
    setLoading(true);
    try {
      await runTransaction(db, async (tx) => {
        for (const s of stays.filter((x) => x.status === "open")) {
          tx.update(doc(db, "stays", s.id), { status: "closed", closedAt: new Date() });
          tx.update(doc(db, "rooms", s.roomNumber), { status: "Vacant Dirty" });
        }
        tx.update(doc(db, "reservations", reservation.id), {
          status: "checked-out",
          checkedOutAt: new Date(),
        });
      });
      await logReservationChange("check_out");
      await load();
    } finally {
      setLoading(false);
    }
  };

  const doNoShow = async () => {
    if (statusOf(reservation) !== "booked")
      return alert("Only booked reservations can be marked No Show");
    await updateDoc(doc(db, "reservations", reservation.id), {
      status: "no-show",
      noShowAt: new Date(),
    });
    await logReservationChange("no-show");
    await load();
  };

  // ========== [region: PRINT HANDLERS] ==========
  const handlePrint = async (mode) => {
    if (!reservation) return;
    const allowed =
      (mode === "checkin" && statusOf(reservation) === "checked-in") ||
      (mode === "checkout" && statusOf(reservation) === "checked-out");
    if (!allowed) return alert("Invalid print mode for current status");
    const ready = createPrintReadyPromise();
    setPrintMode(mode);
    await Promise.race([ready, new Promise((r) => setTimeout(r, 2000))]);
    window.print();
    setTimeout(() => setPrintMode(null), 300);
  };

  // ========== [region: DERIVED DATA] ==========
  const visiblePostings = useMemo(
    () => postings.filter((p) => statusOf(p) !== "void"),
    [postings]
  );
  const displayChargeLines = useMemo(
    () =>
      visiblePostings.filter(
        (p) =>
          acctOf(p) !== "PAY" &&
          (statusOf(reservation) === "booked"
            ? statusOf(p) === "forecast"
            : statusOf(p) === "posted")
      ),
    [visiblePostings, reservation]
  );
  const displayChargesTotal = useMemo(
    () =>
      displayChargeLines.reduce(
        (s, p) => s + Number(p.amount || 0) + Number(p.tax || 0),
        0
      ),
    [displayChargeLines]
  );
  const displayPaymentsTotal = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments]
  );
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // ========== [region: RENDER] ==========
  if (loading || !reservation) return <div>Loading reservation…</div>;

  return (
    <div className="reservation-detail">
      {printMode && (
        <ReservationDetailC
          printRef={printRef}
          printMode={printMode}
          onTemplatesLoaded={() =>
            printReadyResolverRef.current && printReadyResolverRef.current()
          }
          reservation={reservation}
          settings={settings}
          postings={postings}
          payments={payments}
          displayChargesTotal={displayChargesTotal}
          displayPaymentsTotal={displayPaymentsTotal}
          displayBalance={displayBalance}
          fmt={fmt}
        />
      )}

      {!printMode && (
        <>
          <ReservationDetailB
            reservation={reservation}
            guest={guest}
            rooms={rooms}
            stays={stays}
            assignRooms={assignRooms}
            setAssignRooms={setAssignRooms}
            canOperate={canOperate}
            canUpgrade={canUpgrade}
            doCheckIn={doCheckIn}
            doCheckOut={doCheckOut}
            doNoShow={doNoShow}
            printCheckInForm={() => handlePrint("checkin")}
            printCheckOutBill={() => handlePrint("checkout")}
            handleEditReservation={handleEditReservation}
            handleDeleteReservation={handleDeleteReservation}
            logReservationChange={logReservationChange}
            fmt={fmt}
            isAdmin={isAdmin}
          />

          {/* Folio & Payments Section */}
          <section className="folio-card" style={{ marginTop: 20 }}>
            <h3>Folio & Payments</h3>
            <div>
              Charges: {fmtIdr(displayChargesTotal)} | Payments:{" "}
              {fmtIdr(displayPaymentsTotal)} | Balance: {fmtIdr(displayBalance)}
            </div>
            <button onClick={() => setShowAddCharge(true)}>Add Charge</button>
            <button onClick={() => setShowAddPayment(true)}>Add Payment</button>
          </section>

          {/* Change Log */}
          <section className="change-log" style={{ marginTop: 20 }}>
            <h3>Change Log</h3>
            {logs.length === 0 ? (
              <div>No changes logged yet.</div>
            ) : (
              <ul>
                {logs.map((l) => (
                  <li key={l.id}>
                    <strong>{l.action}</strong> — {fmt(l.createdAt)} —{" "}
                    {JSON.stringify(l.details || {})}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
