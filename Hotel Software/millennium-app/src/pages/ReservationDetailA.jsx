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
  deleteDoc,
  setDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { fmt, ymd } from "../lib/dates";

import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

export default function ReservationDetail({ permissions = [], currentUser = null, userData = null }) {
  const navigate = useNavigate();
  const { id } = useParams();

  // Permissions
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const canUpgrade = can("canUpgradeRoom") || can("canOverrideRoomType");
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canOverrideBilling = can("canOverrideBilling");

  // Actor and admin
  const actorName =
    currentUser?.displayName ||
    currentUser?.name ||
    currentUser?.fullName ||
    currentUser?.email ||
    "frontdesk";

  const isAdmin = userData?.roleId === "admin";

  // Data state
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

  // UI state
  const [loading, setLoading] = useState(false);
  const [assignRooms, setAssignRooms] = useState([]);

  // Move / Upgrade
  const [moveRoomStay, setMoveRoomStay] = useState(null);
  const [newRoom, setNewRoom] = useState("");
  const [upgradeStay, setUpgradeStay] = useState(null);
  const [upgradeRoom, setUpgradeRoom] = useState("");
  const [upgradeIndex, setUpgradeIndex] = useState(null);
  const [upgradePreRoom, setUpgradePreRoom] = useState("");

  // Add charge/payment — string buffers (no freeze)
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

 // Delete reservation modal (admin-only)
const [deleteReason, setDeleteReason] = useState("");
const [showDeleteModal, setShowDeleteModal] = useState(false);
const [deleting, setDeleting] = useState(false);

// === New admin delete modal helpers ===
const closeDeleteModal = () => {
  setDeleteReason("");
  setShowDeleteModal(false);
};

const deleteReservation = async () => {
  if (!isAdmin || !reservation) return;
  if (!deleteReason || deleteReason.trim().length < 3) {
    window.alert("Please provide a reason (at least 3 characters).");
    return;
  }
  const reason = deleteReason.trim();
  setDeleting(true);
  try {
    const resRef = doc(db, "reservations", reservation.id);
    const resSnap = await getDoc(resRef);
    if (!resSnap.exists()) {
      window.alert("Reservation not found (already removed).");
      setDeleting(false);
      closeDeleteModal();
      await load();
      return;
    }
    const resData = { id: resSnap.id, ...resSnap.data() };

    const deletedRecord = {
      ...resData,
      deletedBy: actorName,
      deletedAt: new Date(),
      deletedReason: reason,
    };

    await runTransaction(db, async (tx) => {
      const snap = await tx.get(resRef);
      if (!snap.exists()) throw new Error("Reservation not found in transaction.");
      const delDocRef = doc(db, "deleted_reservations", resRef.id);
      tx.set(delDocRef, deletedRecord);
      tx.delete(resRef);
    });

    await logAction("reservation.delete", { reason });
    window.alert("Reservation moved to archive (deleted).");
    closeDeleteModal();
    await load();
  } catch (err) {
    console.error("deleteReservation error:", err);
    window.alert("Failed to delete reservation: " + (err.message || String(err)));
  } finally {
    setDeleting(false);
  }
};


  // Print
  const printRef = useRef(null);
  const [printMode, setPrintMode] = useState(null);

  const currency = settings.currency || "IDR";
  const fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID"));

  // Helpers: free-typing numeric inputs (parse on submit)
  const onlyDigits = (s) => (s || "").replace(/[^\d]/g, "");
  const toInt = (s) => {
    const k = onlyDigits(s);
    if (!k) return 0;
    const v = parseInt(k, 10);
    return isNaN(v) ? 0 : v;
  };

  // canonical helpers (put near top)
  const statusOf = (p) => ((p?.status || "") + "").toLowerCase();
  const acctOf = (p) => ((p?.accountCode || "") + "").toUpperCase();

  // === NEW: guards to avoid concurrent forecast creation and repeated warnings ===
  const creatingForecastsRef = useRef(false);
  const skippedZeroRateWarningsRef = useRef(new Set()); // track `${roomNumber}|${ymd}` to warn once

  // reset the zero-rate cache when reservation changes (so new reservation gets fresh warnings)
  useEffect(() => {
    skippedZeroRateWarningsRef.current.clear();
  }, [reservation?.id]);

  // Delete Reservation handler (prompt-based quick handler kept as-is)
  const handleDeleteReservation = async () => {
    if (!isAdmin) return;

    const reason = prompt("Please enter a reason for deleting this reservation:");
    if (!reason) return;

    try {
      const deletedData = {
        ...reservation,
        status: "deleted",
        deletedAt: new Date().toISOString(),
        deletedBy: actorName,
        deleteReason: reason,
      };

      // Save into "deleted_reservations" (archive collection)
      await setDoc(doc(db, "deleted_reservations", reservation.id), deletedData);

      // Remove from "reservations"
      await deleteDoc(doc(db, "reservations", reservation.id));

      // Also remove stays linked to reservation
      const qStays = query(collection(db, "stays"), where("reservationId", "==", reservation.id));
      const staySnap = await getDocs(qStays);
      for (const s of staySnap.docs) {
        await deleteDoc(doc(db, "stays", s.id));
      }

      alert("Reservation deleted successfully.");
      navigate("/calendar");
    } catch (err) {
      console.error("Error deleting reservation:", err);
      alert("Failed to delete reservation. Check console for details.");
    }
  };

  const confirmDeleteReservation = async () => {
    if (!deleteReason.trim()) {
      alert("Please provide a reason for deleting.");
      return;
    }

    setDeleting(true);
    try {
      const deletedData = {
        ...reservation,
        deletedAt: new Date().toISOString(),
        deletedBy: actorName,
        deleteReason: deleteReason.trim(),
      };

      // Save into "deletedReservations"
      await setDoc(doc(db, "deleted_reservations", reservation.id), deletedData);

      // Remove from "reservations"
      await deleteDoc(doc(db, "reservations", reservation.id));

      alert("Reservation deleted successfully.");
      setShowDeleteModal(false);
      navigate("/reservations");
    } catch (err) {
      console.error("Error deleting reservation:", err);
      alert("Failed to delete reservation. Check console for details.");
    } finally {
      setDeleting(false);
    }
  };

  function isNightAuditClosed(resObj) {
    const today = new Date();
    today.setHours(0,0,0,0);
    const checkOut = resObj?.checkOutDate?.toDate ? resObj.checkOutDate.toDate() : new Date(resObj?.checkOutDate);
    const status = (resObj?.status || "").toLowerCase();
    return today >= checkOut || status === "checked-out";
  }

  // Date/Rate helpers (kept unchanged)
  function datesInStay(resObj, checkInOverride, checkOutOverride) {
    if (!resObj?.checkInDate || !resObj?.checkOutDate) return [];
    const inD = resObj.checkInDate?.toDate ? resObj.checkInDate.toDate() : new Date(resObj.checkInDate);
    const outD = resObj.checkOutDate?.toDate ? resObj.checkOutDate.toDate() : new Date(resObj.checkOutDate);
    const start = checkInOverride || new Date(inD.getFullYear(), inD.getMonth(), inD.getDate(), 0, 0, 0, 0);
    const end = checkOutOverride || new Date(outD.getFullYear(), outD.getMonth(), outD.getDate(), 0, 0, 0, 0);
    const list = [];
    const cur = new Date(start);
    while (cur < end) {
      list.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }

  function fmtDMY(d) {
    const dt = d?.toDate ? d.toDate() : d instanceof Date ? d : (d ? new Date(d) : new Date());
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yy = dt.getFullYear();
    return `${dd}/${mm}/${yy}`;
  }

  function calcNights(resObj) {
    if (!resObj?.checkInDate || !resObj?.checkOutDate) return 1;
    const inD = resObj.checkInDate?.toDate ? resObj.checkInDate.toDate() : new Date(resObj.checkInDate);
    const outD = resObj.checkOutDate?.toDate ? resObj.checkOutDate.toDate() : new Date(resObj.checkOutDate);
    const ms = Math.max(0, outD.setHours(0, 0, 0, 0) - inD.setHours(0, 0, 0, 0));
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
  }

  function adultsChildren(resObj, g) {
    const a = Number(resObj?.adults ?? g?.adults ?? 1);
    const c = Number(resObj?.children ?? g?.children ?? 0);
    const aText = `${a} ${a === 1 ? "Dewasa" : "Dewasa"}`;
    const cText = `${c} ${c === 1 ? "Anak" : "Anak"}`;
    return `${aText}, ${cText}`;
  }

  function fmtCurrency(curr, n) {
    const v = Number(n || 0);
    return `${curr || "IDR"} ${isNaN(v) ? "-" : v.toLocaleString("id-ID")}`;
  }

  const getEventForDate = (date) => {
    return events.find((ev) => {
      const start = new Date(ev.startDate);
      const end = new Date(ev.endDate);
      return date >= start && date <= end;
    });
  };

  /**
   * rateFor:
   * - looks first in the rates collection (state variable `rates`)
   * - falls back to channels collection (pass channelList to avoid race)
   * - returns Number or 0
   *
   * Accepts optional `roomDoc` (legacy) and optional `channelList` (array)
   */
  const rateFor = (roomType, channelName, date, roomDoc = null, channelList = null) => {
    const normalize = (s) => (s || "").toString().trim().toLowerCase();
    const channelId = normalize(channelName);
    const rtype = (roomType || "").trim();

    // === 1. Look in rates collection ===
    let rd = rates.find(
      (r) =>
        normalize(r.roomType) === normalize(rtype) &&
        normalize(r.channelId) === channelId
    );

    if (!rd) {
      rd = rates.find((r) => normalize(r.roomType) === normalize(rtype));
    }

    if (rd) {
      if (channelId === "direct") {
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6;
        return isWeekend
          ? Number(rd.weekendRate || 0)
          : Number(rd.weekdayRate || 0);
      }
      return Number(rd.price || rd.baseRate || rd.nightlyRate || 0);
    }

    // === 2. Fallback to channels collection ===
    const chList = channelList || channels || [];
    const channelDoc = chList.find((c) => normalize(c.name) === channelId);
    if (channelDoc) {
      if (channelId === "direct") {
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6;
        const rateMap = isWeekend
          ? channelDoc.weekendRate || {}
          : channelDoc.weekdayRate || {};
        const maybe = rateMap[roomType] ?? rateMap[rtype];
        if (maybe != null && Number(maybe) > 0) {
          return Number(maybe);
        }
      } else {
        // OTA or other channels — fallback to flat price if exists
        if (channelDoc.price && Number(channelDoc.price) > 0) {
          return Number(channelDoc.price);
        }
      }
    }

    // === 3. Legacy fallback to roomDoc fields (if provided) ===
    if (roomDoc) {
      const fallbackCandidates = [
        "defaultRate",
        "rates",
        "price",
        "baseRate",
        "nightlyRate",
        "roomRate",
      ];
      for (const key of fallbackCandidates) {
        if (roomDoc[key] != null && Number(roomDoc[key]) > 0) {
          return Number(roomDoc[key]);
        }
      }
    }

    console.warn("rateFor: could not find any rate", {
      roomType,
      channelName,
      date,
      rates,
      channels: chList,
    });
    return 0;
  };

  function sameMonthDay(d1, d2) {
    return d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }

  function tierDiscountPctFor(resObj, g) {
    if ((resObj?.channel || "").toLowerCase() !== "direct" || !g?.tier) return 0;
    if (g.tier === "Silver") return 0.05;
    if (g.tier === "Gold") return 0.10;
    return 0;
  }

  function birthdayNightDateFor(resObj, g) {
    if (!g?.birthdate) return null;
    const nights = datesInStay(resObj);
    const b = new Date(g.birthdate);
    return nights.find((n) => sameMonthDay(n, b)) || null;
  }

  // Availability guard
  async function isRoomAvailableForRes(resObj, roomNumber) {
    if (!resObj?.checkInDate || !resObj?.checkOutDate) return false;
    const inD = resObj.checkInDate?.toDate ? resObj.checkInDate.toDate() : new Date(resObj.checkInDate);
    const outD = resObj.checkOutDate?.toDate ? resObj.checkOutDate.toDate() : new Date(resObj.checkOutDate);

    const qRes = query(
      collection(db, "reservations"),
      where("roomNumbers", "array-contains", roomNumber),
      where("status", "in", ["booked", "checked-in"])
    );
    const snap = await getDocs(qRes);
    return snap.docs.every((d) => {
      const r = d.data();
      if (d.id === resObj.id) return true;
      const rIn = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
      const rOut = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
      return outD <= rIn || inD >= rOut;
    });
  }

  // Audit log
  async function logAction(action, payload = {}) {
    try {
      await addDoc(collection(db, "reservation_logs"), {
        reservationId: reservation?.id || id,
        action,
        by: actorName,
        at: new Date(),
        payload
      });
    } catch {
      console.log("logAction: failed to write", action, payload);
    }
  }

  // Ensure a single DEPOSIT posting exists
  // NOTE: to avoid race-created duplicate deposits we write a deterministic doc id:
  // postings/{reservationId}_DEPOSIT
  async function ensureDepositPosting(resObj, assignedRooms) {
    const depositPerRoom = Number(resObj.depositPerRoom || settings.depositPerRoom || 0);
    const count = Array.isArray(assignedRooms) ? assignedRooms.length : 0;
    const depositTotal = depositPerRoom * count;
    if (depositTotal <= 0) return;

    // read all deposit-like postings for this reservation
    const pSnap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", resObj.id)));

    const existing = pSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => (p.accountCode || "").toUpperCase() === "DEPOSIT");

    // choose canonical deposit doc id
    const depositDocId = `${resObj.id}_DEPOSIT`;
    const depositRef = doc(db, "postings", depositDocId);

    if (existing.length > 0) {
      // If there is an existing deposit doc that's NOT our canonical id, we'll migrate/normalize:
      const primary = existing.find((p) => p.id === depositDocId) || existing[0];
      const desiredStatus = (resObj.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";

      try {
        // update canonical deposit (if exists) or create canonical doc with merge
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
        console.log("ensureDepositPosting: failed to write canonical deposit", err);
      }

      // void duplicates (all deposit docs except the canonical depositDocId)
      for (const dup of existing) {
        if (dup.id === depositDocId) continue;
        try {
          if ((dup.status || "").toLowerCase() !== "void") {
            await updateDoc(doc(db, "postings", dup.id), { status: "void" });
          }
        } catch (err) {
          console.log("ensureDepositPosting: failed to void duplicate deposit", dup.id, err);
        }
      }
      return;
    }

    // create canonical deposit posting deterministically
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
      console.log("ensureDepositPosting: failed to create deposit posting", err);
    }
  }

  /**
   * createForecastRoomPostings:
   * - accepts allRooms (array) and channelList (array) to avoid relying on React state being settled
   */
  const createForecastRoomPostings = async (resObj, assigned, g, allRooms, channelList = null) => {
    if (!resObj) return;
    // prevent concurrent invocations within this client
    if (creatingForecastsRef.current) {
      return;
    }
    creatingForecastsRef.current = true;

    try {
      const nights = datesInStay(resObj);
      const pct = tierDiscountPctFor(resObj, g);
      const bday = birthdayNightDateFor(resObj, g);

      const pSnapAll = await getDocs(query(collection(db, "postings"), where("reservationId", "==", resObj.id)));
      const existingPostings = pSnapAll.docs.map((d) => ({ id: d.id, ...d.data() }));

      const deluxeLower = "deluxe";
      const assignedDocs = (assigned || []).map((n) => allRooms.find((r) => r.roomNumber === n)).filter(Boolean);
      const firstDeluxeAssigned = assignedDocs.find((r) => (r.roomType || "").toLowerCase() === deluxeLower);

      const year = new Date().getFullYear();
      const alreadyClaimed = Number(g?.lastBirthdayClaimYear || 0) === year;
      const applyBirthday = (resObj.channel || "").toLowerCase() === "direct" && bday && !alreadyClaimed;

      for (let idx = 0; idx < (assigned || []).length; idx++) {
        const roomNumber = assigned[idx];
        const roomDoc = allRooms.find((r) => r.roomNumber === roomNumber);
        if (!roomDoc) continue;

        for (const dRaw of nights) {
          const d = toWIBDate(dRaw);
          const ev = getEventForDate(d);

          // compute base rate (includes event override + fallback)
          // pass channelList explicitly to rateFor so it won't rely on stale/empty state
          const base = (() => {
            // event custom rates override
            if (ev && ev.rateType === "custom" && ev.customRates && ev.customRates[roomDoc.roomType] != null) {
              return Number(ev.customRates[roomDoc.roomType]);
            }
            return rateFor(roomDoc.roomType, resObj.channel, d, roomDoc, channelList);
          })();

          if (!base || base <= 0) {
            const key = `${roomNumber}|${ymd(d)}`;
            if (!skippedZeroRateWarningsRef.current.has(key)) {
              skippedZeroRateWarningsRef.current.add(key);
              console.warn(
                `createForecastRoomPostings: skipping zero base rate for room ${roomNumber} on ${d.toISOString()}`,
                { roomDoc, ev, base }
              );
            }
            continue;
          }

          let net = Number(base || 0) * (1 - pct);

          if (applyBirthday && bday && sameMonthDay(d, bday)) {
            if (g?.tier === "Silver") {
              if (idx === 0) net -= Number(base || 0) * 0.5;
            } else if (g?.tier === "Gold") {
              if (
                (roomDoc.roomType || "").toLowerCase() === "deluxe" &&
                (!firstDeluxeAssigned || firstDeluxeAssigned.roomNumber === roomDoc.roomNumber)
              ) {
                net -= Number(base || 0);
              }
            }
            if (net < 0) net = 0;
          }

          const description = `Room charge ${roomDoc.roomType} ${ymd(d)}`;

          // normalize and check existing postings to avoid duplicates (case-insensitive description)
          const alreadyExists = existingPostings.some((ep) => {
            const sameAccount = (ep.accountCode || "").toUpperCase() === "ROOM";
            const sameRoom = ep.roomNumber === roomNumber;
            const sameDesc = ((ep.description || "") + "").trim().toLowerCase() === (description + "").trim().toLowerCase();
            const sameStatus = (ep.status === "forecast" || ep.status === "posted");
            return sameAccount && sameRoom && sameDesc && sameStatus;
          });
          if (alreadyExists) {
            continue;
          }

          try {
            const posted = await addDoc(collection(db, "postings"), {
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

            existingPostings.push({
              id: posted.id,
              reservationId: resObj.id,
              roomNumber,
              description,
              accountCode: "ROOM",
              status: "forecast",
              amount: Math.round(net)
            });
          } catch (err) {
            console.log("createForecastRoomPostings: failed to add posting", err);
          }
        }
      }
    } finally {
      creatingForecastsRef.current = false;
    }
  };

  const convertForecastsToPosted = async (stayMapByRoom) => {
    const pSnap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", reservation.id)));
    const forecasts = pSnap.docs.filter((d) => {
      const p = d.data();
      return p.status === "forecast" && (p.accountCode === "ROOM" || p.accountCode === "DEPOSIT");
    });

    for (const f of forecasts) {
      const data = f.data();
      const stayId = data.accountCode === "ROOM" ? stayMapByRoom[data.roomNumber] || null : null;
      try {
        await updateDoc(doc(db, "postings", f.id), { status: "posted", stayId });
      } catch (err) {
        console.log("convertForecastsToPosted: failed to update posting", f.id, err);
      }
    }
  };

  // Ensure we use local names for variables used below to avoid lint errors
  // Persist assignment and rebuild forecast postings
  async function persistAssignmentAndForecast(nextAssign) {
    await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: nextAssign });
    await logAction("assignment.update", { roomNumbers: nextAssign });

    const pSnap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", reservation.id)));
    const forecasts = pSnap.docs.filter(
      (d) => (d.data().status || "posted") === "forecast" && d.data().accountCode === "ROOM"
    );
    for (const f of forecasts) {
      try {
        await updateDoc(doc(db, "postings", f.id), { status: "void" });
      } catch (err) {
        console.log("persistAssignmentAndForecast: error voiding forecast", f.id, err);
      }
    }

    // New: call createForecastRoomPostings but don't allow concurrent runs
    // pass current channels and rooms arrays to avoid stale state race
    await createForecastRoomPostings({ ...reservation, roomNumbers: nextAssign }, nextAssign, guest, rooms, channels);
    await ensureDepositPosting({ ...reservation, roomNumbers: nextAssign }, nextAssign);
    await load();
  }

  // Load all data
  const load = async () => {
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

      if (!resSnap.exists()) {
        setLoading(false);
        navigate("/calendar");
        return;
      }

      const res = { id: resSnap.id, ...resSnap.data() };

      if ((res.status || "").toLowerCase() === "deleted") {
        setLoading(false);
        navigate("/calendar");
        return;
      }

      setReservation(res);

      // prepare local arrays (so we can pass them into forecasting immediately)
      const roomList = roomsSnap.docs.map((d) => d.data());
      const channelList = channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const ratesList = ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const eventsList = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // update state
      setRooms(roomList);
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
      setRates(ratesList);
      setEvents(eventsList);
      setChannels(channelList);

      const initialAssigned = Array.isArray(res.roomNumbers)
        ? [...res.roomNumbers]
        : res.roomNumber
        ? [res.roomNumber]
        : [];
      setAssignRooms(initialAssigned);

      // Guest
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

      // Stays and folio
      const qStays = query(collection(db, "stays"), where("reservationId", "==", res.id));
      const sSnap = await getDocs(qStays);
      setStays(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      const [pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id)))
      ]);
      const pList = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPostings(pList);
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Create forecasts if needed — pass roomList and channelList explicitly
      if ((res.status || "").toLowerCase() === "booked" && initialAssigned.length > 0) {
        const hasForecastRoom = pList.some((p) => (p.status || "posted") === "forecast" && p.accountCode === "ROOM");
        if (!hasForecastRoom) {
          await createForecastRoomPostings(res, initialAssigned, g, roomList, channelList);
          await ensureDepositPosting(res, initialAssigned);
          const p2 = await getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id)));
          setPostings(p2.docs.map((d) => ({ id: d.id, ...d.data() })));
        } else {
          await ensureDepositPosting(res, initialAssigned);
          const p2 = await getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id)));
          setPostings(p2.docs.map((d) => ({ id: d.id, ...d.data() })));
        }
      }
    } catch (err) {
      console.log("load: error", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Folio (itemized lines before totals)
  const isBooked = (reservation?.status || "").toLowerCase() === "booked";
  // visible postings — ignore 'void' (case-insensitive)
  const visiblePostings = useMemo(
    () => postings.filter((p) => statusOf(p) !== "void"),
    [postings]
  );
  // choose target status depending on reservation (booked => forecast, else posted)
  const displayChargeLines = useMemo(() => {
    const targetStatus = isBooked ? "forecast" : "posted";
    return visiblePostings
      .filter((p) => statusOf(p) === targetStatus && acctOf(p) !== "PAY")
      .sort((a, b) => {
        const aAt = a.createdAt?.toDate ? a.createdAt.toDate() : a.createdAt ? new Date(a.createdAt) : null;
        const bAt = b.createdAt?.toDate ? b.createdAt.toDate() : b.createdAt ? new Date(b.createdAt) : null;
        if (aAt && bAt) return aAt - bAt;
        if (aAt && !bAt) return -1;
        if (!aAt && bAt) return 1;
        const order = { ROOM: 1, DEPOSIT: 2, ADJ: 3 };
        const ao = order[acctOf(a)] || 99;
        const bo = order[acctOf(b)] || 99;
        if (ao !== bo) return ao - bo;
        return (a.description || "").localeCompare(b.description || "");
      });
  }, [visiblePostings, isBooked]);

  const displayChargesTotal = useMemo(
    () =>
      displayChargeLines.reduce(
        (sum, p) => sum + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0),
        0
      ),
    [displayChargeLines]
  );

  const displayPaymentsTotal = useMemo(
    () =>
      payments
        .filter((p) => statusOf(p) !== "void" && statusOf(p) !== "refunded")
        .reduce((sum, p) => sum + Number(p.amount || 0), 0),
    [payments]
  );

  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // Room-type lock helpers, assignment options, etc.
  function roomTypeAtIndex(idx) {
    const existing = Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers[idx] : null;
    const existingType = existing ? rooms.find((r) => r.roomNumber === existing)?.roomType : null;
    if (existingType) return existingType;
    const selected = assignRooms[idx];
    const selectedType = selected ? rooms.find((r) => r.roomNumber === selected)?.roomType : null;
    return selectedType || null;
  }

  function toWIBDate(d) {
    const date = d instanceof Date ? d : new Date(d);
    const offsetMs = 7 * 60 * 60 * 1000; // GMT+7 shift
    const shifted = new Date(date.getTime() + offsetMs);
    return new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate());
  }

  const assignmentOptionsForIndex = (idx) => {
    const lockType = roomTypeAtIndex(idx);
    return rooms
      .filter((r) => r.status !== "OOO" && r.status !== "Occupied" && (!lockType || r.roomType === lockType))
      .map((r) => ({
        value: r.roomNumber,
        label: `${r.roomNumber} (${r.roomType}) ${r.status ? `[${r.status}]` : ""}`
      }));
  };

  // Same-type change options
  const currentRoomType = useMemo(() => {
    if (!moveRoomStay) return null;
    const current = rooms.find((r) => r.roomNumber === moveRoomStay.roomNumber);
    return current?.roomType || null;
  }, [moveRoomStay, rooms]);

  const sameTypeOptions = useMemo(() => {
    if (!moveRoomStay) return [];
    return rooms
      .filter(
        (r) => r.status !== "OOO" && r.status !== "Occupied" && (r.roomType || "") === (currentRoomType || "")
      )
      .map((r) => ({ value: r.roomNumber, label: `${r.roomNumber} (${r.roomType})` }));
  }, [rooms, moveRoomStay, currentRoomType]);

  // Upgrade delta calculator
  async function computeUpgradeDelta(resObj, g, oldRoomType, newRoomType, remainingOnly = true) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const allNights = datesInStay(resObj);
    const nights = remainingOnly ? allNights.filter((d) => d >= now) : allNights;
    const pct = tierDiscountPctFor(resObj, g);

    let oldSum = 0;
    let newSum = 0;
    for (const dRaw of nights) {
      const d = toWIBDate(dRaw);
      const ev = getEventForDate(d);
      const oldRate =
        ev && ev.rateType === "custom" && ev.customRates && ev.customRates[oldRoomType] != null
          ? Number(ev.customRates[oldRoomType])
          : rateFor(oldRoomType, resObj.channel, d, null, channels);
      const newRate =
        ev && ev.rateType === "custom" && ev.customRates && ev.customRates[newRoomType] != null
          ? Number(ev.customRates[newRoomType])
          : rateFor(newRoomType, resObj.channel, d, null, channels);
      oldSum += Number(oldRate || 0) * (1 - pct);
      newSum += Number(newRate || 0) * (1 - pct);
    }
    return Math.round(newSum - oldSum);
  }

  // Actions: Change Room (same type)
  const doChangeRoom = async () => {
    if (!canOperate || !moveRoomStay || !newRoom) return;

    const available = await isRoomAvailableForRes(reservation, newRoom);
    if (!available) {
      window.alert(`Room ${newRoom} has an overlapping reservation for this date range.`);
      return;
    }
    const target = rooms.find((r) => r.roomNumber === newRoom);
    const current = rooms.find((r) => r.roomNumber === moveRoomStay.roomNumber);
    if (!target || !current) {
      window.alert("Room not found.");
      return;
    }
    if ((target.roomType || "") !== (current.roomType || "")) {
      window.alert("Room type must match. Use Upgrade Room for different type.");
      return;
    }
    if (target.status === "OOO" || target.status === "Occupied") {
      window.alert("Target room is not available.");
      return;
    }

    try {
      await runTransaction(db, async (tx) => {
        const stayRef = doc(db, "stays", moveRoomStay.id);
        const oldRoomRef = doc(db, "rooms", moveRoomStay.roomNumber);
        const newRoomRef = doc(db, "rooms", newRoom);

        const [staySnap, newRoomSnap] = await Promise.all([tx.get(stayRef), tx.get(newRoomRef)]);
        if (!staySnap.exists()) throw new Error("Stay not found.");
        const s = staySnap.data();
        if (s.status !== "open") throw new Error("Stay not open.");
        if (!newRoomSnap.exists()) throw new Error("New room not found.");
        const nr = newRoomSnap.data();
        if (nr.status === "OOO" || nr.status === "Occupied") throw new Error("Target room unavailable.");

        tx.update(stayRef, { roomNumber: newRoom, movedAt: new Date(), movedBy: actorName });
        tx.update(oldRoomRef, { status: "Vacant Dirty" });
        tx.update(newRoomRef, { status: "Occupied" });
      });

      await logAction("room.move", { from: moveRoomStay.roomNumber, to: newRoom, stayId: moveRoomStay.id });
      window.alert(`Moved to room ${newRoom}.`);
      setMoveRoomStay(null);
      setNewRoom("");
      await load();
    } catch (err) {
      window.alert(err.message || String(err));
    }
  };

  // Upgrade after check-in
  const upgradeOptions = useMemo(() => {
    if (!upgradeStay) return [];
    const cur = rooms.find((r) => r.roomNumber === upgradeStay.roomNumber);
    const curType = cur?.roomType || null;
    return rooms
      .filter((r) => r.status !== "OOO" && r.status !== "Occupied" && r.roomType !== curType)
      .map((r) => ({ value: r.roomNumber, label: `${r.roomNumber} (${r.roomType})` }));
  }, [rooms, upgradeStay]);

  const doUpgradeRoom = async () => {
    if (isNightAuditClosed(reservation)) {
      alert("Cannot upgrade room after night audit. Please use adjustments instead.");
      return;
    }
    if (!canUpgrade || !upgradeStay || !upgradeRoom) return;

    const available = await isRoomAvailableForRes(reservation, upgradeRoom);
    if (!available) {
      window.alert(`Room ${upgradeRoom} has an overlapping reservation for this date range.`);
      return;
    }

    const target = rooms.find((r) => r.roomNumber === upgradeRoom);
    const current = rooms.find((r) => r.roomNumber === upgradeStay.roomNumber);
    if (!target || !current) {
      window.alert("Room not found.");
      return;
    }
    if (target.status === "OOO" || target.status === "Occupied") {
      window.alert("Target room is not available.");
      return;
    }

    const delta = await computeUpgradeDelta(reservation, guest, current.roomType, target.roomType, true);
    const ok = window.confirm(
      `Upgrade ${current.roomNumber} (${current.roomType}) ➜ ${target.roomNumber} (${target.roomType})
Adjustment for remaining nights: ${currency} ${fmtMoney(delta)}.
Proceed?`
    );
    if (!ok) return;

    try {
      await runTransaction(db, async (tx) => {
        const stayRef = doc(db, "stays", upgradeStay.id);
        const oldRoomRef = doc(db, "rooms", upgradeStay.roomNumber);
        const newRoomRef = doc(db, "rooms", upgradeRoom);

        const [staySnap, newRoomSnap] = await Promise.all([tx.get(stayRef), tx.get(newRoomRef)]);
        if (!staySnap.exists()) throw new Error("Stay not found.");
        const s = staySnap.data();
        if (s.status !== "open") throw new Error("Stay not open.");
        if (!newRoomSnap.exists()) throw new Error("New room not found.");
        const nr = newRoomSnap.data();
        if (nr.status === "OOO" || nr.status === "Occupied") throw new Error("Target room unavailable.");

        tx.update(stayRef, { roomNumber: upgradeRoom, movedAt: new Date(), movedBy: actorName });
        tx.update(oldRoomRef, { status: "Vacant Dirty" });
        tx.update(newRoomRef, { status: "Occupied" });

        const adjRef = doc(collection(db, "postings"));
        tx.set(adjRef, {
          reservationId: reservation.id,
          stayId: upgradeStay.id,
          roomNumber: upgradeRoom,
          description: "Room upgrade adjustment (remaining nights)",
          amount: delta,
          tax: 0,
          service: 0,
          status: "posted",
          accountCode: "ADJ",
          createdAt: new Date(),
          createdBy: actorName
        });
      });

      await logAction("room.upgrade.afterCheckIn", { from: current.roomNumber, to: upgradeRoom, delta });
      window.alert("Upgrade done and adjustment posted.");
      setUpgradeStay(null);
      setUpgradeRoom("");
      await load();
    } catch (err) {
      window.alert(err.message || String(err));
    }
  };

  // Upgrade before check-in
  const preUpgradeOptions = useMemo(() => {
    if (upgradeIndex == null) return [];
    const currentRM = assignRooms[upgradeIndex];
    const curType = currentRM ? rooms.find((r) => r.roomNumber === currentRM)?.roomType : null;
    return rooms
      .filter((r) => r.status !== "OOO" && r.status !== "Occupied" && (!curType || r.roomType !== curType))
      .map((r) => ({ value: r.roomNumber, label: `${r.roomNumber} (${r.roomType})` }));
  }, [rooms, assignRooms, upgradeIndex]);

  const doUpgradePreCheckIn = async () => {
    if (!canUpgrade || upgradeIndex == null || !upgradePreRoom) return;

    const available = await isRoomAvailableForRes(reservation, upgradePreRoom);
    if (!available) {
      window.alert(`Room ${upgradePreRoom} has an overlapping reservation for this date range.`);
      return;
    }

    const target = rooms.find((r) => r.roomNumber === upgradePreRoom);
    const currentRM = assignRooms[upgradeIndex];
    const current = currentRM ? rooms.find((r) => r.roomNumber === currentRM) : null;
    if (!target) { window.alert("Target room not found."); return; }
    if (target.status === "OOO" || target.status === "Occupied") {
      window.alert("Target room not available.");
      return;
    }

    const oldType = current?.roomType || rooms.find((r) => r.roomNumber === currentRM)?.roomType;
    const newType = target.roomType;
    // compute delta using channels state
    const delta = await computeUpgradeDelta(reservation, guest, oldType, newType, false);

    const ok = window.confirm(
      `Upgrade before check-in:\n${current?.roomNumber || currentRM} (${oldType}) ➜ ${target.roomNumber} (${newType})\n` +
      `Adjustment for entire stay: ${currency} ${fmtMoney(delta)}.\nProceed?`
    );
    if (!ok) return;

    try {
      const next = [...assignRooms];
      next[upgradeIndex] = target.roomNumber;
      setAssignRooms(next);
      await persistAssignmentAndForecast(next);

      if (delta !== 0) {
        try {
          await addDoc(collection(db, "postings"), {
            reservationId: reservation.id,
            stayId: null,
            roomNumber: target.roomNumber,
            description: "Room upgrade adjustment (pre check-in)",
            amount: delta,
            tax: 0,
            service: 0,
            status: "forecast",
            accountCode: "ADJ",
            createdAt: new Date(),
            createdBy: actorName
          });
        } catch (err) {
          console.log("doUpgradePreCheckIn: failed to create ADJ posting", err);
        }
      }

      await logAction("room.upgrade.beforeCheckIn", {
        index: upgradeIndex,
        to: target.roomNumber,
        delta
      });

      window.alert("Pre check-in upgrade applied. Forecast updated.");
      setUpgradeIndex(null);
      setUpgradePreRoom("");
      await load();
    } catch (err) {
      window.alert(err.message || String(err));
    }
  };

  // Handlers for charge/payment
  const submitCharge = async () => {
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description.trim()) { window.alert("Description is required."); return; }
    if (total <= 0) { window.alert("Unit amount and quantity must produce a total > 0."); return; }
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
      await logAction("posting.add", { description: chargeForm.description.trim(), amount: total });
      setShowAddCharge(false);
      setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
      await load();
    } catch (err) {
      console.log("submitCharge: error", err);
      window.alert("Failed to add charge.");
    }
  };

  const submitPayment = async () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) { window.alert("Payment amount must be greater than 0."); return; }
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
      await logAction("payment.add", {
        amount: amt,
        method: paymentForm.method || "cash",
        refNo: paymentForm.refNo || ""
      });
      setShowAddPayment(false);
      setPaymentForm({ amountStr: "", method: "cash", refNo: "", type: "payment" });
      await load();
    } catch (err) {
      console.log("submitPayment: error", err);
      window.alert("Failed to add payment.");
    }
  };

  // Check-in / Check-out
  const doCheckIn = async () => {
    if (isNightAuditClosed(reservation)) { window.alert("Cannot check in after night audit. Please contact admin."); return; }
    if (!reservation || (reservation.status || "").toLowerCase() !== "booked") {
      window.alert("Reservation is not in 'booked' status."); return;
    }
    if (!assignRooms.length) { window.alert("No rooms selected."); return; }
    for (let idx = 0; idx < assignRooms.length; idx++) {
      const roomNumber = assignRooms[idx];
      const r = rooms.find(x => x.roomNumber === roomNumber);
      if (!r) { window.alert(`Room ${roomNumber} not found.`); return; }
      if (r.status === "OOO" || r.status === "Occupied") { window.alert(`Room ${roomNumber} is not available.`); return; }
      const lockType = roomTypeAtIndex(idx);
      if (lockType && r.roomType !== lockType) {
        window.alert(`Room ${roomNumber} type mismatch (${r.roomType} vs ${lockType}). Use Upgrade Room.`);
        return;
      }
      if (!await isRoomAvailableForRes(reservation, roomNumber)) {
        window.alert(`Room ${roomNumber} has an overlapping reservation for this date range.`); return;
      }
    }
    try {
      const stayMap = {};
      await runTransaction(db, async (tx) => {
        const resRef = doc(db, "reservations", reservation.id);
        const resSnap = await tx.get(resRef);
        if (!resSnap.exists()) throw new Error("Reservation not found.");
        const res = resSnap.data();
        if ((res.status || "").toLowerCase() !== "booked") throw new Error(`Cannot check-in reservation with status ${res.status}.`);

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
          stayMap[roomNumber] = stayRef.id;
          tx.update(doc(db, "rooms", roomNumber), { status: "Occupied" });
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });

      await convertForecastsToPosted(stayMap);
      await logAction("checkin", { rooms: assignRooms });
      window.alert("Check-in complete. Room charges posted.");
      await load();
    } catch (err) {
      console.log("doCheckIn: error", err);
      window.alert(err.message || String(err));
    }
  };

  const doCheckOut = async () => {
    
    if (displayBalance > 0.01 && !canOverrideBilling) {
      window.alert(`Cannot check out. Outstanding balance: ${currency} ${fmtMoney(displayBalance)}.`);
      return;
    }
    try {
      await runTransaction(db, async (tx) => {
        for (const s of stays.filter(x => x.status === "open")) {
          tx.update(doc(db, "stays", s.id), { status: "closed", closedAt: new Date() });
          tx.update(doc(db, "rooms", s.roomNumber), { status: "Vacant Dirty" });
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

      const qOpen = query(
        collection(db, "stays"),
        where("reservationId", "==", reservation.id),
        where("status", "==", "open")
      );
      if ((await getDocs(qOpen)).empty) {
        await updateDoc(doc(db, "reservations", reservation.id), { status: "checked-out", checkedOutAt: new Date() });
      }
      await logAction("checkout", {});
      window.alert("Checked out.");
      await load();
    } catch (err) {
      console.log("doCheckOut: error", err);
      window.alert(err.message || String(err));
    }
  };

  // Print handlers: gate printing by reservation status
  const printCheckInForm = () => {
    if (!reservation || (reservation.status || "").toLowerCase() !== "checked-in") {
      window.alert("Cannot print check-in form until reservation is checked-in.");
      return;
    }
    setPrintMode("checkin");
    setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 50);
  };

  const printCheckOutBill = () => {
    if (!reservation || (reservation.status || "").toLowerCase() !== "checked-out") {
      window.alert("Cannot print check-out bill until reservation is checked-out.");
      return;
    }
    setPrintMode("checkout");
    setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 50);
  };

  // Render helpers
  const renderAssignmentRow = (idx) => {
    const val = assignRooms[idx] || "";
    const options = assignmentOptionsForIndex(idx);
    return (
      <div key={idx} style={{ marginBottom: 6 }}>
        <select
          value={val}
          onChange={async (e) => {
            const nextVal = e.target.value;
            const lockType = roomTypeAtIndex(idx);
            const selectedRoom = rooms.find((r) => r.roomNumber === nextVal);
            const selectedType = selectedRoom?.roomType;

            if (lockType && selectedType && lockType !== selectedType) {
              window.alert(`Room type must remain ${lockType}. Use Upgrade Room for different type.`);
              return;
            }
            if (!selectedRoom) { window.alert("Room not found."); return; }
            if (selectedRoom.status === "OOO" || selectedRoom.status === "Occupied") {
              window.alert("Selected room is not available.");
              return;
            }
            const available = await isRoomAvailableForRes(reservation, nextVal);
            if (!available) {
              window.alert(`Room ${nextVal} has an overlapping reservation in this date range.`);
              return;
            }

            const nextAssign = [...assignRooms];
            nextAssign[idx] = nextVal;
            setAssignRooms(nextAssign);
            await persistAssignmentAndForecast(nextAssign);
          }}
        >
          <option value="">Select room</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    );
  };

  // If still loading or reservation not loaded, show loading UI
  if (loading || !reservation) {
    return <div className="reservations-container"><h2>Reservation Detail</h2><div>Loading…</div></div>;
  }

  // Pass everything needed to presentational children
  return (
    <div>
      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        settings={settings}
        rooms={rooms}
        assignRooms={assignRooms}
        renderAssignmentRow={renderAssignmentRow}
        setAssignRooms={setAssignRooms}
        canOperate={canOperate}
        canUpgrade={canUpgrade}
        doCheckIn={doCheckIn}
        printCheckInForm={printCheckInForm}
        upgradeIndex={upgradeIndex}
        setUpgradeIndex={setUpgradeIndex}
        preUpgradeOptions={preUpgradeOptions}
        upgradePreRoom={upgradePreRoom}
        setUpgradePreRoom={setUpgradePreRoom}
        doUpgradePreCheckIn={doUpgradePreCheckIn}
        stays={stays}
        setMoveRoomStay={setMoveRoomStay}
        setUpgradeStay={setUpgradeStay}
        canOverrideBilling={canOverrideBilling}
        doCheckOut={doCheckOut}
        printCheckOutBill={printCheckOutBill}
        moveRoomStay={moveRoomStay}
        newRoom={newRoom}
        setNewRoom={setNewRoom}
        sameTypeOptions={sameTypeOptions}
        doChangeRoom={doChangeRoom}
        upgradeStay={upgradeStay}
        upgradeRoom={upgradeRoom}
        setUpgradeRoom={setUpgradeRoom}
        upgradeOptions={upgradeOptions}
        doUpgradeRoom={doUpgradeRoom}
        handleDeleteReservation={handleDeleteReservation}
        isAdmin={isAdmin}
        navigate={navigate}
        fmt={fmt}
      />

      <ReservationDetailC
        printRef={printRef}
        printMode={printMode}
        reservation={reservation}
        settings={settings}
        fmtDMY={fmtDMY}
        calcNights={calcNights}
        adultsChildren={adultsChildren}
        assignRooms={assignRooms}
        rooms={rooms}
        postings={postings}
        visiblePostings={visiblePostings}
        displayChargeLines={displayChargeLines}
        displayChargesTotal={displayChargesTotal}
        displayPaymentsTotal={displayPaymentsTotal}
        displayBalance={displayBalance}
        payments={payments}
        canOperate={canOperate}
        isAdmin={isAdmin}
        // pass add-charge/payment props if you used them in parent:
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
        // delete modal props:
        showDeleteModal={showDeleteModal}
        deleteReason={deleteReason}
        setDeleteReason={setDeleteReason}
        deleting={deleting}
        closeDeleteModal={closeDeleteModal}
        deleteReservation={deleteReservation}
        confirmDeleteReservation={confirmDeleteReservation}
        guest={guest}
        fmt={fmt}
      />
    </div>
  );
}
