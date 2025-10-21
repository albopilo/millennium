// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  onSnapshot,
  runTransaction,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import DOMPurify from "dompurify";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

const DEFAULT_COMPANY = {
  companyName: "MILLENNIUM INN",
  companyAddress: "Jl. Example No. 1, City",
  companyVatNumber: "",
  companyPhone: "",
};

/**
 * ReservationDetailA (Enhanced)
 * ----------------------------------------
 * + Modular Firestore loading
 * + Real-time logs/postings/payments
 * + DOMPurify-safe print templates
 * + Atomic transactions (no async inside)
 * + Visual skeletons and inline feedback
 * + Improved readability and UX comfort
 */

export default function ReservationDetailA({ currentUser = null, permissions = [] }) {
  const { id } = useParams();
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [stays, setStays] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({ currency: "IDR" });
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);

  const actorName =
    currentUser?.displayName || currentUser?.name || "system";

  /** ============ UTILITIES ============ **/
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID");

  const showMessage = (text, type = "info") => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  };

  /** ============ LOADERS ============ **/
  const loadReservation = useCallback(async () => {
    const snap = await getDoc(doc(db, "reservations", id));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }, [id]);

  const loadGuest = useCallback(async (guestId) => {
    if (!guestId) return null;
    const snap = await getDoc(doc(db, "guests", guestId));
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  }, []);

  const loadSettings = useCallback(async () => {
    const settingsSnap = await getDoc(doc(db, "settings", "general"));
    const templatesSnap = await getDoc(doc(db, "settings", "printTemplates"));
    setSettings({
      ...DEFAULT_COMPANY,
      ...settingsSnap.data(),
      currency: settingsSnap.data()?.currency || "IDR",
    });
    setTemplates(templatesSnap.data() || {});
  }, []);

  const setupRealtime = useCallback(() => {
    // logs
    const logsRef = collection(doc(db, "reservations", id), "logs");
    const unsubLogs = onSnapshot(query(logsRef, orderBy("createdAt", "desc")), (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    // postings
    const postingsRef = collection(db, "postings");
    const unsubPostings = onSnapshot(query(postingsRef, where("reservationId", "==", id)), (snap) => {
      setPostings(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    // payments
    const paymentsRef = collection(db, "payments");
    const unsubPayments = onSnapshot(query(paymentsRef, where("reservationId", "==", id)), (snap) => {
      setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubLogs();
      unsubPostings();
      unsubPayments();
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        const res = await loadReservation();
        if (!res) {
          showMessage("Reservation not found.", "error");
          setReservation(null);
          return;
        }
        setReservation(res);
        setGuest(await loadGuest(res.guestId));
        await loadSettings();
        const staysSnap = await getDocs(query(collection(db, "stays"), where("reservationId", "==", id)));
        setStays(staysSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        console.error(err);
        showMessage("Failed to load reservation data.", "error");
      } finally {
        setLoading(false);
      }
    })();

    const unsub = setupRealtime();
    return () => unsub?.();
  }, [id, loadReservation, loadGuest, loadSettings, setupRealtime]);

  /** ============ COMPUTED ============ **/
  const visiblePostings = useMemo(
    () => postings.filter((p) => (p.status || "").toLowerCase() !== "void"),
    [postings]
  );
  const chargesTotal = visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = chargesTotal - paymentsTotal;
  const status = (reservation?.status || "").toLowerCase();

  /** ============ PRINT ============ **/
  const sanitize = (html) => DOMPurify.sanitize(html || "");
  const replaceTokens = (html, data) =>
    html.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => data[key.trim()] ?? "");

  const openPrintWindow = (html) => {
    const w = window.open("", "_blank");
    w.document.write(`<html><body>${html}</body></html>`);
    w.document.close();
  };

  const printTemplate = (type) => {
    const tpl = templates?.[type] || {};
    const data = {
      ...DEFAULT_COMPANY,
      ...settings,
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestPhone: guest?.phone || "-",
      guestAddress: guest?.address || "-",
      roomNumber:
        Array.isArray(reservation?.roomNumbers)
          ? reservation.roomNumbers.join(", ")
          : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate
        ? new Date(reservation.checkInDate).toLocaleString()
        : "-",
      checkOutDate: reservation?.checkOutDate
        ? new Date(reservation.checkOutDate).toLocaleString()
        : "-",
      balance: fmtMoney(balance),
    };

    const header = sanitize(replaceTokens(tpl.header || "<h2>{{companyName}}</h2>", data));
    const body = sanitize(replaceTokens(tpl.body || "<p>{{guestName}}</p>", data));
    const footer = sanitize(replaceTokens(tpl.footer || "", data));
    openPrintWindow(`${header}<hr/>${body}<hr/>${footer}`);
  };

  /** ============ HANDLERS ============ **/
  const doCheckIn = async () => {
    if (!reservation) return showMessage("Reservation not loaded", "error");
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "reservations", reservation.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if ((r.status || "").toLowerCase() !== "booked")
          throw new Error("Only booked reservations can be checked in");
        tx.update(ref, {
          status: "checked-in",
          checkInDate: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      });
      showMessage("Checked in successfully", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  };

  const doCheckOut = async () => {
    if (!reservation) return showMessage("Reservation not loaded", "error");
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "reservations", reservation.id);
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if ((r.status || "").toLowerCase() !== "checked-in")
          throw new Error("Only checked-in reservations can be checked out");
        tx.update(ref, {
          status: "checked-out",
          checkOutDate: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      });
      showMessage("Checked out successfully", "success");
    } catch (err) {
      showMessage(err.message, "error");
    }
  };

  /** ============ RENDER ============ **/
  if (loading) return <div className="p-6 text-gray-500">Loading reservation...</div>;
  if (!reservation) return <div className="p-6 text-gray-500">Reservation not found.</div>;

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="page-title">Reservation — {reservation.id}</h1>

      {message && (
        <div className={`toast toast-${message.type}`}>{message.text}</div>
      )}

      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        stays={stays}
        settings={settings}
        canOperate={permissions.includes("canOperateFrontDesk") || permissions.includes("*")}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        printCheckInForm={() => status !== "checked-out" && printTemplate("checkInTemplate")}
        printCheckOutBill={() => status === "checked-out" && printTemplate("checkOutTemplate")}
        balance={balance}
      />

      <ReservationDetailC
        reservation={reservation}
        postings={postings}
        payments={payments}
        currency={settings.currency}
        fmtMoney={fmtMoney}
      />

      <div className="log-card">
        <h3>Logs</h3>
        <div className="log-list">
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
    </div>
  );
}
