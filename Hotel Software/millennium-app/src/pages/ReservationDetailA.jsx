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
  onSnapshot,
  orderBy,
} from "firebase/firestore";
import { db } from "../firebase";
import { fmt } from "../lib/dates";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

export default function ReservationDetailA({
  permissions = [],
  currentUser = null,
  userData = null,
}) {
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
  const [assignRooms, setAssignRooms] = useState([]);
  const [logs, setLogs] = useState([]);

  const can = (perm) =>
    Array.isArray(permissions) &&
    (permissions.includes(perm) || permissions.includes("*"));
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canManage = can("canEditReservations") || can("canManageReservations");

  const currency = settings.currency || "IDR";
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  // 🔹 Load reservation + related data
  async function loadAll() {
    if (!id) return;
    setLoading(true);
    try {
      const resSnap = await getDoc(doc(db, "reservations", id));
      if (!resSnap.exists()) {
        navigate("/calendar");
        return;
      }
      const r = { id: resSnap.id, ...resSnap.data() };
      setReservation(r);

      const [roomsSnap, settingsSnap] = await Promise.all([
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
      ]);
      setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());

      if (r.guestId) {
        const gSnap = await getDoc(doc(db, "guests", r.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      }

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

  useEffect(() => {
    loadAll();
  }, [id]);

  // 🔹 Subscribe to logs
  useEffect(() => {
    if (!id) return;
    const qRef = query(
      collection(doc(db, "reservations", id), "logs"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(qRef, (snap) =>
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return () => unsub();
  }, [id]);

  // 🔹 Action logging
  async function logAction(action, payload = {}) {
    const entry = {
      reservationId: reservation?.id || id,
      action,
      by: actorName,
      payload,
      createdAt: new Date(),
    };
    try {
      await addDoc(collection(db, "reservation_logs"), entry);
    } catch {}
    try {
      if (reservation?.id) {
        await addDoc(collection(doc(db, "reservations", reservation.id), "logs"), entry);
      }
    } catch {}
  }

  // 🧾 PRINT TEMPLATES (clean version)
  async function handlePrint(templateType) {
    try {
      const snap = await getDoc(doc(db, "settings", "printTemplates"));
      if (!snap.exists()) {
        alert("No print templates configured in Admin Settings.");
        return;
      }

      const tpl =
        templateType === "checkin"
          ? snap.data()?.checkInTemplate
          : snap.data()?.checkOutTemplate;

      if (!tpl) {
        alert(`No ${templateType} template found.`);
        return;
      }

      let htmlBody = tpl.body || "";
      htmlBody = htmlBody
        .replace(/{{guestName}}/g, reservation.guestName || "-")
        .replace(/{{roomNumber}}/g, (reservation.roomNumbers || []).join(", ") || "-")
        .replace(/{{checkInDate}}/g, fmt(reservation.checkInDate))
        .replace(/{{checkOutDate}}/g, fmt(reservation.checkOutDate))
        .replace(/{{balance}}/g, fmtMoney(displayBalance))
        .replace(/{{staffName}}/g, actorName);

      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <div style="text-align:center; font-size:18px; font-weight:bold;">
            ${tpl.header || ""}
          </div>
          <hr/>
          <div style="margin: 12px 0; font-size:14px;">${htmlBody}</div>
          <hr/>
          <div style="text-align:center; font-size:12px;">${tpl.footer || ""}</div>
        </div>
      `;

      const w = window.open("", "_blank");
      w.document.write(html);
      w.print();
      w.close();
    } catch (err) {
      console.error("Print error:", err);
      alert("Failed to print form.");
    }
  }

  // Memoized folio
  const visiblePostings = useMemo(
    () => (postings || []).filter((p) => (p.status || "").toLowerCase() !== "void"),
    [postings]
  );
  const displayChargeLines = visiblePostings.filter(
    (p) => (p.accountCode || "").toUpperCase() !== "PAY"
  );
  const displayChargesTotal = displayChargeLines.reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  );
  const displayPaymentsTotal = payments.reduce(
    (s, p) => s + Number(p.amount || 0),
    0
  );
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  if (loading)
    return <div className="p-6 text-center">Loading reservation…</div>;
  if (!reservation)
    return (
      <div className="p-6 text-center text-gray-600">
        Reservation not found.
      </div>
    );

  const childProps = {
    reservation,
    guest,
    settings,
    rooms,
    stays,
    assignRooms,
    setAssignRooms,
    canOperate,
    logReservationChange: logAction,
    fmt,
    currency,
    fmtMoney,
    isAdmin,
    printCheckInForm: () => handlePrint("checkin"),
    printCheckOutBill: () => handlePrint("checkout"),
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-800">Reservation Detail</h2>

      <ReservationDetailB {...childProps}>
        <ReservationDetailC
          reservation={reservation}
          displayChargeLines={displayChargeLines}
          displayChargesTotal={displayChargesTotal}
          displayPaymentsTotal={displayPaymentsTotal}
          displayBalance={displayBalance}
          currency={currency}
          fmtMoney={fmtMoney}
        />
      </ReservationDetailB>
    </div>
  );
}
