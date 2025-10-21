// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useState } from "react";
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
  orderBy,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebase";
import { fmt } from "../lib/dates";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName = currentUser?.displayName || currentUser?.email || "frontdesk";
  const isAdmin = userData?.roleId === "admin";

  // --- State ---
  const [loading, setLoading] = useState(true);
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [guest, setGuest] = useState(null);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [logs, setLogs] = useState([]);
  const [assignRooms, setAssignRooms] = useState([]);

  // Add / payment modals
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);

  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "" });

  const can = (p) => Array.isArray(permissions) && (permissions.includes(p) || permissions.includes("*"));
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");

  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  // --- Data loading ---
  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const [resSnap, roomsSnap, settingsSnap] = await Promise.all([
        getDoc(doc(db, "reservations", id)),
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
      ]);

      if (!resSnap.exists()) {
        navigate("/calendar");
        return;
      }

      const r = { id: resSnap.id, ...resSnap.data() };
      setReservation(r);
      setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());

      // Load guest if any
      if (r.guestId) {
        const gSnap = await getDoc(doc(db, "guests", r.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      }

      // Load related collections
      const [pSnap, paySnap, sSnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "stays"), where("reservationId", "==", id))),
      ]);
      setPostings(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setStays(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setAssignRooms(Array.isArray(r.roomNumbers) ? [...r.roomNumbers] : []);
    } catch (err) {
      console.error("loadAll error:", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, [id]);

  // Live logs subscription
  useEffect(() => {
    if (!id) return;
    const q = query(collection(doc(db, "reservations", id), "logs"), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [id]);

  // --- Helpers ---
  const onlyDigits = (s) => (s || "").replace(/[^\d.-]/g, "");

  async function logAction(action, payload = {}) {
    try {
      await addDoc(collection(db, "reservation_logs"), {
        reservationId: reservation?.id,
        action,
        payload,
        by: actorName,
        createdAt: new Date(),
      });
    } catch (err) {
      console.error("logAction error:", err);
    }
  }

  // --- Print forms ---
  const printCheckInForm = () => {
    const html = `
      <h2>Check-In Form</h2>
      <p>Guest: ${reservation.guestName}</p>
      <p>Stay: ${fmt(reservation.checkInDate)} → ${fmt(reservation.checkOutDate)}</p>
      <p>Rooms: ${(reservation.roomNumbers || []).join(", ")}</p>
      <p>Handled by: ${actorName}</p>
    `;
    const w = window.open("", "_blank");
    w.document.write(`<html><body>${html}</body></html>`);
    w.print();
    w.close();
  };

  const printCheckOutBill = () => {
    const html = `
      <h2>Check-Out Bill</h2>
      <p>Guest: ${reservation.guestName}</p>
      <p>Charges: ${settings.currency} ${fmtMoney(totalCharges)}</p>
      <p>Payments: ${settings.currency} ${fmtMoney(totalPayments)}</p>
      <p>Balance: ${settings.currency} ${fmtMoney(balance)}</p>
      <p>Handled by: ${actorName}</p>
    `;
    const w = window.open("", "_blank");
    w.document.write(`<html><body>${html}</body></html>`);
    w.print();
    w.close();
  };

  // --- Derived totals ---
  const visiblePostings = useMemo(
    () => postings.filter((p) => (p.status || "").toLowerCase() !== "void"),
    [postings]
  );
  const charges = visiblePostings.filter((p) => (p.accountCode || "").toUpperCase() !== "PAY");
  const totalCharges = charges.reduce((s, p) => s + Number(p.amount || 0), 0);
  const totalPayments = payments
    .filter((p) => (p.status || "").toLowerCase() !== "void")
    .reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = totalCharges - totalPayments;

  if (loading) return <div className="p-6 text-center">Loading reservation…</div>;
  if (!reservation) return <div className="p-6 text-center text-gray-600">Reservation not found.</div>;

  const childProps = {
    reservation,
    guest,
    settings,
    rooms,
    stays,
    assignRooms,
    setAssignRooms,
    showAddCharge,
    setShowAddCharge,
    showAddPayment,
    setShowAddPayment,
    chargeForm,
    setChargeForm,
    paymentForm,
    setPaymentForm,
    fmtMoney,
    currency: settings.currency,
    logAction,
    canOperate,
    printCheckInForm,
    printCheckOutBill,
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Reservation Detail</h2>

      <ReservationDetailB {...childProps}>
        <ReservationDetailC
          reservation={reservation}
          displayChargeLines={charges}
          displayChargesTotal={totalCharges}
          displayPaymentsTotal={totalPayments}
          displayBalance={balance}
          currency={settings.currency}
          fmtMoney={fmtMoney}
        />
      </ReservationDetailB>
    </div>
  );
}
