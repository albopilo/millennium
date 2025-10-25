// src/pages/ReservationDetailA.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "firebase/firestore";
import { db } from "../firebase";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";
import useMountLogger from "../hooks/useMountLogger";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailA (full rewrite)
 *
 * - Preserves original business logic (createForecastRoomPostings, ensureDepositPosting,
 *   convertForecastsToPosted, submitCharge, submitPayment, doCheckIn, doCheckOut, printing, logs).
 * - No UI debounce: all inputs are immediate; numeric parsing happens at submit time.
 * - Optimistic UI updates for charges/payments with rollback on failure.
 * - Realtime subscriptions replace optimistic entries with canonical database rows.
 * - Defensive handling of Firestore Timestamp / string / number date formats.
 * - Detailed comments kept to map to original responsibilities.
 */

export default function ReservationDetailA({ permissions = [], currentUser = null, userData = null }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName = (currentUser && (currentUser.displayName || currentUser.email)) || "frontdesk";

  // Mount logs for debugging lifecycle (keeps prior behavior)
  useMountLogger("ReservationDetailA", { id });
  useMountLogger("ReservationDetailB + FolioCard", { note: "may or may not render depending on printMode" });
  useMountLogger("ReservationDetailC", { note: "may or may not render depending on printMode" });

  // ---------- Permissions helpers ----------
  const can = useCallback((p) => permissions.includes(p) || permissions.includes("*"), [permissions]);
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");
  const canUpgrade = can("canUpgradeRoom") || can("canOverrideRoomType");
  const canOverrideBilling = can("canOverrideBilling");
  const isAdmin = userData?.roleId === "admin";

  // ---------- Core state ----------
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

  // UI state (no debounce)
  const [assignRooms, setAssignRooms] = useState([]);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [chargeForm, setChargeForm] = useState({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amountStr: "", method: "cash", refNo: "", type: "payment" });

  // printing
  const printRef = useRef(null);
  const [printMode, setPrintMode] = useState(null);
  const printReadyResolverRef = useRef(null);
  function createPrintReadyPromise() {
    return new Promise((resolve) => {
      printReadyResolverRef.current = resolve;
    });
  }

  // defensive refs (prevent concurrent forecast generation)
  const creatingForecastsRef = useRef(false);
  const skippedZeroRateWarningsRef = useRef(new Set());
  // mounted guard
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ---------- Small helpers ----------
  const onlyDigits = (s) => (s || "").toString().replace(/[^\d]/g, "");
  const toInt = (s) => {
    const k = onlyDigits(s);
    return k ? parseInt(k, 10) : 0;
  };
  const fmtIdr = (n) => `IDR ${Number(n || 0).toLocaleString("id-ID")}`;
  const statusOf = (d) => ((d?.status || "") + "").toLowerCase();
  const acctOf = (d) => ((d?.accountCode || "") + "").toUpperCase();

  // Robust parseToDate that accepts Firestore Timestamp, number, Date, ISO string
  const parseToDate = (raw) => {
    if (raw == null) return null;
    try {
      if (typeof raw.toDate === "function") return raw.toDate();
      if (raw && typeof raw.seconds === "number") return new Date(Number(raw.seconds) * 1000);
      if (raw instanceof Date) return raw;
      if (typeof raw === "number") return new Date(raw);
      if (typeof raw === "string") {
        const d = new Date(raw);
        return isNaN(d.getTime()) ? null : d;
      }
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  };

  const fmt = (raw) => {
    const d = parseToDate(raw);
    if (!d) return "-";
    return d.toLocaleString();
  };

  // ---------- Date utilities ----------
  const datesInStay = (resObj) => {
    if (!resObj?.checkInDate || !resObj?.checkOutDate) return [];
    const a = parseToDate(resObj.checkInDate);
    const b = parseToDate(resObj.checkOutDate);
    if (!a || !b) return [];
    const out = [];
    const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    while (cur < b) {
      out.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  };
  const sameMonthDay = (d1, d2) => {
    if (!d1 || !d2) return false;
    return d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  };

  // ---------- rateFor: multi-fallback ----------
  const rateFor = (roomType, channelName, date, roomDoc = null, channelList = null) => {
    const normalize = (s) => (s || "").toString().trim().toLowerCase();
    const channelId = normalize(channelName);
    const rtype = (roomType || "").trim();

    // 1) rates table first
    let rd = rates.find((r) => normalize(r.roomType) === normalize(rtype) && normalize(r.channelId) === channelId);
    if (!rd) rd = rates.find((r) => normalize(r.roomType) === normalize(rtype));
    if (rd) {
      if (channelId === "direct") {
        const day = date.getDay();
        const weekend = day === 0 || day === 6;
        return Number(weekend ? rd.weekendRate || 0 : rd.weekdayRate || 0);
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

  // ---------- ensureDepositPosting (canonical deposit) ----------
  async function ensureDepositPosting(resObj, assignedRooms = []) {
    if (!resObj?.id) return;
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
        await setDoc(
          depositRef,
          {
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
            createdBy: primary.createdBy || actorName,
          },
          { merge: true }
        );
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

    // create canonical deposit posting
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
        createdBy: actorName,
      });
    } catch (err) {
      console.log("ensureDepositPosting: create fail", err);
    }
  }

  // ---------- createForecastRoomPostings — per-room-per-night ----------
  const createForecastRoomPostings = async (resObj, assigned = [], g = null, allRooms = [], channelList = null) => {
    if (!resObj) return;
    if (creatingForecastsRef.current) return;
    creatingForecastsRef.current = true;
    try {
      const nights = datesInStay(resObj);
      // loyalty pct logic (copied)
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
          // events override
          let base = 0;
          const ev = events.find((ev) => {
            const s = parseToDate(ev.startDate);
            const e = parseToDate(ev.endDate);
            if (!s || !e) return false;
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
              console.warn(
                `createForecastRoomPostings: skipping zero base rate for ${roomNumber} on ${d.toISOString()}`,
                { roomDoc, ev, base }
              );
            }
            continue;
          }

          let net = Number(base) * (1 - pct);

          if (applyBirthday && bday && sameMonthDay(d, bday)) {
            if ((g?.tier || "").toLowerCase() === "silver") {
              if (idx === 0) net -= Number(base) * 0.5;
            } else if ((g?.tier || "").toLowerCase() === "gold") {
              if (
                (roomDoc.roomType || "").toLowerCase() === "deluxe" &&
                (!firstDeluxeAssigned || firstDeluxeAssigned.roomNumber === roomDoc.roomNumber)
              ) {
                net -= Number(base);
              }
            }
            if (net < 0) net = 0;
          }

          const description = `Room charge ${roomDoc.roomType} ${d.toISOString().slice(0, 10)}`;

          const alreadyExists = existingPostings.some((ep) => {
            const sameAccount = (ep.accountCode || "").toUpperCase() === "ROOM";
            const sameRoom = ep.roomNumber === roomNumber;
            const sameDesc =
              ((ep.description || "") + "").trim().toLowerCase() === (description + "").trim().toLowerCase();
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
              createdBy: actorName,
            });
            existingPostings.push({
              id: ref.id,
              reservationId: resObj.id,
              roomNumber,
              description,
              accountCode: "ROOM",
              status: "forecast",
              amount: Math.round(net),
            });
          } catch (err) {
            console.log("createForecastRoomPostings: addDoc failed", err);
          }
        }
      }
    } finally {
      creatingForecastsRef.current = false;
    }
  };

  // ---------- convertForecastsToPosted ----------
  async function convertForecastsToPosted(stayMapByRoom = {}) {
    if (!reservation?.id) return;
    const snap = await getDocs(query(collection(db, "postings"), where("reservationId", "==", reservation.id)));
    const forecasts = snap.docs.filter((d) => {
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

  // ---------- Load everything ----------
  const load = useCallback(
    async (opts = { skipRealtimeSubs: false }) => {
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
          navigate("/calendar");
          return;
        }
        const res = { id: resSnap.id, ...resSnap.data() };
        if ((res.status || "").toLowerCase() === "deleted") {
          navigate("/calendar");
          return;
        }

        if (!mountedRef.current) return;

        setReservation(res);
        setRooms(roomsSnap.docs.map((d) => d.data()));
        if (settingsSnap.exists()) setSettings(settingsSnap.data());
        setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setChannels(channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        const initialAssigned = Array.isArray(res.roomNumbers)
          ? [...res.roomNumbers]
          : res.roomNumber
          ? [res.roomNumber]
          : [];
        setAssignRooms(initialAssigned);

        // guest lookup heuristics
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
          getDocs(query(collection(db, "payments"), where("reservationId", "==", res.id))),
        ]);
        setStays(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        // Do not stomp local optimistic entries here; we set authoritative lists but merge intelligently below
        setPostings((prev) => {
          // Keep any optimistic temp_ entries while adding authoritative ones (avoid duplicates)
          const temps = (prev || []).filter((p) => p.id && p.id.toString().startsWith("temp_"));
          const official = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          // Remove temps that have been replaced by official records by matching description+amount+accountCode roughly
          const cleanedTemps = temps.filter((t) => {
            return !official.some(
              (o) =>
                (o.description || "") === (t.description || "") &&
                Number(o.amount || 0) === Number(t.amount || 0) &&
                (o.accountCode || "").toUpperCase() === (t.accountCode || "").toUpperCase()
            );
          });
          return [...cleanedTemps, ...official];
        });
        setPayments((prev) => {
          const temps = (prev || []).filter((p) => p.id && p.id.toString().startsWith("temp_"));
          const official = paySnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const cleanedTemps = temps.filter((t) => {
            return !official.some(
              (o) =>
                Number(o.amount || 0) === Number(t.amount || 0) &&
                (o.method || "") === (t.method || "") &&
                (o.refNo || "") === (t.refNo || "")
            );
          });
          return [...cleanedTemps, ...official];
        });

        // create forecasts & deposit if needed (preserve behavior)
        if ((res.status || "").toLowerCase() === "booked" && initialAssigned.length > 0) {
          const pList = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const hasForecastRoom = pList.some(
            (p) => (p.status || "posted") === "forecast" && p.accountCode === "ROOM"
          );
          if (!hasForecastRoom) {
            await createForecastRoomPostings(
              res,
              initialAssigned,
              g,
              roomsSnap.docs.map((d) => d.data()),
              channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
            );
          }
          await ensureDepositPosting(res, initialAssigned);
          // refresh postings after deposit creation
          const p2 = await getDocs(query(collection(db, "postings"), where("reservationId", "==", res.id)));
          if (mountedRef.current) setPostings((prev) => {
            // same merge behavior as above to preserve temp entries
            const temps = (prev || []).filter((p) => p.id && p.id.toString().startsWith("temp_"));
            const official = p2.docs.map((d) => ({ id: d.id, ...d.data() }));
            const cleanedTemps = temps.filter((t) => {
              return !official.some(
                (o) =>
                  (o.description || "") === (t.description || "") &&
                  Number(o.amount || 0) === Number(t.amount || 0) &&
                  (o.accountCode || "").toUpperCase() === (t.accountCode || "").toUpperCase()
              );
            });
            return [...cleanedTemps, ...official];
          });
        }
      } catch (err) {
        console.error("load error", err);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [id, navigate]
  );

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // ---------- Realtime subscriptions (logs, postings, payments) ----------
  useEffect(() => {
    if (!reservation?.id) return;

    // logs subscription (per-reservation subcollection)
    const logsRef = collection(doc(db, "reservations", reservation.id), "logs");
    const qLogs = query(logsRef, orderBy("createdAt", "desc"));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      if (!mountedRef.current) return;
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    // postings subscription
    const qPostings = query(collection(db, "postings"), where("reservationId", "==", reservation.id));
    const unsubPostings = onSnapshot(qPostings, (snap) => {
      if (!mountedRef.current) return;
      const fresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPostings((prev) => {
        // keep any optimistic temp_ entries that are not matched by fresh entries
        const temps = (prev || []).filter((p) => p.id && p.id.toString().startsWith("temp_"));
        // remove temps that match fresh entries by description+amount+accountCode
        const legitTemps = temps.filter((t) => {
          return !fresh.some(
            (f) =>
              (f.description || "") === (t.description || "") &&
              Number(f.amount || 0) === Number(t.amount || 0) &&
              (f.accountCode || "").toUpperCase() === (t.accountCode || "").toUpperCase()
          );
        });
        return [...legitTemps, ...fresh];
      });
    });

    // payments subscription
    const qPayments = query(collection(db, "payments"), where("reservationId", "==", reservation.id));
    const unsubPayments = onSnapshot(qPayments, (snap) => {
      if (!mountedRef.current) return;
      const fresh = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setPayments((prev) => {
        const temps = (prev || []).filter((p) => p.id && p.id.toString().startsWith("temp_"));
        const legitTemps = temps.filter((t) => {
          return !fresh.some(
            (f) =>
              Number(f.amount || 0) === Number(t.amount || 0) &&
              (f.method || "") === (t.method || "") &&
              (f.refNo || "") === (t.refNo || "")
          );
        });
        return [...legitTemps, ...fresh];
      });
    });

    return () => {
      try {
        unsubLogs && unsubLogs();
        unsubPostings && unsubPostings();
        unsubPayments && unsubPayments();
      } catch (e) {
        // ignore unsubscribe errors
      }
    };
  }, [reservation?.id]);

  // ---------- Submit charge (zero debounce, optimistic) ----------
  const submitCharge = async () => {
    // parse only on submit
    const qty = Math.max(1, toInt(chargeForm.qtyStr));
    const unit = Math.max(0, toInt(chargeForm.unitStr));
    const total = qty * unit;
    if (!chargeForm.description?.trim()) {
      alert("Description required");
      return;
    }
    if (total <= 0) {
      alert("Total must be > 0");
      return;
    }
    const status = (reservation?.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";
    const optimistic = {
      id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
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
      createdBy: actorName,
    };

    // optimistic UI
    setPostings((prev) => [...(prev || []), optimistic]);
    // close modal immediately for snappy UX
    setShowAddCharge(false);
    // reset form immediately — zero debounce: user can type next
    setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });

    try {
      // store to firestore (without waiting for load)
      await addDoc(collection(db, "postings"), {
        reservationId: reservation.id,
        stayId: null,
        roomNumber: null,
        description: optimistic.description,
        amount: optimistic.amount,
        tax: optimistic.tax,
        service: optimistic.service,
        quantity: optimistic.quantity,
        unitAmount: optimistic.unitAmount,
        accountCode: optimistic.accountCode,
        status: optimistic.status,
        createdAt: new Date(),
        createdBy: actorName,
      });

      // Log (non-blocking)
      try {
        await logReservationChange("charge_added", {
          description: optimistic.description,
          amount: optimistic.amount,
          accountCode: optimistic.accountCode,
        });
      } catch (e) {
        console.warn("charge log failed", e);
      }
      // authoritative data will arrive via onSnapshot subscription and replace temp entry
    } catch (err) {
      console.error("submitCharge error", err);
      alert("Failed to add charge");
      // rollback optimistic
      setPostings((prev) => (prev || []).filter((p) => p.id !== optimistic.id));
    }
  };

  // ---------- Submit payment (zero debounce, optimistic) ----------
  const submitPayment = async () => {
    const amt = Math.max(0, toInt(paymentForm.amountStr));
    if (amt <= 0) {
      alert("Payment must be > 0");
      return;
    }

    const optimistic = {
      id: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      reservationId: reservation.id,
      stayId: null,
      method: paymentForm.method || "cash",
      amount: amt,
      refNo: paymentForm.refNo || "",
      capturedAt: new Date(),
      capturedBy: actorName,
      type: paymentForm.type || "payment",
    };

    // optimistic UI
    setPayments((prev) => [...(prev || []), optimistic]);
    setShowAddPayment(false);
    setPaymentForm({ amountStr: "", method: "cash", refNo: "", type: "payment" });

    try {
      await addDoc(collection(db, "payments"), {
        reservationId: reservation.id,
        stayId: null,
        method: optimistic.method,
        amount: optimistic.amount,
        refNo: optimistic.refNo,
        capturedAt: new Date(),
        capturedBy: actorName,
        type: optimistic.type,
      });

      try {
        await logReservationChange("payment_added", { amount: optimistic.amount, method: optimistic.method, refNo: optimistic.refNo });
      } catch (e) {
        console.warn("payment log failed", e);
      }
      // onSnapshot will replace optimistic with authoritative
    } catch (err) {
      console.error("submitPayment error", err);
      alert("Failed to add payment");
      setPayments((prev) => (prev || []).filter((p) => p.id !== optimistic.id));
    }
  };

  // ---------- Logging helper ----------
  async function logReservationChange(action, details = {}) {
    if (!reservation?.id) return;
    try {
      const collRef = collection(doc(db, "reservations", reservation.id), "logs");
      await addDoc(collRef, {
        action,
        details,
        createdAt: new Date(),
        createdBy: actorName,
      });
    } catch (err) {
      console.error("Failed to log reservation change", action, err);
    }
  }

  // ---------- Edit / Delete ----------
  async function handleEditReservation(updates = {}) {
    if (!reservation?.id) return;
    const newData = { ...updates, updatedAt: new Date(), updatedBy: actorName };
    try {
      await updateDoc(doc(db, "reservations", reservation.id), newData);
      await logReservationChange("edit", { updates: newData });
      alert("Reservation updated");
      await load();
    } catch (err) {
      console.error("Edit failed", err);
      alert("Failed to edit reservation");
    }
  }

  async function handleDeleteReservation() {
    if (!reservation?.id) return;
    if (!window.confirm("Delete this reservation? This cannot be undone.")) return;
    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
        status: "deleted",
        deletedAt: new Date(),
        deletedBy: actorName,
      });
      await logReservationChange("delete", { reason: "manual delete" });
      alert("Reservation deleted");
      navigate("/calendar");
    } catch (err) {
      console.error("Delete failed", err);
      alert("Failed to delete reservation");
    }
  }

  // ---------- No show ----------
  async function doNoShow() {
    if (!reservation?.id) return;
    if ((reservation.status || "").toLowerCase() !== "booked") {
      alert("Only booked reservations can be marked as No Show");
      return;
    }
    if (!window.confirm("Mark this reservation as No Show?")) return;
    try {
      await updateDoc(doc(db, "reservations", reservation.id), {
        status: "no-show",
        noShowAt: new Date(),
        updatedBy: actorName,
      });
      await logReservationChange("no-show", { previousStatus: reservation.status });
      alert("Marked as No Show");
      await load();
    } catch (err) {
      console.error("No show failed", err);
      alert("Failed to mark as No Show");
    }
  }

  // ---------- Check-in / Check-out ----------
  const doCheckIn = async () => {
    if (!reservation) return;
    if ((reservation.status || "").toLowerCase() !== "booked") {
      alert("Reservation is not booked");
      return;
    }
    if (!assignRooms.length) {
      alert("Assign at least one room");
      return;
    }
    setLoading(true);
    try {
      const stayMap = {};
      await runTransaction(db, async (tx) => {
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
            createdBy: actorName,
          });
          stayMap[roomNumber] = stayRef.id;
          try {
            tx.update(doc(db, "rooms", roomNumber), { status: "Occupied" });
          } catch (err) {
            console.warn("Room status update failed; check your docId mapping", roomNumber, err);
          }
        }
        tx.update(resRef, { status: "checked-in", checkedInAt: new Date(), roomNumbers: assignRooms });
      });

      // convert forecasts & ensure deposit
      await convertForecastsToPosted(stayMap);
      await ensureDepositPosting(reservation, assignRooms);
      await logReservationChange("check_in", { roomNumbers: assignRooms });
      alert("Checked in");
      await load();
    } catch (err) {
      console.error("doCheckIn error", err);
      alert("Check-in failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  const doCheckOut = async () => {
    const charges = (postings || []).filter((p) => statusOf(p) !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const pays = (payments || []).filter((p) => statusOf(p) !== "void").reduce((s, p) => s + Number(p.amount || 0), 0);
    const balance = charges - pays;
    if (balance > 0.01 && !canOverrideBilling) {
      alert(`Outstanding ${fmtIdr(balance)}. Override required to check out.`);
      return;
    }
    setLoading(true);
    try {
      await runTransaction(db, async (tx) => {
        const openStays = stays.filter((s) => (s.status || "") === "open");
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
            reservationId: reservation.id,
          });
        }
        tx.update(doc(db, "reservations", reservation.id), { status: "checked-out", checkedOutAt: new Date() });
      });
      await logReservationChange("check_out", {});
      alert("Checked out");
      await load();
    } catch (err) {
      console.error("doCheckOut error", err);
      alert("Check-out failed: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // ---------- Print handlers ----------
  async function printCheckInForm() {
    if (!reservation) return;
    const status = (reservation.status || "").toLowerCase();
    if (status !== "checked-in") {
      alert("Reservation must be checked-in before printing check-in form.");
      return;
    }
    const readyPromise = createPrintReadyPromise();
    setPrintMode("checkin");
    try {
      await Promise.race([readyPromise, new Promise((r) => setTimeout(r, 2000))]);
      window.print();
    } finally {
      setTimeout(() => setPrintMode(null), 300);
      printReadyResolverRef.current = null;
    }
  }

  async function printCheckOutForm() {
    if (!reservation) return;
    const status = (reservation.status || "").toLowerCase();
    if (status !== "checked-out") {
      alert("Reservation must be checked-out before printing check-out form.");
      return;
    }
    const readyPromise = createPrintReadyPromise();
    setPrintMode("checkout");
    try {
      await Promise.race([readyPromise, new Promise((r) => setTimeout(r, 2000))]);
      window.print();
    } finally {
      setTimeout(() => setPrintMode(null), 300);
      printReadyResolverRef.current = null;
    }
  }

  // alias used by child
  const printCheckOutBill = printCheckOutForm;

  // ---------- Derived totals ----------
  const visiblePostings = useMemo(() => (postings || []).filter((p) => statusOf(p) !== "void"), [postings]);
  const displayChargeLines = useMemo(() => {
    const targetStatus = (reservation?.status || "").toLowerCase() === "booked" ? "forecast" : "posted";
    return visiblePostings.filter((p) => statusOf(p) === targetStatus && acctOf(p) !== "PAY");
  }, [visiblePostings, reservation]);
  const displayChargesTotal = useMemo(
    () => displayChargeLines.reduce((s, p) => s + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0),
    [displayChargeLines]
  );
  const displayPaymentsTotal = useMemo(
    () => (payments || []).filter((p) => statusOf(p) !== "void" && statusOf(p) !== "refunded").reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments]
  );
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // ---------- Small presentational components ----------
  function Card({ title, children, style = {} }) {
    return (
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          marginBottom: 16,
          ...style,
        }}
      >
        {title && <h3 style={{ marginTop: 0 }}>{title}</h3>}
        {children}
      </div>
    );
  }

  function FolioCard() {
    return (
      <Card title="Folio & Payments">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <div>
              <b>Charges</b>: {fmtIdr(displayChargesTotal)}
            </div>
            <div>
              <b>Payments</b>: {fmtIdr(displayPaymentsTotal)}
            </div>
            <div>
              <b>Balance</b>: {fmtIdr(displayBalance)}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setShowAddCharge(true)} className="btn">
              Add Charge
            </button>
            <button onClick={() => setShowAddPayment(true)} className="btn">
              Add Payment
            </button>
            {canOverrideBilling && (
              <button onClick={() => alert("Override billing flow (not implemented)")} className="btn">
                Override
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <h4 style={{ marginBottom: 8 }}>Itemized Charges</h4>
          {displayChargeLines.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No charges</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {displayChargeLines.map((p) => (
                <li key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eee" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{p.description}</div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>
                      {p.accountCode} {p.roomNumber ? `· Room ${p.roomNumber}` : ""}
                      {p.id && p.id.toString().startsWith("temp_") && <span style={{ color: "#a0aec0", marginLeft: 8 }}>(pending)</span>}
                    </div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{fmtIdr(p.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <h4 style={{ marginBottom: 8 }}>Payments</h4>
          {payments.length === 0 ? (
            <div style={{ color: "#6b7280" }}>No payments</div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {payments.map((p) => (
                <li key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #eee" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {p.method}
                      {p.refNo ? ` · ${p.refNo}` : ""}
                      {p.id && p.id.toString().startsWith("temp_") && <span style={{ color: "#a0aec0", marginLeft: 8 }}>(pending)</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#6b7280" }}>{fmt(p.capturedAt)}</div>
                  </div>
                  <div style={{ fontWeight: 600 }}>{fmtIdr(p.amount)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    );
  }

  function LogCard() {
    if (logs.length === 0) {
      return (
        <div className="change-log-section">
          <div className="change-log-card">
            <div className="change-log-header">Change Log</div>
            <div className="log-empty">No changes logged yet.</div>
          </div>
        </div>
      );
    }

    const grouped = logs.reduce((acc, entry) => {
      const d = entry.createdAt?.toDate ? entry.createdAt.toDate() : parseToDate(entry.createdAt) || new Date();
      const dayKey = d.toISOString().slice(0, 10);
      if (!acc[dayKey]) acc[dayKey] = [];
      acc[dayKey].push({ ...entry, _dateObj: d });
      return acc;
    }, {});

    const badgeFor = (action) => {
      const a = (action || "").toLowerCase();
      if (a.includes("payment")) return "payment";
      if (a.includes("check_in")) return "checkin";
      if (a.includes("check_out")) return "checkout";
      if (a.includes("no-show") || a.includes("noshow")) return "noshow";
      if (a.includes("edit")) return "edit";
      if (a.includes("delete")) return "delete";
      return "";
    };

    const labelMap = {
      payment_added: "Payment Added",
      check_in: "Check In",
      check_out: "Check Out",
      no_show: "No Show",
      edit: "Edited",
      delete: "Deleted",
    };

    return (
      <div className="change-log-section">
        <div className="change-log-card">
          <div className="change-log-header">Change Log</div>

          {Object.entries(grouped).map(([day, entries]) => (
            <div key={day}>
              <div className="change-log-day">
                {new Date(day).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>

              {entries.map((entry) => {
                const time = entry._dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                const actionLabel = labelMap[entry.action] || (entry.action || "").replace(/_/g, " ").toUpperCase();
                const badge = badgeFor(entry.action);

                // ---- Build summary ----
                let summary = "";
                const details = entry.details || {};
                if (entry.action?.toLowerCase().includes("payment") && (details.amount || details.method)) {
                  const amountStr = details.amount ? fmtIdr(details.amount) : "-";
                  const methodStr = details.method || "-";
                  summary = `Amount: ${amountStr} • Method: ${methodStr}`;
                  if (details.refNo) summary += ` • Ref: ${details.refNo}`;
                } else if (details.before !== undefined || details.after !== undefined) {
                  summary = Object.entries(details)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ");
                } else if (typeof details === "object") {
                  summary = Object.entries(details)
                    .map(([k, v]) => `${k}: ${String(v)}`)
                    .join(", ");
                } else if (typeof details === "string") {
                  summary = details;
                }

                return (
                  <div key={entry.id} className={`log-entry card ${badge ? `log-${badge}` : ""}`}>
                    <div className="log-main">
                      <div className="log-action">
                        {badge && <span className={`log-badge ${badge}`}>{actionLabel}</span>}
                        {!badge && <strong>{actionLabel}</strong>}
                        {entry.createdBy && <span className="log-by"> • by {entry.createdBy}</span>}
                      </div>
                      {summary && <div className="log-summary">{summary}</div>}
                    </div>
                    <div className="log-meta">{time}</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---------- Add Charge Modal (no debounce) ----------
  function AddChargeModal({ open, onClose }) {
    if (!open) return null;
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", zIndex: 1200 }}>
        <div style={{ width: 520, maxWidth: "95%", background: "#fff", borderRadius: 8, padding: 16 }}>
          <h3>Add Charge</h3>

          <div style={{ marginTop: 8 }}>
            <label>Description</label>
            <input
              style={{ width: "100%" }}
              value={chargeForm.description}
              onChange={(e) => setChargeForm((s) => ({ ...s, description: e.target.value }))}
            />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <label>Qty</label>
              <input value={chargeForm.qtyStr} onChange={(e) => setChargeForm((s) => ({ ...s, qtyStr: onlyDigits(e.target.value) }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Unit (IDR)</label>
              <input value={chargeForm.unitStr} onChange={(e) => setChargeForm((s) => ({ ...s, unitStr: onlyDigits(e.target.value) }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label>Account</label>
              <select value={chargeForm.accountCode} onChange={(e) => setChargeForm((s) => ({ ...s, accountCode: e.target.value }))}>
                <option value="MISC">MISC</option>
                <option value="ROOM">ROOM</option>
                <option value="DEPOSIT">DEPOSIT</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button onClick={onClose}>Cancel</button>
            <button onClick={submitCharge} className="btn btn-primary">
              Save Charge
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Add Payment Modal (no debounce) ----------
  function AddPaymentModal({ open, onClose }) {
    if (!open) return null;
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", zIndex: 1200 }}>
        <div style={{ width: 420, maxWidth: "95%", background: "#fff", borderRadius: 8, padding: 16 }}>
          <h3>Add Payment</h3>
          <div style={{ marginTop: 8 }}>
            <label>Amount (IDR)</label>
            <input value={paymentForm.amountStr} onChange={(e) => setPaymentForm((s) => ({ ...s, amountStr: onlyDigits(e.target.value) }))} />
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Method</label>
            <select value={paymentForm.method} onChange={(e) => setPaymentForm((s) => ({ ...s, method: e.target.value }))}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="bank">Bank</option>
            </select>
          </div>
          <div style={{ marginTop: 8 }}>
            <label>Reference No</label>
            <input value={paymentForm.refNo} onChange={(e) => setPaymentForm((s) => ({ ...s, refNo: e.target.value }))} />
          </div>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
            <button onClick={onClose}>Cancel</button>
            <button onClick={submitPayment} className="btn btn-primary">
              Save Payment
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- Render ----------
  if (loading || !reservation) {
    return <div style={{ padding: 24 }}>Loading reservation…</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      {printMode ? (
        <ReservationDetailC
          printRef={printRef}
          printMode={printMode}
          onTemplatesLoaded={() => {
            if (printReadyResolverRef.current) {
              try {
                printReadyResolverRef.current();
              } catch (e) {
                /* noop */
              }
            }
          }}
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
            renderAssignmentRow={(i) => {
              const val = assignRooms[i] || "";
              // compute lockType from reservation original roomNumbers if present
              const lockTypeRoomNumber = Array.isArray(reservation?.roomNumbers) ? reservation.roomNumbers[i] : null;
              const lockType =
                lockTypeRoomNumber && rooms.find((r) => r.roomNumber === lockTypeRoomNumber)
                  ? rooms.find((r) => r.roomNumber === lockTypeRoomNumber).roomType
                  : null;
              const options = rooms.filter((r) => r.status !== "OOO" && r.status !== "Occupied" && (!lockType || r.roomType === lockType));
              return (
                <div key={i} style={{ marginBottom: 6 }}>
                  <select
                    value={val}
                    onChange={async (e) => {
                      const nextVal = e.target.value;
                      const next = [...assignRooms];
                      next[i] = nextVal;
                      setAssignRooms(next);
                      try {
                        await updateDoc(doc(db, "reservations", reservation.id), { roomNumbers: next });
                        // create forecasts & deposit for the new assignment
                        await createForecastRoomPostings({ ...reservation, roomNumbers: next }, next, guest, rooms, channels);
                        await ensureDepositPosting({ ...reservation, roomNumbers: next }, next);
                      } catch (err) {
                        console.error("setAssignRooms persist error", err);
                      }
                    }}
                  >
                    <option value="">Select room</option>
                    {options.map((r) => (
                      <option key={r.roomNumber} value={r.roomNumber}>
                        {r.roomNumber} ({r.roomType}) {r.status ? `[${r.status}]` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              );
            }}
            setAssignRooms={setAssignRooms}
            canOperate={canOperate}
            canUpgrade={canUpgrade}
            doCheckIn={doCheckIn}
            doCheckOut={doCheckOut}
            printCheckInForm={printCheckInForm}
            printCheckOutBill={printCheckOutBill}
            preUpgradeOptions={[]}
            sameTypeOptions={[]}
            upgradeOptions={[]}
            moveRoomStay={null}
            setMoveRoomStay={() => {}}
            newRoom={""}
            setNewRoom={() => {}}
            upgradeStay={null}
            setUpgradeStay={() => {}}
            upgradeRoom={null}
            setUpgradeRoom={() => {}}
            upgradeIndex={null}
            setUpgradeIndex={() => {}}
            upgradePreRoom={""}
            setUpgradePreRoom={() => {}}
            doUpgradePreCheckIn={() => {}}
            doUpgradeRoom={() => {}}
            stays={stays}
            doNoShow={doNoShow}
            handleEditReservation={handleEditReservation}
            handleDeleteReservation={handleDeleteReservation}
            navigate={navigate}
            isAdmin={isAdmin}
            fmt={fmt}
            logReservationChange={logReservationChange}
          />

          <div style={{ marginTop: 24 }}>
            <FolioCard />
          </div>

          <div style={{ marginTop: 16 }}>
            <LogCard />
          </div>

          <AddChargeModal open={showAddCharge} onClose={() => setShowAddCharge(false)} />
          <AddPaymentModal open={showAddPayment} onClose={() => setShowAddPayment(false)} />
        </>
      )}
    </div>
  );
}
