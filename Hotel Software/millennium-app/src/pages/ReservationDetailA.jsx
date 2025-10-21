// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  onSnapshot,
  orderBy,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { fmt, ymd } from "../lib/dates";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName =
    currentUser?.displayName ||
    currentUser?.name ||
    currentUser?.email ||
    "frontdesk";
  const isAdmin = userData?.roleId === "admin";

  // States
  const [loading, setLoading] = useState(true);
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [guest, setGuest] = useState(null);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [logs, setLogs] = useState([]);
  const [assignRooms, setAssignRooms] = useState([]);

  // UI states for modals and free-typing numeric fields (strings)
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
  });

  const can = (perm) => Array.isArray(permissions) && (permissions.includes(perm) || permissions.includes("*"));
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canManage = can("canEditReservations") || can("canManageReservations");

  // helpers
  const currency = settings.currency || "IDR";
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  // Load all data needed for page
  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const [
        resSnap,
        roomsSnap,
        settingsSnap,
        ratesSnap,
        eventsSnap,
        channelsSnap,
      ] = await Promise.all([
        getDoc(doc(db, "reservations", id)),
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
        getDocs(collection(db, "rates")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "channels")),
      ]);

      if (!resSnap.exists()) {
        setLoading(false);
        navigate("/calendar");
        return;
      }
      const r = { id: resSnap.id, ...resSnap.data() };
      setReservation(r);

      setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setChannels(channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      if (settingsSnap.exists()) setSettings(settingsSnap.data());

      // guest
      if (r.guestId) {
        const gSnap = await getDoc(doc(db, "guests", r.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      } else {
        // try match by name
        const gQ = query(collection(db, "guests"), where("name", "==", r.guestName || ""));
        const gS = await getDocs(gQ);
        if (!gS.empty) setGuest({ id: gS.docs[0].id, ...gS.docs[0].data() });
      }

      // postings/payments/stays
      const [pSnap, paySnap, sSnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "stays"), where("reservationId", "==", id))),
      ]);
      setPostings(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setStays(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // assignment
      setAssignRooms(Array.isArray(r.roomNumbers) ? [...r.roomNumbers] : []);

      // subscribe logs separately (keeps UI live)
      // (subscription handled in useEffect below)
    } catch (err) {
      console.error("loadAll error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (id) loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // logs subscription
  useEffect(() => {
    if (!id) return;
    const collRef = collection(doc(db, "reservations", id), "logs");
    const q = query(collRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, (err) => {
      console.error("logs onSnapshot error:", err);
    });
    return () => unsub();
  }, [id]);

  // Utilities
  const statusOf = (s) => ((s || "").toLowerCase());
  const onlyDigits = (s) => (s || "").replace(/[^\d.-]/g, "");

  // Logging helper (safe)
  async function logAction(action, payload = {}) {
    try {
      const now = new Date();
      const entry = {
        reservationId: reservation?.id || id,
        action,
        by: actorName,
        payload: payload || {},
        createdAt: now,
      };
      // write to global collection (best-effort)
      try {
        await addDoc(collection(db, "reservation_logs"), entry);
      } catch (e) { /* ignore */ }
      // write under reservation subcollection
      try {
        if (reservation?.id) {
          await addDoc(collection(doc(db, "reservations", reservation.id), "logs"), entry);
        }
      } catch (e) { /* ignore */ }
    } catch (err) {
      console.error("logAction error:", err);
    }
  }

  // Room availability check (simple)
  async function isRoomAvailableForRes(roomNumber) {
    if (!reservation?.checkInDate || !reservation?.checkOutDate) return true;
    const inD = reservation.checkInDate?.toDate ? reservation.checkInDate.toDate() : new Date(reservation.checkInDate);
    const outD = reservation.checkOutDate?.toDate ? reservation.checkOutDate.toDate() : new Date(reservation.checkOutDate);

    const qRes = query(
      collection(db, "reservations"),
      where("roomNumbers", "array-contains", roomNumber),
      where("status", "in", ["booked", "checked-in"])
    );
    const snap = await getDocs(qRes);
    return snap.docs.every((d) => {
      const r = d.data();
      if (d.id === reservation.id) return true;
      const rIn = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
      const rOut = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
      return outD <= rIn || inD >= rOut;
    });
  }

  // Persist assignRooms to reservation and create simple forecasts (very lightweight)
  async function persistAssignment(nextAssign = []) {
    if (!reservation?.id) return;
    try {
      await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: nextAssign });
      await logAction("assignment.update", { roomNumbers: nextAssign });
      // reload to reflect postings/stays
      await loadAll();
    } catch (err) {
      console.error("persistAssignment error:", err);
      throw err;
    }
  }

  // Check-in action: create stays + set room status and update reservation
  async function doCheckIn() {
    if (!canOperate || !reservation) return;
    if (!assignRooms.length) {
      window.alert("Assign at least one room before check-in.");
      return;
    }
    // availability checks
    for (const roomNumber of assignRooms) {
      const ok = await isRoomAvailableForRes(roomNumber);
      if (!ok) {
        window.alert(`Room ${roomNumber} is unavailable for these dates.`);
        return;
      }
    }

    try {
      await runTransaction(db, async (tx) => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation not found.");
        if (statusOf(resSnap.data().status) !== "booked") throw new Error("Reservation not in booked status.");

        // create stays deterministically per assigned room
        for (const rn of assignRooms) {
          const stayRef = doc(collection(db, "stays"));
          tx.set(stayRef, {
            reservationId: reservation.id,
            guestId: reservation.guestId || null,
            guestName: reservation.guestName || "",
            roomNumber: rn,
            checkInDate: reservation.checkInDate,
            checkOutDate: reservation.checkOutDate,
            openedAt: new Date(),
            status: "open",
            createdBy: actorName,
          });
          // set room status to Occupied
          tx.update(doc(db, "rooms", rn), { status: "Occupied" });
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });
      await logAction("checkin", { rooms: assignRooms });
      await loadAll();
      window.alert("Check-in complete.");
    } catch (err) {
      console.error("doCheckIn error:", err);
      window.alert("Check-in failed: " + (err.message || err));
    }
  }

  // Check-out: close stays, set rooms to Vacant Dirty, update reservation status
  async function doCheckOut() {
    if (!canOperate || !reservation) return;
    try {
      await runTransaction(db, async (tx) => {
        // close open stays for this reservation
        const sSnap = await getDocs(query(collection(db, "stays"), where("reservationId", "==", reservation.id), where("status", "==", "open")));
        for (const d of sSnap.docs) {
          tx.update(doc(db, "stays", d.id), { status: "closed", closedAt: new Date() });
          const st = d.data();
          if (st?.roomNumber) {
            tx.update(doc(db, "rooms", st.roomNumber), { status: "Vacant Dirty" });
          }
        }
        // mark reservation checked-out if no open stays remain
        tx.update(doc(db, "reservations", reservation.id), { status: "checked-out", checkedOutAt: new Date() });
      });
      await logAction("checkout", {});
      await loadAll();
      window.alert("Checked out.");
    } catch (err) {
      console.error("doCheckOut error:", err);
      window.alert("Check-out failed: " + (err.message || err));
    }
  }

  // Change room (same type) — expects moveRoomStayId + newRoom
  async function doChangeRoom(moveStay, newRoomNumber) {
    if (!canOperate || !moveStay || !newRoomNumber) return;
    try {
      // availability check
      const ok = await isRoomAvailableForRes(newRoomNumber);
      if (!ok) { window.alert("Target room not available."); return; }

      await runTransaction(db, async (tx) => {
        const stayRef = doc(db, "stays", moveStay.id);
        const newRoomRef = doc(db, "rooms", newRoomNumber);
        const oldRoomRef = doc(db, "rooms", moveStay.roomNumber);

        const [staySnap, newRoomSnap] = await Promise.all([tx.get(stayRef), tx.get(newRoomRef)]);
        if (!staySnap.exists()) throw new Error("Stay not found.");
        if (!newRoomSnap.exists()) throw new Error("New room not found.");
        const nr = newRoomSnap.data();
        if (nr.status === "OOO" || nr.status === "Occupied") throw new Error("New room not available.");

        tx.update(stayRef, { roomNumber: newRoomNumber, movedAt: new Date(), movedBy: actorName });
        tx.update(oldRoomRef, { status: "Vacant Dirty" });
        tx.update(newRoomRef, { status: "Occupied" });
      });
      await logAction("room.move", { from: moveStay.roomNumber, to: newRoomNumber, stayId: moveStay.id });
      await loadAll();
      window.alert("Room changed.");
    } catch (err) {
      console.error("doChangeRoom error:", err);
      window.alert("Change room failed: " + (err.message || err));
    }
  }

  // Pre-check-in upgrade: change assignRooms and add optional ADJ posting (simple)
  async function doUpgradePreCheckIn(index, targetRoomNumber, adjustmentAmount = 0) {
    if (!canOperate) return;
    try {
      const next = [...assignRooms];
      next[index] = targetRoomNumber;
      await persistAssignment(next);
      if (adjustmentAmount && Number(adjustmentAmount) !== 0) {
        await addDoc(collection(db, "postings"), {
          reservationId: reservation.id,
          description: "Upgrade adjustment (pre check-in)",
          amount: Number(adjustmentAmount),
          status: "forecast",
          accountCode: "ADJ",
          createdAt: new Date(),
          createdBy: actorName,
        });
      }
      await logAction("upgrade.pre", { index, to: targetRoomNumber, adj: adjustmentAmount });
      await loadAll();
      window.alert("Upgrade applied (pre check-in).");
    } catch (err) {
      console.error("doUpgradePreCheckIn error:", err);
      window.alert("Upgrade failed: " + (err.message || err));
    }
  }

  // Post-check-in upgrade: switch stay room and post adjustment ADJ
  async function doUpgradeRoom(upgradeStayObj, targetRoomNumber, adjAmount = 0) {
    if (!canOperate || !upgradeStayObj) return;
    try {
      // availability check
      const ok = await isRoomAvailableForRes(targetRoomNumber);
      if (!ok) { window.alert("Target room not available."); return; }

      await runTransaction(db, async (tx) => {
        const stayRef = doc(db, "stays", upgradeStayObj.id);
        const newRoomRef = doc(db, "rooms", targetRoomNumber);
        const oldRoomRef = doc(db, "rooms", upgradeStayObj.roomNumber);

        const [staySnap, newRoomSnap] = await Promise.all([tx.get(stayRef), tx.get(newRoomRef)]);
        if (!staySnap.exists()) throw new Error("Stay not found.");
        const nr = newRoomSnap.data();
        if (!newRoomSnap.exists() || nr.status === "OOO" || nr.status === "Occupied") throw new Error("Target room not available.");

        tx.update(stayRef, { roomNumber: targetRoomNumber, movedAt: new Date(), movedBy: actorName });
        tx.update(oldRoomRef, { status: "Vacant Dirty" });
        tx.update(newRoomRef, { status: "Occupied" });

        if (adjAmount && Number(adjAmount) !== 0) {
          const adjRef = doc(collection(db, "postings"));
          tx.set(adjRef, {
            reservationId: reservation.id,
            stayId: upgradeStayObj.id,
            roomNumber: targetRoomNumber,
            description: "Upgrade adjustment (post check-in)",
            amount: Number(adjAmount),
            tax: 0,
            service: 0,
            status: "posted",
            accountCode: "ADJ",
            createdAt: new Date(),
            createdBy: actorName,
          });
        }
      });

      await logAction("upgrade.after", { from: upgradeStayObj.roomNumber, to: targetRoomNumber, adj: adjAmount });
      await loadAll();
      window.alert("Upgrade completed.");
    } catch (err) {
      console.error("doUpgradeRoom error:", err);
      window.alert("Upgrade failed: " + (err.message || err));
    }
  }

  // Add charge (free-typing allowed). Parse values at submit time.
  async function submitCharge() {
    const qty = parseFloat(onlyDigits(chargeForm.qtyStr)) || 1;
    const unit = parseFloat(onlyDigits(chargeForm.unitStr)) || 0;
    const total = Math.round(qty * unit);
    if (!chargeForm.description?.trim()) { window.alert("Description required."); return; }
    if (total <= 0) { window.alert("Total amount must be > 0."); return; }
    const status = statusOf(reservation?.status) === "checked-in" ? "posted" : "forecast";
    try {
      await addDoc(collection(db, "postings"), {
        reservationId: reservation?.id || id,
        description: chargeForm.description.trim(),
        amount: total,
        quantity: qty,
        unitAmount: unit,
        status,
        accountCode: (chargeForm.accountCode || "MISC").toUpperCase(),
        createdAt: new Date(),
        createdBy: actorName,
      });
      setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
      setShowAddCharge(false);
      await logAction("posting.add", { description: chargeForm.description, amount: total });
      await loadAll();
    } catch (err) {
      console.error("submitCharge error:", err);
      window.alert("Failed to add charge.");
    }
  }

  // Add payment (free typing)
  async function submitPayment() {
    const amt = parseFloat(onlyDigits(paymentForm.amountStr)) || 0;
    if (amt <= 0) { window.alert("Amount must be > 0"); return; }
    try {
      await addDoc(collection(db, "payments"), {
        reservationId: reservation?.id || id,
        amount: amt,
        method: paymentForm.method || "cash",
        refNo: paymentForm.refNo || "",
        capturedAt: new Date(),
        capturedBy: actorName,
      });
      setPaymentForm({ amountStr: "", method: "cash", refNo: "" });
      setShowAddPayment(false);
      await logAction("payment.add", { amount: amt, method: paymentForm.method });
      await loadAll();
    } catch (err) {
      console.error("submitPayment error:", err);
      window.alert("Failed to add payment.");
    }
  }

  // UI renderer for assignment row (used by child)
  const renderAssignmentRow = (idx) => {
    const val = assignRooms[idx] || "";
    const lockType = (() => {
      // if reservation has roomNumbers with types, lock type by index
      const rtype = rooms.find((r) => r.roomNumber === (reservation?.roomNumbers?.[idx] || assignRooms[idx]))?.roomType;
      return rtype || null;
    })();

    const options = rooms
      .filter((r) => (r.status || "").toLowerCase() !== "ooo" && (r.status || "").toLowerCase() !== "occupied")
      .filter((r) => !lockType || r.roomType === lockType)
      .map((r) => ({ value: r.roomNumber, label: `${r.roomNumber} (${r.roomType || "—"}) ${r.status ? `[${r.status}]` : ""}` }));

    // return an element — child will render it where needed
    return (
      <select
        value={val}
        onChange={async (e) => {
          const newVal = e.target.value || "";
          const next = [...assignRooms];
          next[idx] = newVal;
          setAssignRooms(next);
          try {
            await persistAssignment(next);
          } catch (err) {
            console.error("assign persist failed:", err);
            window.alert("Failed to assign room.");
          }
        }}
      >
        <option value="">(select room)</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  };

  // Derived totals for folio (simple)
  const visiblePostings = useMemo(() => (postings || []).filter((p) => ((p.status || "") + "").toLowerCase() !== "void"), [postings]);
  const displayChargeLines = visiblePostings.filter((p) => ((p.accountCode || "") + "").toUpperCase() !== "PAY");
  const displayChargesTotal = displayChargeLines.reduce((s, p) => s + Number(p.amount || 0), 0);
  const displayPaymentsTotal = (payments || []).filter(p => ((p.status || "") + "").toLowerCase() !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

    if (loading)
    return <div className="p-6 text-center">Loading reservation…</div>;
  if (!reservation)
    return (
      <div className="p-6 text-center text-gray-600">
        Reservation not found.
      </div>
    );

  // Simple print helpers (can be replaced with custom templates)
  const printCheckInForm = () => {
    const content = `
      <h2>Check-In Form</h2>
      <p>Guest: ${reservation.guestName}</p>
      <p>Stay: ${fmt(reservation.checkInDate)} → ${fmt(reservation.checkOutDate)}</p>
      <p>Rooms: ${(reservation.roomNumbers || []).join(", ")}</p>
      <p>Handled by: ${actorName}</p>
    `;
    const w = window.open("", "_blank");
    w.document.write(`<html><body>${content}</body></html>`);
    w.print();
    w.close();
  };

  const printCheckOutBill = () => {
    const content = `
      <h2>Check-Out Bill</h2>
      <p>Guest: ${reservation.guestName}</p>
      <p>Charges Total: ${currency} ${fmtMoney(displayChargesTotal)}</p>
      <p>Payments Total: ${currency} ${fmtMoney(displayPaymentsTotal)}</p>
      <p>Balance: ${currency} ${fmtMoney(displayBalance)}</p>
      <p>Handled by: ${actorName}</p>
    `;
    const w = window.open("", "_blank");
    w.document.write(`<html><body>${content}</body></html>`);
    w.print();
    w.close();
  };

  const childProps = {
    reservation,
    guest,
    settings,
    rooms,
    stays,
    assignRooms,
    setAssignRooms,
    renderAssignmentRow,
    canOperate,
    canUpgrade: can("canUpgradeRoom") || can("canOverrideRoomType"),
    doCheckIn,
    doCheckOut,
    doChangeRoom,
    doUpgradePreCheckIn,
    doUpgradeRoom,
    showAddCharge,
    setShowAddCharge,
    showAddPayment,
    setShowAddPayment,
    chargeForm,
    setChargeForm,
    submitCharge,
    paymentForm,
    setPaymentForm,
    submitPayment,
    logs,
    fmt,
    currency,
    fmtMoney,
    logReservationChange: logAction,
    isAdmin,
    printCheckInForm,
    printCheckOutBill,
  };
}
