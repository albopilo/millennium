// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";
import DOMPurify from "dompurify";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailA (Complete rewrite)
 * - Phase 1 + Phase 2 combined:
 *   - Data normalization, date handling, rate/deposit calculation
 *   - Real-time snapshots (no composite-index orderBy)
 *   - Transactional operations (check-in/out/change/upgrade)
 *   - submitCharge / submitPayment (no debounce)
 *   - Print templates wired to settings/printTemplates and sanitized
 */

const DEFAULT_COMPANY = {
  companyName: "MILLENNIUM INN",
  companyAddress: "Jl. Example No. 1, City",
  companyVatNumber: "",
  companyPhone: "",
};

function toDateSafe(v) {
  if (!v) return null;
  // Firestore Timestamp -> Date
  if (typeof v.toDate === "function") return v.toDate();
  // ISO string or number
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

export default function ReservationDetailA({ currentUser = null, permissions = [] }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const actorName = currentUser?.displayName || currentUser?.name || currentUser?.email || "frontdesk";
  const can = (p) => permissions.includes("*") || permissions.includes(p);

  // Core entities
  const [reservation, setReservation] = useState(null);
  const [guest, setGuest] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [settings, setSettings] = useState({});
  const [templates, setTemplates] = useState({});

  // Real-time lists
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [stays, setStays] = useState([]);
  const [logs, setLogs] = useState([]);

  // UI state
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  // Modal/form state for passing down to C
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC", roomNumber: "" });
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "" });

  // Formatters
  const fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 }));
  const fmtDate = (d) => (d ? d.toLocaleString() : "-");
  const showToast = (text, type = "info") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ------------------------------
  // Load: reservation, guest, static references, templates
  // Also subscribe to postings/payments/stays/logs using where(...) only (no orderBy)
  // ------------------------------
  useEffect(() => {
    if (!id) return;

    setLoading(true);
    let unsubPostings = null;
    let unsubPayments = null;
    let unsubStays = null;
    let unsubLogs = null;

    const init = async () => {
      try {
        // reservation
        const resSnap = await getDoc(doc(db, "reservations", id));
        if (!resSnap.exists()) {
          showToast("Reservation not found", "error");
          navigate("/calendar", { replace: true });
          return;
        }
        const resDataRaw = resSnap.data();
        // Normalize date fields to Date objects
        const res = {
          id: resSnap.id,
          ...resDataRaw,
          checkInDate: toDateSafe(resDataRaw.checkInDate),
          checkOutDate: toDateSafe(resDataRaw.checkOutDate),
          createdAt: toDateSafe(resDataRaw.createdAt),
          updatedAt: toDateSafe(resDataRaw.updatedAt),
        };
        setReservation(res);

        // guest (single fetch)
        if (res.guestId) {
          const gSnap = await getDoc(doc(db, "guests", res.guestId));
          setGuest(gSnap.exists() ? { id: gSnap.id, ...gSnap.data() } : null);
        } else {
          setGuest(null);
        }

        // static lists
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

        // realtime listeners:
        // For postings / payments we avoid orderBy in query to prevent composite-index requirement.
        unsubPostings = onSnapshot(
          query(collection(db, "postings"), where("reservationId", "==", id)),
          (snap) => {
            const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            // client-side sort by createdAt if present
            arr.sort((a, b) => {
              const ta = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : a.createdAt ? new Date(a.createdAt).getTime() : 0;
              const tb = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : b.createdAt ? new Date(b.createdAt).getTime() : 0;
              return ta - tb;
            });
            setPostings(arr);
          },
          (err) => {
            console.error("postings snapshot error", err);
            showToast("Postings snapshot error. Check console.", "error");
          }
        );

        unsubPayments = onSnapshot(
          query(collection(db, "payments"), where("reservationId", "==", id)),
          (snap) => {
            const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
            arr.sort((a, b) => {
              const ta = a.capturedAt?.seconds ? a.capturedAt.seconds * 1000 : a.capturedAt ? new Date(a.capturedAt).getTime() : 0;
              const tb = b.capturedAt?.seconds ? b.capturedAt.seconds * 1000 : b.capturedAt ? new Date(b.capturedAt).getTime() : 0;
              return ta - tb;
            });
            setPayments(arr);
          },
          (err) => {
            console.error("payments snapshot error", err);
            showToast("Payments snapshot error. Check console.", "error");
          }
        );

        unsubStays = onSnapshot(
          collection(doc(db, "reservations", id), "stays"),
          (snap) => setStays(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => {
            console.error("stays snapshot error", err);
            showToast("Stays snapshot error. Check console.", "error");
          }
        );

        unsubLogs = onSnapshot(
          query(collection(doc(db, "reservations", id), "logs")),
          (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
          (err) => {
            console.error("logs snapshot error", err);
            showToast("Logs snapshot error. Check console.", "error");
          }
        );
      } catch (err) {
        console.error("Reservation load error", err);
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
  }, [id, navigate]);

  // ------------------------------
  // Derived financials (single source)
  // ------------------------------
  const visiblePostings = useMemo(() => postings.filter((p) => (((p.status || "") + "").toLowerCase() !== "void")), [postings]);

  const chargesTotalPosted = useMemo(() => visiblePostings.reduce((s, p) => s + Number(p.amount || 0), 0), [visiblePostings]);
  const paymentsTotal = useMemo(() => payments.reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);

  // Compute nights between checkInDate and checkOutDate (min 1)
  const nights = useMemo(() => {
    if (!reservation) return 0;
    const inD = reservation.checkInDate ? new Date(reservation.checkInDate) : null;
    const outD = reservation.checkOutDate ? new Date(reservation.checkOutDate) : null;
    if (!inD || !outD) return 0;
    const diff = Math.max(0, outD - inD);
    const n = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return n <= 0 ? 1 : n;
  }, [reservation]);

  // Determine per-room rate: preference order:
  // 1) reservation.roomRate (explicit)
  // 2) if reservation.rateCode -> find rates collection
  // 3) settings.defaultRoomRate
  const roomRatePerNight = useMemo(() => {
    if (!reservation) return 0;
    if (reservation.roomRate) return Number(reservation.roomRate);
    if (reservation.rateCode) {
      const r = rates.find((x) => x.code === reservation.rateCode || x.id === reservation.rateCode);
      if (r) return Number(r.amount || r.rate || 0);
    }
    return Number(settings.defaultRoomRate || 0);
  }, [reservation, rates, settings]);

  const roomsCount = useMemo(() => {
    if (!reservation) return 0;
    return Array.isArray(reservation.roomNumbers) ? reservation.roomNumbers.length : (reservation.roomNumber ? 1 : 0);
  }, [reservation]);

  const roomChargesComputed = useMemo(() => {
    // total for all rooms across nights (not posted; computed for display)
    return roomRatePerNight * nights * Math.max(1, roomsCount);
  }, [roomRatePerNight, nights, roomsCount]);

  // deposit per room (from settings)
  const depositPerRoom = Number(settings.depositPerRoom || 0);
  const depositTotal = depositPerRoom * Math.max(1, roomsCount);

  // final totals: include computed room charges and deposit in display (but postings may also include room postings)
  // Note: posted chargesTotalPosted already includes any posted room charges, we avoid double-counting by showing both posted and computed as separate lines (computed are displayed if there are no room postings).
  // For clarity we will compute displayCharges that include posted charges but also show computed room charges & deposit as separate lines if not already posted.
  const hasRoomPostings = visiblePostings.some((p) => (((p.accountCode || "") + "").toUpperCase() === "ROOM"));
  const displayChargesTotal = useMemo(() => {
    // base posted charges
    let total = chargesTotalPosted;
    // if there are no room postings, include computed roomCharges
    if (!hasRoomPostings && roomChargesComputed > 0) total += roomChargesComputed;
    // include deposit if not represented by postings with accountCode DEPOSIT
    const hasDepositPosted = visiblePostings.some((p) => (((p.accountCode || "") + "").toUpperCase() === "DEPOSIT"));
    if (!hasDepositPosted && depositTotal > 0) total += depositTotal;
    return total;
  }, [chargesTotalPosted, hasRoomPostings, roomChargesComputed, depositTotal, visiblePostings]);

  const balance = useMemo(() => displayChargesTotal - paymentsTotal, [displayChargesTotal, paymentsTotal]);

  // Room subtotals from posted data
  const roomSubtotals = useMemo(() => {
    const map = {};
    for (const p of visiblePostings) {
      const rn = p.roomNumber || "—";
      map[rn] = (map[rn] || 0) + Number(p.amount || 0);
    }
    return Object.keys(map).map((k) => ({ roomNo: k, subtotal: map[k] }));
  }, [visiblePostings]);

  // ------------------------------
  // Audit logger convenience
  // ------------------------------
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

  // ------------------------------
  // Actions
  // ------------------------------
  const doCheckIn = async (opts = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const reservationRef = doc(db, "reservations", id);

    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if (((r.status || "") + "").toLowerCase() !== "booked") {
          throw new Error("Only 'booked' reservations can be checked in");
        }
        const nowIso = new Date().toISOString();
        tx.update(reservationRef, {
          status: "checked-in",
          checkInDate: nowIso,
          updatedAt: serverTimestamp(),
        });

        // create stays docs (tx.set on new refs)
        const roomNumbers = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? r.roomNumbers : (r.roomNumber ? [r.roomNumber] : []);
        for (const rn of roomNumbers) {
          const staysColl = collection(reservationRef, "stays");
          const newRef = doc(staysColl);
          tx.set(newRef, {
            roomNumber: rn,
            status: "open",
            checkInAt: nowIso,
            createdBy: actorName,
            createdAt: serverTimestamp(),
          });
        }

        // log inside tx
        const logsColl = collection(reservationRef, "logs");
        const newLogRef = doc(logsColl);
        tx.set(newLogRef, {
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

  const doCheckOut = async ({ autoPost = true } = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");

    try {
      // Read stays outside tx to discover open stays (avoid async inside tx for collection queries)
      const staysColl = collection(doc(db, "reservations", id), "stays");
      const staysSnap = await getDocs(query(staysColl));
      const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open"));

      // Run transaction to update reservation and stays (tx.update on known refs)
      await runTransaction(db, async (tx) => {
        const reservationRef = doc(db, "reservations", id);
        const snap = await tx.get(reservationRef);
        if (!snap.exists()) throw new Error("Reservation not found");
        const r = snap.data();
        if (((r.status || "") + "").toLowerCase() !== "checked-in") throw new Error("Only checked-in reservations can be checked out");

        const nowIso = new Date().toISOString();

        // close open stays
        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, {
            status: "closed",
            checkOutAt: nowIso,
            updatedAt: serverTimestamp(),
          });
        }

        // optionally auto-post checkout room charge
        const shouldAutoPost = settings.autoPostRoomChargeOnCheckout === true || autoPost === true;
        if (shouldAutoPost) {
          const postingsColl = collection(db, "postings");
          const newPRef = doc(postingsColl);
          tx.set(newPRef, {
            reservationId: id,
            accountCode: "ROOM",
            description: "Room Charge (checkout adjustment)",
            amount: 0,
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
        const logsColl = collection(reservationRef, "logs");
        const newLogRef = doc(logsColl);
        tx.set(newLogRef, {
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

  const changeRoom = async ({ fromRoom, toRoom, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");

    try {
      // We'll fetch stays to find open stay doc IDs to update
      const reservationRef = doc(db, "reservations", id);
      const staysColl = collection(reservationRef, "stays");
      const staysSnap = await getDocs(query(staysColl));
      const snapData = (await getDoc(reservationRef)).data();

      const currentRooms = Array.isArray(snapData.roomNumbers) && snapData.roomNumbers.length ? [...snapData.roomNumbers] : (snapData.roomNumber ? [snapData.roomNumber] : []);
      const idx = currentRooms.indexOf(fromRoom);
      if (idx === -1) throw new Error("From-room not found in reservation assignment");
      currentRooms[idx] = toRoom;

      await runTransaction(db, async (tx) => {
        // update reservation rooms
        tx.update(reservationRef, { roomNumbers: currentRooms, updatedAt: serverTimestamp() });

        // update matching open stay docs
        const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open") && d.data().roomNumber === fromRoom);
        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
        }

        // log
        const logsColl = collection(reservationRef, "logs");
        const newLogRef = doc(logsColl);
        tx.set(newLogRef, {
          action: "change-room",
          by: actorName,
          before: { roomNumbers: snapData.roomNumbers || [] },
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

  const upgradeRoom = async ({ fromRoom, toRoom, upgradeCharge = 0, note = "" }) => {
    if (!reservation) throw new Error("Reservation not loaded");

    try {
      // get stays and reservation snapshot
      const reservationRef = doc(db, "reservations", id);
      const staysColl = collection(reservationRef, "stays");
      const staysSnap = await getDocs(query(staysColl));
      const snap = await getDoc(reservationRef);
      const r = snap.data();

      const currentRooms = Array.isArray(r.roomNumbers) && r.roomNumbers.length ? [...r.roomNumbers] : (r.roomNumber ? [r.roomNumber] : []);
      const idx = currentRooms.indexOf(fromRoom);
      if (idx === -1) throw new Error("From-room not found");
      currentRooms[idx] = toRoom;

      await runTransaction(db, async (tx) => {
        tx.update(reservationRef, { roomNumbers: currentRooms, updatedAt: serverTimestamp() });

        const openStays = staysSnap.docs.filter((d) => (((d.data().status || "") + "").toLowerCase() === "open") && d.data().roomNumber === fromRoom);
        for (const stDoc of openStays) {
          const stRef = doc(staysColl, stDoc.id);
          tx.update(stRef, { roomNumber: toRoom, updatedAt: serverTimestamp() });
        }

        if (Number(upgradeCharge) > 0) {
          const postingsColl = collection(db, "postings");
          const newPostingRef = doc(postingsColl);
          tx.set(newPostingRef, {
            reservationId: id,
            accountCode: "UPGRADE",
            description: `Room upgrade ${fromRoom} → ${toRoom}` + (note ? ` (${note})` : ""),
            amount: Number(upgradeCharge),
            status: "posted",
            createdAt: serverTimestamp(),
            createdBy: actorName,
          });
        }

        // log
        const logsColl = collection(reservationRef, "logs");
        const logRef = doc(logsColl);
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

  // ------------------------------
  // submitCharge & submitPayment (no debounce)
  // ------------------------------
  const submitCharge = async ({ description, qtyStr, unitStr, accountCode = "MISC", roomNumber = null } = {}) => {
    if (!reservation) throw new Error("Reservation not loaded");
    const qty = parseFloat(qtyStr) || 1;
    const unit = parseFloat(unitStr) || 0;
    const amount = qty * unit;
    if (!description || !description.trim()) throw new Error("Description required");
    if (amount <= 0) throw new Error("Charge amount must be > 0");

    try {
      await addDoc(collection(db, "postings"), {
        reservationId: id,
        accountCode: (accountCode || "MISC").toUpperCase(),
        description: description.trim(),
        quantity: qty,
        unitAmount: unit,
        amount,
        roomNumber: roomNumber || null,
        status: ((reservation.status || "") + "").toLowerCase() === "checked-in" ? "posted" : "forecast",
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

  const submitPayment = async ({ amountStr, method = "cash", refNo = "" } = {}) => {
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

  // ------------------------------
  // Print helpers (option A: kept inside this file)
  // ------------------------------
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
      <html><head><title>Print</title></head><body>${html}</body></html>
    `);
    w.document.close();
    w.focus();
  };

  const printCheckInForm = () => {
    const tpl = templates?.checkInTemplate || {
      header: "<h2>{{companyName}}</h2>",
      body: "<p>Check-in: {{guestName}} — {{roomNumber}}</p>",
      footer: "<div>{{signatureLine}}</div>",
    };

    const data = {
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestAddress: guest?.address || "",
      guestPhone: guest?.phone || "",
      roomNumber: Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate ? fmtDate(reservation.checkInDate) : fmtDate(new Date()),
      staffName: actorName,
      companyName: settings.companyName || DEFAULT_COMPANY.companyName,
      companyAddress: settings.companyAddress || DEFAULT_COMPANY.companyAddress,
      companyVatNumber: settings.companyVatNumber || DEFAULT_COMPANY.companyVatNumber,
      companyPhone: settings.companyPhone || DEFAULT_COMPANY.companyPhone,
      signatureLine: "<div style='margin-top:24px;'>Signature: __________________________</div>",
    };

    const header = replacePlaceholders(tpl.header || "", data);
    const body = replacePlaceholders(tpl.body || "", data);
    const footer = replacePlaceholders(tpl.footer || "", data);

    const sanitized = DOMPurify.sanitize(`<div style="text-align:center">${header}</div><hr/>${body}<hr/>${footer}`);
    openPrintWindow(sanitized);
  };

  const printCheckOutBill = () => {
    const tpl = templates?.checkOutTemplate || {
      header: "<h2>{{companyName}}</h2>",
      body: "<p>Bill for {{guestName}}</p>",
      footer: "<div>{{signatureLine}}</div>",
    };

    const data = {
      guestName: guest?.fullName || reservation?.guestName || "-",
      guestAddress: guest?.address || "",
      guestPhone: guest?.phone || "",
      roomNumber: Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation?.roomNumber || "-",
      checkInDate: reservation?.checkInDate ? fmtDate(reservation.checkInDate) : "-",
      checkOutDate: fmtDate(new Date()),
      balance: fmtMoney(balance),
      totalCharges: fmtMoney(displayChargesTotal),
      totalPayments: fmtMoney(paymentsTotal),
      staffName: actorName,
      companyName: settings.companyName || DEFAULT_COMPANY.companyName,
      companyAddress: settings.companyAddress || DEFAULT_COMPANY.companyAddress,
      companyVatNumber: settings.companyVatNumber || DEFAULT_COMPANY.companyVatNumber,
      companyPhone: settings.companyPhone || DEFAULT_COMPANY.companyPhone,
      signatureLine: "<div style='margin-top:16px;'>Guest Signature: __________________________</div>",
    };

    const header = replacePlaceholders(tpl.header || "", data);
    const body = replacePlaceholders(tpl.body || "", data);

    const itemsHtml = visiblePostings.length
      ? `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="border:1px solid #ddd;padding:6px;text-align:left">Description</th><th style="border:1px solid #ddd;padding:6px;text-align:right">Amount (${settings.currency || "IDR"})</th></tr></thead>
         <tbody>
         ${visiblePostings.map((p) => `<tr><td style="border:1px solid #ddd;padding:6px">${p.description || p.accountCode}</td><td style="border:1px solid #ddd;padding:6px;text-align:right">${fmtMoney(Number(p.amount || 0))}</td></tr>`).join("")}
         </tbody>
         <tfoot>
           <tr><th style="border:1px solid #ddd;padding:6px;text-align:left">Total</th><th style="border:1px solid #ddd;padding:6px;text-align:right">${fmtMoney(chargesTotalPosted)}</th></tr>
           <tr><th style="border:1px solid #ddd;padding:6px;text-align:left">Payments</th><th style="border:1px solid #ddd;padding:6px;text-align:right">-${fmtMoney(paymentsTotal)}</th></tr>
           <tr><th style="border:1px solid #ddd;padding:6px;text-align:left">Balance</th><th style="border:1px solid #ddd;padding:6px;text-align:right">${fmtMoney(balance)}</th></tr>
         </tfoot>
         </table>`
      : `<p>No charges</p>`;

    const footer = replacePlaceholders(tpl.footer || "", data);
    const sanitized = DOMPurify.sanitize(`<div style="text-align:center">${header}</div><hr/>${body}${itemsHtml}<hr/>${footer}`);
    openPrintWindow(sanitized);
  };

  // ------------------------------
  // UI guards
  // ------------------------------
  if (loading) return <div className="p-6">Loading reservation…</div>;
  if (!reservation) return <div className="p-6 text-gray-600">Reservation not found.</div>;

  const statusLower = ((reservation.status || "") + "").toLowerCase();

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {toast && <div className={`toast ${toast.type}`}>{toast.text}</div>}

      <h1 className="page-title">Reservation — {reservation.id}</h1>

      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        stays={stays}
        settings={settings}
        rooms={rooms}
        channels={channels}
        rates={rates}
        events={events}
        canOperate={can("canOperateFrontDesk") || can("canEditReservations")}
        doCheckIn={doCheckIn}
        doCheckOut={doCheckOut}
        changeRoom={changeRoom}
        upgradeRoom={upgradeRoom}
        printCheckInForm={() => { if (statusLower !== "checked-out") printCheckInForm(); }}
        printCheckOutBill={() => { if (statusLower === "checked-out") printCheckOutBill(); }}
        balance={balance}
      />

      <ReservationDetailC
        reservation={reservation}
        guest={guest}
        postings={postings}
        payments={payments}
        currency={settings.currency || "IDR"}
        fmtMoney={fmtMoney}
        showAddCharge={showAddCharge}
        setShowAddCharge={setShowAddCharge}
        chargeForm={chargeForm}
        setChargeForm={setChargeForm}
        submitCharge={(form) => submitCharge(form || chargeForm)}
        showAddPayment={showAddPayment}
        setShowAddPayment={setShowAddPayment}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        submitPayment={(form) => submitPayment(form || paymentForm)}
        roomSubtotals={roomSubtotals}
        displayChargeLines={visiblePostings}
        displayChargesTotal={displayChargesTotal}
        displayPaymentsTotal={paymentsTotal}
        displayBalance={balance}
        canOperate={can("canOperateFrontDesk") || can("canEditReservations")}
        printCheckInForm={() => { if (statusLower !== "checked-out") printCheckInForm(); }}
        printCheckOutBill={() => { if (statusLower === "checked-out") printCheckOutBill(); }}
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
