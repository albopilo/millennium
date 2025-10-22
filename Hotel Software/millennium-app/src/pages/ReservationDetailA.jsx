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
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

/**
 * Controller that preserves original logic:
 * - loads reservation and related data
 * - createForecastRoomPostings / ensureDepositPosting / convertForecastsToPosted
 * - submitCharge / submitPayment
 * - doCheckIn / doCheckOut
 *
 * This rewrite keeps all functions and logic but cleans up:
 * - defensive printing guards
 * - no input debounce for numeric typing (we parse numbers on submit)
 * - improved UI hooks (pass formatted previews)
 */

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName = currentUser?.displayName || currentUser?.email || "frontdesk";

  // permissions
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canUpgrade = can("canUpgradeRoom") || can("canOverrideRoomType");
  const canOverrideBilling = can("canOverrideBilling");
  const isAdmin = userData?.roleId === "admin";

  // state
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [guest, setGuest] = useState(null);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  // UI
  const [assignRooms, setAssignRooms] = useState([]);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "", type: "payment" });

  // print
  const printRef = useRef(null);
  const [printMode, setPrintMode] = useState(null);

  // defensive refs (prevent concurrent forecast creation)
  const creatingForecastsRef = useRef(false);
  const skippedZeroRateWarningsRef = useRef(new Set());

  // helpers: parse free typing numeric inputs (no debounce)
  const onlyDigits = (s) => (s || "").toString().replace(/[^\d]/g, "");
  const toInt = (s) => {
    const k = onlyDigits(s);
    return k ? parseInt(k, 10) : 0;
  };
  const fmtIdr = (n) => `IDR ${Number(n || 0).toLocaleString("id-ID")}`;

  // basic helpers
  const statusOf = (p) => ((p?.status || "") + "").toLowerCase();
  const acctOf = (p) => ((p?.accountCode || "") + "").toUpperCase();

  // date helpers (small, compatible versions)
  const datesInStay = (resObj) => {
    if (!resObj?.checkInDate || !resObj?.checkOutDate) return [];
    const a = resObj.checkInDate?.toDate ? resObj.checkInDate.toDate() : new Date(resObj.checkInDate);
    const b = resObj.checkOutDate?.toDate ? resObj.checkOutDate.toDate() : new Date(resObj.checkOutDate);
    const out = [];
    const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    while (cur < b) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  };
  const sameMonthDay = (d1, d2) => d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();

  // rateFor — search rates collection then channels then room fallback
  const rateFor = (roomType, channelName, date, roomDoc = null, channelList = null) => {
    const normalize = (s) => (s || "").toString().trim().toLowerCase();
    const channelId = normalize(channelName);
    const rtype = (roomType || "").trim();

    // 1) rates state
    let rd = rates.find((r) => normalize(r.roomType) === normalize(rtype) && normalize(r.channelId) === channelId);
    if (!rd) rd = rates.find((r) => normalize(r.roomType) === normalize(rtype));
    if (rd) {
      if (channelId === "direct") {
        const day = date.getDay();
        const weekend = day === 0 || day === 6;
        return weekend ? Number(rd.weekendRate || 0) : Number(rd.weekdayRate || 0);
      }
      return Number(rd.price || rd.baseRate || rd.nightlyRate || 0);
    }

    // 2) channels fallback
    const chList = channelList || channels || [];
    const chDoc = chList.find((c) => (c.name || "").toString().trim().toLowerCase() === channelId);
    if (chDoc) {
      if (channelId === "direct") {
        const day = date.getDay();
        const weekend = day === 0 || day === 6;
        const rateMap = weekend ? chDoc.weekendRate || {} : chDoc.weekdayRate || {};
        const maybe = rateMap[roomType] ?? rateMap[rtype];
        if (maybe != null && Number(maybe) > 0) return Number(maybe);
      } else {
        if (chDoc.price && Number(chDoc.price) > 0) return Number(chDoc.price);
      }
    }

    // 3) roomDoc fallback
    if (roomDoc) {
      const fallbacks = ["defaultRate", "rates", "price", "baseRate", "nightlyRate", "roomRate"];
      for (const k of fallbacks) {
        if (roomDoc[k] != null && Number(roomDoc[k]) > 0) return Number(roomDoc[k]);
      }
    }

    console.warn("rateFor: could not find rate", { roomType, channelName, date });
    return 0;
  };

  // deposit normalization: ensures a single canonical deposit posting (reservationId + '_DEPOSIT')
  async function ensureDepositPosting(resObj, assignedRooms = []) {
    const depositPerRoom = Number(resObj.depositPerRoom ?? settings.depositPerRoom ?? 0);
    const count = Array.isArray(assignedRooms) ? assignedRooms.length : 0;
    const depositTotal = depositPerRoom * count;
    if (depositTotal <= 0) return;

    const pSnap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", resObj.id)));
    const existing = pSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => (p.accountCode || "").toUpperCase() === "DEPOSIT");
    const depositDocId = `${resObj.id}_DEPOSIT`;
    const depositRef = doc(db, "postings", depositDocId);

    if (existing.length > 0) {
      const primary = existing.find((p) => p.id === depositDocId) || existing[0];
      const desiredStatus = (resObj.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";
      try {
        await setDoc(depositRef, {
          reservationId: resObj.id,
          stayId: null,
          roomNumber: null,
          description: "Security Deposit",
          amount: depositTotal,
          tax: 0,
          service: 0,
          status: desiredStatus,
          accountCode: "DEPOSIT",
          createdAt: primary.createdAt || new Date(),
          createdBy: primary.createdBy || actorName
        }, { merge: true });
      } catch (err) {
        console.log("ensureDepositPosting: failed canonical set", err);
      }

      // void duplicates
      for (const dup of existing) {
        if (dup.id === depositDocId) continue;
        try {
          if ((dup.status || "").toLowerCase() !== "void") {
            await updateDoc(doc(db, "postings", dup.id), { status: "void" });
          }
        } catch (err) {
          console.log("ensureDepositPosting: void dup failed", dup.id, err);
        }
      }
      return;
    }

    try {
      await setDoc(depositRef, {
        reservationId: resObj.id,
        stayId: null,
        roomNumber: null,
        description: "Security Deposit",
        amount: depositTotal,
        tax: 0,
        service: 0,
        status: (resObj.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast",
        accountCode: "DEPOSIT",
        createdAt: new Date(),
        createdBy: actorName
      });
    } catch (err) {
      console.log("ensureDepositPosting: create fail", err);
    }
  }

  // create per-room-per-night forecast postings (keeps original logic)
  const createForecastRoomPostings = async (resObj, assigned = [], g = null, allRooms = [], channelList = null) => {
    if (!resObj) return;
    if (creatingForecastsRef.current) return;
    creatingForecastsRef.current = true;
    try {
      const nights = datesInStay(resObj);
      const pct = (g && ((g.tier || "").toLowerCase() === "silver" ? 0.05 : (g.tier === "Gold" ? 0.10 : 0))) || 0;
      const bday = g?.birthdate ? new Date(g.birthdate) : null;
      const pSnapAll = await getDocs(query(collection(db, "postings"), where("reservationId", "==", resObj.id)));
      const existingPostings = pSnapAll.docs.map((d) => ({ id: d.id, ...d.data() }));

      const assignedDocs = (assigned || []).map((n) => allRooms.find((r) => r.roomNumber === n)).filter(Boolean);
      const firstDeluxeAssigned = assignedDocs.find((r) => (r.roomType || "").toLowerCase() === "deluxe");
      const year = new Date().getFullYear();
      const alreadyClaimed = Number(g?.lastBirthdayClaimYear || 0) === year;
      const applyBirthday = (resObj.channel || "").toLowerCase() === "direct" && bday && !alreadyClaimed;

      for (let idx = 0; idx < (assigned || []).length; idx++) {
        const roomNumber = assigned[idx];
        const roomDoc = allRooms.find((r) => r.roomNumber === roomNumber);
        if (!roomDoc) continue;

        for (const dRaw of nights) {
          const d = new Date(dRaw);
          // compute base (events override or rateFor)
          let base = 0;
          const ev = events.find((ev) => {
            const s = new Date(ev.startDate);
            const e = new Date(ev.endDate);
            return d >= s && d <= e;
          });
          if (ev && ev.rateType === "custom" && ev.customRates && ev.customRates[roomDoc.roomType] != null) {
            base = Number(ev.customRates[roomDoc.roomType]);
          } else {
            base = rateFor(roomDoc.roomType, resObj.channel, d, roomDoc, channelList);
          }

          if (!base || base <= 0) {
            const key = `${roomNumber}|${d.toISOString().slice(0, 10)}`;
            if (!skippedZeroRateWarningsRef.current.has(key)) {
              skippedZeroRateWarningsRef.current.add(key);
              console.warn(`createForecastRoomPostings: skipping zero base rate for ${roomNumber} on ${d.toISOString()}`, { roomDoc, ev, base });
            }
            continue;
          }

          let net = Number(base) * (1 - pct);

          if (applyBirthday && bday && sameMonthDay(d, bday)) {
            if ((g?.tier || "").toLowerCase() === "silver") {
              if (idx === 0) net -= Number(base) * 0.5;
            } else if ((g?.tier || "").toLowerCase() === "gold") {
              if ((roomDoc.roomType || "").toLowerCase() === "deluxe" && (!firstDeluxeAssigned || firstDeluxeAssigned.roomNumber === roomDoc.roomNumber)) {
                net -= Number(base);
              }
            }
            if (net < 0) net = 0;
          }

          const description = `Room charge ${roomDoc.roomType} ${d.toISOString().slice(0, 10)}`;

          const alreadyExists = existingPostings.some((ep) => {
            const sameAccount = (ep.accountCode || "").toUpperCase() === "ROOM";
            const sameRoom = ep.roomNumber === roomNumber;
            const sameDesc = ((ep.description || "") + "").trim().toLowerCase() === (description + "").trim().toLowerCase();
            const sameStatus = ep.status === "forecast" || ep.status === "posted";
            return sameAccount && sameRoom && sameDesc && sameStatus;
          });
          if (alreadyExists) continue;

          try {
            const ref = await addDoc(collection(db, "postings"), {
              reservationId: resObj.id,
              stayId: null,
              roomNumber,
              description,
              amount: Math.round(net),
              tax: 0,
              service: 0,
              status: "forecast",
              accountCode: "ROOM",
              createdAt: new Date(),
              createdBy: actorName
            });
            existingPostings.push({ id: ref.id, reservationId: resObj.id, roomNumber, description, accountCode: "ROOM", status: "forecast", amount: Math.round(net) });
          } catch (err) {
            console.log("createForecastRoomPostings: addDoc failed", err);
          }
        }
      }
    } finally {
      creatingForecastsRef.current = false;
    }
  };

  // convert forecast postings to posted (used on check-in)
  async function convertForecastsToPosted(stayMapByRoom = {}) {
    const snap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", reservation.id)));
    const forecasts = snap.docs.filter(d => {
      const p = d.data();
      return p.status === "forecast" && (p.accountCode === "ROOM" || p.accountCode === "DEPOSIT");
    });
    for (const fdoc of forecasts) {
      const pData = fdoc.data();
      const stayId = pData.accountCode === "ROOM" ? (stayMapByRoom[pData.roomNumber] || null) : null;
      try {
        await updateDoc(doc(db, "postings", fdoc.id), { status: "posted", stayId });
      } catch (err) {
        console.log("convertForecastsToPosted: update failed", fdoc.id, err);
      }
    }
  }

  // load everything
  const load = async () => {
    setLoading(true);
    try {
      const [resSnap, roomsSnap, settingsSnap, ratesSnap, eventsSnap, channelsSnap] = await Promise.all([
        getDoc(doc(db, "reservations", id)),
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
        getDocs(collection(db, "rates")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "channels"))
      ]);
      if (!resSnap.exists()) {
        navigate("/calendar");
        return;
      }
      const res = { id: resSnap.id, ...resSnap.data() };
      if ((res.status || "").toLowerCase() === "deleted") {
        navigate("/calendar");
        return;
      }
      setReservation(res);
      setRooms(roomsSnap.docs.map(d => d.data()));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
      setRates(ratesSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setEvents(eventsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setChannels(channelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      const initialAssigned = Array.isArray(res.roomNumbers) ? [...res.roomNumbers] : (res.roomNumber ? [res.roomNumber] : []);
      setAssignRooms(initialAssigned);

      // guest lookup
      let g = null;
      if (res.guestId) {
        const gSnap = await getDoc(doc(db, "guests", res.guestId));
        if (gSnap.exists()) g = { id: gSnap.id, ...gSnap.data() };
      }
      if (!g) {
        const gQ = query(collection(db, "guests"), where("name", "==", res.guestName || ""));
        const gSnap = await getDocs(gQ);
        if (!gSnap.empty) g = { id: gSnap.docs[0].id, ...gSnap.docs[0].data() };
      }
      setGuest(g);

      // stays, postings, payments
      const [sSnap, pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, "stays"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id)))
      ]);
      setStays(sSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPostings(pSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // create forecasts when booked and assigned but no forecast exists (preserve prior behavior)
      if ((res.status || "").toLowerCase() === "booked" && initialAssigned.length > 0) {
        const pList = pSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const hasForecastRoom = pList.some(p => (p.status || "posted") === "forecast" && p.accountCode === "ROOM");
        if (!hasForecastRoom) {
          await createForecastRoomPostings(res, initialAssigned, g, roomsSnap.docs.map(d => d.data()), channelsSnap.docs.map(d => ({ id: d.id, ...d.data() })));
          await ensureDepositPosting(res, initialAssigned);
          const p2 = await getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id)));
          setPostings(p2.docs.map(d => ({ id: d.id, ...d.data() })));
        } else {
          await ensureDepositPosting(res, initialAssigned);
          const p2 = await getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id)));
          setPostings(p2.docs.map(d => ({ id: d.id, ...d.data() })));
        }
      }

    } catch (err) {
      console.error("load error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // subscribe to logs
  useEffect(() => {
    if (!reservation?.id) return;
    const collRef = collection(doc(db, "reservations", reservation.id), "logs");
    const q = query(collRef, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, snap => setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [reservation?.id]);

  // Submit charge (no debounce; parse on submit)
  const submitCharge = async () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description?.trim()) { alert("Description required"); return; }
    if (total <= 0) { alert("Total must be > 0"); return; }
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
        quantity: qty,
        unitAmount: unit,
        accountCode: (chargeForm.accountCode || "MISC").toUpperCase(),
        status,
        createdAt: new Date(),
        createdBy: actorName
      });
      setShowAddCharge(false);
      setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
      await load();
    } catch (err) {
      console.error("submitCharge error", err);
      alert("Failed to add charge");
    }
  };

  // Submit payment (no debounce; parse on submit)
  const submitPayment = async () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) { alert("Payment must be > 0"); return; }
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
      console.error("submitPayment error", err);
      alert("Failed to add payment");
    }
  };

  // Check-in flow
  const doCheckIn = async () => {
    if (!reservation) return;
    if ((reservation.status || "").toLowerCase() !== "booked") { alert("Reservation is not booked"); return; }
    if (!assignRooms.length) { alert("Assign at least one room"); return; }
    setLoading(true);
    try {
      const stayMap = {};
      await runTransaction(db, async tx => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation not found");
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
            currency: settings.currency || "IDR",
            createdBy: actorName
          });
          stayMap[roomNumber] = stayRef.id;
          tx.update(doc(db, "rooms", roomNumber), { status: "Occupied" });
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });

      await convertForecastsToPosted(stayMap);
      await ensureDepositPosting(reservation, assignRooms);
      alert("Checked in");
      await load();
    } catch (err) {
      console.error("doCheckIn error", err);
      alert("Check-in failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // Check-out flow
  const doCheckOut = async () => {
    const charges = (postings || []).filter(p => statusOf(p) !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const pays = (payments || []).filter(p => statusOf(p) !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = charges - pays;
    if (balance > 0.01 && !canOverrideBilling) {
      alert(`Outstanding ${fmtIdr(balance)}. Override required to check out.`);
      return;
    }
    setLoading(true);
    try {
      await runTransaction(db, async tx => {
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
      alert("Checked out");
      await load();
    } catch (err) {
      console.error("doCheckOut error", err);
      alert("Check-out failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // Print handlers, linked to AdminPrintTemplate stored doc (admin_print_templates/default)
  // We only allow print check-in when reservation is checked-in; print check-out only when checked-out.
async function printCheckInForm() {
    if (!reservation) return;
    const status = (reservation.status || "").toLowerCase();
    if (status !== "checked-in") {
      alert("Reservation must be checked-in before printing check-in form.");
      return;
    }
    // ensure print templates are loaded
    setPrintMode("checkin");
    await new Promise(r => setTimeout(r, 200));
    window.print();
    setTimeout(() => setPrintMode(null), 300);
  }

  async function printCheckOutForm() {
    if (!reservation) return;
    const status = (reservation.status || "").toLowerCase();
    if (status !== "checked-out") {
      alert("Reservation must be checked-out before printing check-out form.");
      return;
    }
    setPrintMode("checkout");
   await new Promise(r => setTimeout(r, 200));
    window.print();
    setTimeout(() => setPrintMode(null), 300);
  }

  // Derived totals
  const visiblePostings = useMemo(() => (postings || []).filter(p => statusOf(p) !== "void"), [postings]);
  const displayChargeLines = useMemo(() => {
    const targetStatus = (reservation?.status || "").toLowerCase() === "booked" ? "forecast" : "posted";
    return visiblePostings.filter(p => statusOf(p) === targetStatus && acctOf(p) !== "PAY");
  }, [visiblePostings, reservation]);

  const displayChargesTotal = useMemo(() => displayChargeLines.reduce((s, p) => s + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0), [displayChargeLines]);
  const displayPaymentsTotal = useMemo(() => (payments || []).filter(p => statusOf(p) !== "void" && statusOf(p) !== "refunded").reduce((s, p) => s + Number(p.amount || 0), 0), [payments]);
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // small fmt helper (used by children)
  // small fmt helper (used by children)
// robustly handles Firestore Timestamps, plain Date, number (ms), and ISO strings
const fmt = (raw) => {
  if (!raw && raw !== 0) return "-";
  let dateObj = null;

  try {
    // Firestore Timestamp object has .toDate()
    if (raw && typeof raw.toDate === "function") {
      dateObj = raw.toDate();
    }
    // Some code stores plain seconds / seconds+nanos object
    else if (raw && typeof raw.seconds === "number") {
      dateObj = new Date(Number(raw.seconds) * 1000);
    }
    // If it's already a Date instance
    else if (raw instanceof Date) {
      dateObj = raw;
    }
    // If it's a numeric epoch in ms
    else if (typeof raw === "number") {
      dateObj = new Date(raw);
    }
    // If it's a string, try parse it
    else if (typeof raw === "string") {
      const maybe = new Date(raw);
      dateObj = isNaN(maybe) ? null : maybe;
    } else {
      // fallback try
      const maybe = new Date(raw);
      dateObj = isNaN(maybe) ? null : maybe;
    }
  } catch (err) {
    dateObj = null;
  }

  if (!dateObj || isNaN(dateObj.getTime())) return "-";
  return dateObj.toLocaleString();
};


  if (loading || !reservation) {
    return <div style={{ padding: 20 }}>Loading reservation…</div>;
  }

  return (
    <div>
      {/* When printMode is set we render ReservationDetailC alone (the printable content) */}
      {printMode ? (
        <ReservationDetailC
          printRef={printRef}
          printMode={printMode}
          reservation={reservation}
          settings={settings}
          fmt={fmt}
          postings={postings}
          visiblePostings={visiblePostings}
          displayChargeLines={displayChargeLines}
          displayChargesTotal={displayChargesTotal}
          displayPaymentsTotal={displayPaymentsTotal}
          displayBalance={displayBalance}
          payments={payments}
          canOperate={canOperate}
          isAdmin={isAdmin}
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
          guest={guest}
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
              setAssignRooms(next);
              try {
                await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
                await createForecastRoomPostings({ ...reservation, roomNumbers: next }, next, guest, rooms, channels);
                await ensureDepositPosting({ ...reservation, roomNumbers: next }, next);
                await load();
              } catch (err) {
                console.error("setAssignRooms persist error", err);
              }
            }}
            renderAssignmentRow={(i) => {
              const val = assignRooms[i] || "";
              const lockType = (Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers[i] : null) ? rooms.find(r => r.roomNumber === reservation.roomNumbers[i])?.roomType : null;
              const options = rooms.filter(r => r.status !== "OOO" && r.status !== "Occupied" && (!lockType || r.roomType === lockType));
              return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <select
                    value={val}
                    onChange={async (e) => {
                      const nextVal = e.target.value;
                      const next = [...assignRooms];
                      next[i] = nextVal;
                      setAssignRooms(next);
                      await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
                      await createForecastRoomPostings({ ...reservation, roomNumbers: next }, next, guest, rooms, channels);
                      await ensureDepositPosting({ ...reservation, roomNumbers: next }, next);
                      await load();
                    }}
                  >
                    <option value="">Select room</option>
                    {options.map(r => <option key={r.roomNumber} value={r.roomNumber}>{r.roomNumber} ({r.roomType}) {r.status ? `[${r.status}]` : ""}</option>)}
                  </select>
                </div>
              );
            }}
            canOperate={canOperate}
            canUpgrade={canUpgrade}
            doCheckIn={doCheckIn}
            doCheckOut={doCheckOut}
            printCheckInForm={printCheckInForm}
            printCheckOutBill={printCheckOutForm}
            stays={stays}
            fmt={fmt}
            isAdmin={isAdmin}
            navigate={navigate}
            logReservationChange={async (...args) => { /* preserve stub for children */ }}
          />

          <ReservationDetailC
            printRef={printRef}
            printMode={printMode}
            printCheckOutBill={printCheckOutForm}
            reservation={reservation}
            settings={settings}
            fmt={fmt}
            postings={postings}
            visiblePostings={visiblePostings}
            displayChargeLines={displayChargeLines}
            displayChargesTotal={displayChargesTotal}
            displayPaymentsTotal={displayPaymentsTotal}
            displayBalance={displayBalance}
            payments={payments}
            canOperate={canOperate}
            isAdmin={isAdmin}
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
            guest={guest}
          />
        </>
      )}
      {/* change log */}
      <div style={{ marginTop: 24 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Change Log</div>
        {logs.length === 0 ? <div style={{ color: "#64748b", fontStyle: "italic" }}>No changes logged yet.</div> : (
          <ol>
            {logs.map(l => (
              <li key={l.id} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{(l.action || "").toString().toUpperCase()}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{new Date(l.at || l.createdAt || Date.now()).toLocaleString()}</div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
