// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  onSnapshot,
  orderBy,
  runTransaction,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailA
 * - Loads reservation, guest, postings, payments, stays, settings, templates.
 * - Implements: doCheckIn, doCheckOut, changeRoom, upgradeRoom (transactional).
 * - Implements submitCharge/submitPayment (no debounce).
 * - Print functions link to admin print templates (with extra placeholders injected).
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
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [stays, setStays] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState({ currency: "IDR" });
  const [templates, setTemplates] = useState({});
  const [loading, setLoading] = useState(true);
  const actorName = (currentUser && (currentUser.displayName || currentUser.name)) || "system";

  // Helper: format money
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  // --- load reservation and related data
  const loadAll = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const resSnap = await getDoc(doc(db, "reservations", id));
      if (!resSnap.exists()) {
        setReservation(null);
        setLoading(false);
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

      // settings + templates
      const settingsSnap = await getDoc(doc(db, "settings", "general"));
      const templatesSnap = await getDoc(doc(db, "settings", "printTemplates"));
      setSettings({ ...settingsSnap.data(), currency: (settingsSnap.data() && settingsSnap.data().currency) || "IDR" });
      setTemplates(templatesSnap.exists() ? templatesSnap.data() : {});

      // postings/payments/stays
      const [pSnap, paySnap, staysSnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "stays"), where("reservationId", "==", id))),
      ]);
      setPostings(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setStays(staysSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (err) {
      console.error("loadAll error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // live logs subscription under reservations/{id}/logs
  useEffect(() => {
    if (!id) return;
    const logsRef = collection(doc(db, "reservations", id), "logs");
    const q = query(logsRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [id]);

  // Derived values
  const visiblePostings = useMemo(
    () => postings.filter((p) => ((p.status || "") + "").toLowerCase() !== "void"),
    [postings]
  );
  const chargesTotal = visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0);
  const paymentsTotal = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
  const balance = chargesTotal - paymentsTotal;

  // Utility: write audit log
  const writeLog = async (action, before = {}, after = {}, meta = {}) => {
    try {
      const logsRef = collection(doc(db, "reservations", id), "logs");
      await addDoc(logsRef, {
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

  // Utility: replace placeholders in templates
  const replacePlaceholders = (html = "", data = {}) => {
    if (!html) return "";
    return html.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
      const k = key.trim();
      return data[k] !== undefined && data[k] !== null ? String(data[k]) : "";
    });
  };

  // Print open popup
  const openPrintWindow = (html) => {
    const w = window.open("", "_blank", "width=900,height=800");
    if (!w) {
      alert("Pop-up blocked. Please allow pop-ups for printing.");
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
      <body>${html}</body></html>
    `);
    w.document.close();
    w.focus();
  };

  // Print functions linked to templates and augmented placeholders
  const printCheckInForm = () => {
    const tpl = templates?.checkInTemplate || {};
    const data = {
      guestName: guest?.fullName || guest?.name || reservation?.guestName || "-",
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

    const header = replacePlaceholders(tpl.header || "<h2>{{companyName}}</h2>", data);
    const body = replacePlaceholders(tpl.body || "<p>Check-in for {{guestName}} in {{roomNumber}}</p>", data);
    const footer = replacePlaceholders(tpl.footer || "<div>{{signatureLine}}</div>", data);
    openPrintWindow(`<div style="text-align:center">${header}</div><hr/>${body}<hr/>${footer}`);
  };

  const printCheckOutBill = () => {
    const tpl = templates?.checkOutTemplate || {};
    const data = {
      guestName: guest?.fullName || guest?.name || reservation?.guestName || "-",
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

    // build folio table
    const itemsHtml = visiblePostings.length
      ? `<table>
          <thead><tr><th>Description</th><th style="text-align:right">Amount (${settings.currency || "IDR"})</th></tr></thead>
          <tbody>
            ${visiblePostings
              .map(
                (p) =>
                  `<tr><td>${p.description || p.accountCode || "-"}</td><td style="text-align:right">${fmtMoney(Number(p.amount || 0))}</td></tr>`
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr><th>Total</th><th style="text-align:right">${fmtMoney(chargesTotal)}</th></tr>
            <tr><th>Payments</th><th style="text-align:right">-${fmtMoney(paymentsTotal)}</th></tr>
            <tr><th>Balance</th><th style="text-align:right">${fmtMoney(balance)}</th></tr>
          </tfoot>
        </table>`
      : "<p>No charges</p>";

    const header = replacePlaceholders(tpl.header || "<h2>{{companyName}}</h2>", data);
    const body = replacePlaceholders(tpl.body || "<p>Bill for {{guestName}} ({{roomNumber}})</p>", data);
    const footer = replacePlaceholders(tpl.footer || "<div>{{signatureLine}}</div>", data);

    openPrintWindow(`<div style="text-align:center">${header}</div><hr/>${body}${itemsHtml}<hr/>${footer}`);
  };

  // -----------------------------
  // Core handlers (transactional)
  // -----------------------------

  // doCheckIn: transition booked -> checked-in. Create stays for each room.
  const doCheckIn = async (opts = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", reservation.id);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reservationRef);
      if (!snap.exists()) throw new Error("Reservation not found");
      const r = snap.data();
      if ((r.status || "").toLowerCase() !== "booked") {
        throw new Error("Only 'booked' reservations can be checked-in");
      }

      const now = new Date();
      tx.update(reservationRef, {
        status: "checked-in",
        checkInDate: now.toISOString(),
        updatedAt: serverTimestamp(),
      });

      // create stays: one stay per room
      const roomNumbers = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? r.roomNumbers : r.roomNumber ? [r.roomNumber] : [];
      for (const rn of roomNumbers) {
        const staysRef = collection(reservationRef, "stays");
        await addDoc(staysRef, {
          roomNumber: rn,
          status: "open",
          checkInAt: now.toISOString(),
          createdBy: actorName,
        });
      }

      // add audit log
      const before = { status: r.status || "" };
      const after = { status: "checked-in", checkInDate: now.toISOString() };
      const logsRef = collection(reservationRef, "logs");
      await addDoc(logsRef, {
        action: "check-in",
        by: actorName,
        before,
        after,
        meta: opts.meta || null,
        createdAt: serverTimestamp(),
      });
    });

    // reload
    await loadAll();
  };

  // doCheckOut: transition checked-in -> checked-out. Close stays. Optionally auto post room charges.
  const doCheckOut = async ({ autoPost = true } = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", reservation.id);

    // read config for auto posting from settings (allow override param)
    const autoPostFromSettings = settings.autoPostRoomChargeOnCheckout === true;
    const shouldAutoPost = autoPostFromSettings || autoPost;

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reservationRef);
      if (!snap.exists()) throw new Error("Reservation not found");
      const r = snap.data();
      if ((r.status || "").toLowerCase() !== "checked-in") {
        throw new Error("Only 'checked-in' reservations can be checked-out");
      }

      const now = new Date();

      // close all open stays for this reservation
      const staysRef = collection(reservationRef, "stays");
      const staysSnap = await getDocs(query(staysRef));
      const openStays = staysSnap.docs.filter((d) => (d.data().status || "").toLowerCase() === "open");

      for (const stDoc of openStays) {
        const stRef = doc(reservationRef, "stays", stDoc.id);
        tx.update(stRef, {
          status: "closed",
          checkOutAt: now.toISOString(),
          updatedAt: serverTimestamp(),
        });
      }

      // optionally auto-post pending room charges: if posting for days missing
      if (shouldAutoPost) {
        // create a posting per open stay for outstanding nights — simple version: post a single checkout room charge if not already
        // This is conservative: add a single "Room (Checkout Adjustment)" posting indicating checkout day charge
        const postingsRefGlobal = collection(db, "postings");
        await addDoc(postingsRefGlobal, {
          reservationId: reservation.id,
          accountCode: "ROOM",
          description: "Room Charge (checkout adjustment)",
          amount: 0, // set 0 by default — staff may adjust later; alternative: compute from room rate if available
          status: "posted",
          createdAt: serverTimestamp(),
          createdBy: actorName,
        });
      }

      // update reservation
      tx.update(reservationRef, {
        status: "checked-out",
        checkOutDate: now.toISOString(),
        updatedAt: serverTimestamp(),
      });

      // add audit log
      const before = { status: r.status || "" };
      const after = { status: "checked-out", checkOutDate: now.toISOString() };
      const logsRef = collection(reservationRef, "logs");
      await addDoc(logsRef, {
        action: "check-out",
        by: actorName,
        before,
        after,
        meta: { autoPostApplied: shouldAutoPost },
        createdAt: serverTimestamp(),
      });
    });

    await loadAll();
  };

  // changeRoom: update reservation.roomNumbers and active stays to new room numbers
  const changeRoom = async ({ fromRoom, toRoom, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", reservation.id);
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reservationRef);
      if (!snap.exists()) throw new Error("Reservation not found");
      const r = snap.data();

      // compute new roomNumbers array
      const currentRooms = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? [...r.roomNumbers] : r.roomNumber ? [r.roomNumber] : [];
      const idx = currentRooms.indexOf(fromRoom);
      if (idx === -1) {
        throw new Error("From-room not found in current assignment");
      }
      currentRooms[idx] = toRoom;

      tx.update(reservationRef, {
        roomNumbers: currentRooms,
        updatedAt: serverTimestamp(),
      });

      // update stays: find open stay with fromRoom and update its roomNumber
      const staysRef = collection(reservationRef, "stays");
      const staysSnap = await getDocs(query(staysRef));
      const openStays = staysSnap.docs.filter((d) => (d.data().status || "").toLowerCase() === "open" && d.data().roomNumber === fromRoom);
      for (const stDoc of openStays) {
        const stRef = doc(reservationRef, "stays", stDoc.id);
        tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
      }

      // write audit log
      const logsRef = collection(reservationRef, "logs");
      await addDoc(logsRef, {
        action: "room-change",
        by: actorName,
        before: { roomNumbers: r.roomNumbers || [] },
        after: { roomNumbers: currentRooms },
        meta: { fromRoom, toRoom, note },
        createdAt: serverTimestamp(),
      });
    });

    await loadAll();
  };

  // upgradeRoom: similar to changeRoom + optional posting for difference
  const upgradeRoom = async ({ fromRoom, toRoom, upgradeCharge = 0, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", reservation.id);

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(reservationRef);
      if (!snap.exists()) throw new Error("Reservation not found");
      const r = snap.data();

      // update reservation rooms (same as changeRoom)
      const currentRooms = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? [...r.roomNumbers] : r.roomNumber ? [r.roomNumber] : [];
      const idx = currentRooms.indexOf(fromRoom);
      if (idx === -1) throw new Error("From-room not found");
      currentRooms[idx] = toRoom;
      tx.update(reservationRef, { roomNumbers: currentRooms, updatedAt: serverTimestamp() });

      // close/rename stays
      const staysRef = collection(reservationRef, "stays");
      const staysSnap = await getDocs(query(staysRef));
      const openStays = staysSnap.docs.filter((d) => (d.data().status || "").toLowerCase() === "open" && d.data().roomNumber === fromRoom);
      for (const stDoc of openStays) {
        const stRef = doc(reservationRef, "stays", stDoc.id);
        tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
      }

      // if upgradeCharge > 0 then create posting (global postings collection)
      if (Number(upgradeCharge) > 0) {
        const postingsRef = collection(db, "postings");
        await addDoc(postingsRef, {
          reservationId: reservation.id,
          accountCode: "UPGRADE",
          description: `Room upgrade ${fromRoom} → ${toRoom} ${note ? `(${note})` : ""}`,
          amount: Number(upgradeCharge),
          status: "posted",
          createdAt: serverTimestamp(),
          createdBy: actorName,
        });
      }

      // log
      const logsRef = collection(reservationRef, "logs");
      await addDoc(logsRef, {
        action: "room-upgrade",
        by: actorName,
        before: { roomNumbers: r.roomNumbers || [] },
        after: { roomNumbers: currentRooms },
        meta: { fromRoom, toRoom, upgradeCharge, note },
        createdAt: serverTimestamp(),
      });
    });

    await loadAll();
  };

  // submitCharge / submitPayment (no debounce; parse at submit)
  const submitCharge = async ({ description, qtyStr, unitStr, accountCode = "MISC" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const qty = parseFloat(qtyStr) || 0;
    const unit = parseFloat(unitStr) || 0;
    const total = qty * unit;
    if (!description || !description.trim()) throw new Error("Description required");
    if (total <= 0) throw new Error("Charge amount must be > 0");

    await addDoc(collection(db, "postings"), {
      reservationId: reservation.id,
      description: description.trim(),
      accountCode: accountCode.toUpperCase(),
      quantity: qty,
      unitAmount: unit,
      amount: total,
      status: "posted",
      createdAt: serverTimestamp(),
      createdBy: actorName,
    });

    await writeLog("add-charge", {}, {}, { description, qty, unit, total });
    await loadAll();
  };

  const submitPayment = async ({ amountStr, method = "cash", refNo = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const amt = parseFloat(amountStr) || 0;
    if (amt <= 0) throw new Error("Payment must be > 0");

    await addDoc(collection(db, "payments"), {
      reservationId: reservation.id,
      amount: amt,
      method,
      refNo,
      capturedAt: serverTimestamp(),
      capturedBy: actorName,
    });

    await writeLog("add-payment", {}, {}, { amount: amt, method, refNo });
    await loadAll();
  };

  // UI guard
  if (loading) return <div className="p-6">Loading reservation…</div>;
  if (!reservation) return <div className="p-6 text-gray-600">Reservation not found.</div>;

  // helper to determine print button visibility per your rule:
  // - hide print checkout when status is still checked-in
  // - hide print checkin when status is checked-out
  const statusLower = (reservation.status || "").toLowerCase();

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="page-title">Reservation — {reservation.id}</h1>

      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        stays={stays}
        settings={settings}
        canOperate={permissions.includes("canOperateFrontDesk") || permissions.includes("*")}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        changeRoom={changeRoom}
        upgradeRoom={upgradeRoom}
        printCheckInForm={() => {
          if (statusLower === "checked-out") return; // hidden
          printCheckInForm();
        }}
        printCheckOutBill={() => {
          if (statusLower === "checked-in") return; // hidden
          printCheckOutBill();
        }}
        balance={balance}
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
        <div className="log-list">
          {logs.map((l) => (
            <div key={l.id} className="log-entry">
              <div className="log-action">{(l.action || "unknown").toUpperCase()}</div>
              <div className="log-meta">
                by {l.by} • {l.createdAt?.seconds ? new Date(l.createdAt.seconds * 1000).toLocaleString() : "—"}
              </div>
              <div className="log-detail muted">
                {l.meta ? JSON.stringify(l.meta) : ""}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
