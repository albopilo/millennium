// src/utils/nightAudit.js
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  setDoc,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Helpers for Jakarta timezone (GMT+7)
 */
function nowInTZ(offsetHours = 7) {
  // returns Date object currently in target timezone
  const now = new Date();
  // get UTC ms, add offset
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const tzMs = utcMs + offsetHours * 3600 * 1000;
  return new Date(tzMs);
}

function startOfDayInTZ(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

/**
 * Determine business-day date (in timezone) for the audit run.
 * Business day is considered current date at hotel timezone (GMT+7).
 * "End of day" is 04:00 local time; this utility returns the "business day" that is being closed.
 */
function businessDayForRunTime(runDate = null, tzOffset = 7) {
  const now = runDate ? new Date(runDate) : nowInTZ(tzOffset);
  // If it's between 00:00 - 03:59 local time, it's still the previous business day for closing purposes
  const hours = now.getHours();
  if (hours < 4) {
    // previous day
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return startOfDayInTZ(prev);
  }
  return startOfDayInTZ(now);
}

/**
 * runNightAudit
 * - performs checks across reservations, stays, postings, payments, rooms
 * - returns { issues: [ ... ], summary: { ... } }
 * - optionally writes to nightAuditLogs if finalise === true
 *
 * WARNING: this is "best-effort" aggregator — adapt to other domain specifics
 */
export async function runNightAudit({ runBy = "system", finalize = false, tzOffset = 7 } = {}) {
  const runAt = nowInTZ(tzOffset);
  const businessDay = businessDayForRunTime(runAt, tzOffset);
  const businessDayStr = businessDay.toISOString().slice(0, 10);

  let issues = []; // collect first
  let roomsTotal = 0;
  let roomsOccupied = 0;
  let totalRoomRevenue = 0;
  const channelCounts = {};
  const roomTypeCounts = {};

  try {
    // Rooms
    const roomsSnap = await getDocs(collection(db, "rooms"));
    const rooms = roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    roomsTotal = rooms.length;
    roomsOccupied = rooms.filter((r) => (r.status || "").toLowerCase() === "occupied").length;

    // Reservations: all active reservations (booked, checked-in)
    const resQ = query(
      collection(db, "reservations"),
      where("status", "in", ["booked", "checked-in", "checked-out", "cancelled"])
    );
    const resSnap = await getDocs(resQ);
    const reservations = resSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Stays: active stays (open)
    const stayQ = query(collection(db, "stays"));
    const staySnap = await getDocs(stayQ);
    const stays = staySnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // Postings & payments (all for the business day)
    const postingSnap = await getDocs(collection(db, "postings"));
    const postings = postingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const paymentSnap = await getDocs(collection(db, "payments"));
    const payments = paymentSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // 1) Ensure every open stay links to a reservation
    for (const s of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      if (!s.reservationId) {
        issues.push({
          type: "stay_without_reservation",
          message: `Open stay ${s.id} (${s.roomNumber}) missing reservationId`,
          stayId: s.id,
        });
      } else {
        // verify reservation exists
        const resExists = reservations.some((r) => r.id === s.reservationId);
        if (!resExists) {
          issues.push({
            type: "stay_reservation_missing",
            message: `Stay ${s.id} references missing reservation ${s.reservationId}`,
            stayId: s.id,
            reservationId: s.reservationId,
          });
        }
      }
    }

    // 2) In-house date checks: no in-house (checked-in / stay open) should have checkOutDate < businessDay
    for (const s of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      const rId = s.reservationId;
      // find reservation
      const res = reservations.find((rr) => rr.id === rId);
      const checkOut = res?.checkOutDate ? (res.checkOutDate?.toDate ? res.checkOutDate.toDate() : new Date(res.checkOutDate)) : null;
      if (checkOut) {
        // If checkOut date is strictly before start of businessDay -> problem
        if (checkOut < businessDay) {
          issues.push({
            type: "stay_past_checkout",
            message: `Stay ${s.id} in room ${s.roomNumber} has check-out ${checkOut.toISOString().slice(0,10)} < business day ${businessDayStr}`,
            stayId: s.id,
            reservationId: rId,
            checkOut
          });
        }
      } else {
        issues.push({
          type: "stay_missing_checkout",
          message: `Stay ${s.id} in room ${s.roomNumber} has no check-out date on reservation ${rId}`,
          stayId: s.id,
          reservationId: rId
        });
      }
    }

    // 3) Reservation checked-in but checkInDate < businessDay (violates check-in after previous date rule)
    for (const r of reservations.filter((x) => (x.status || "").toLowerCase() === "checked-in")) {
      const inDate = r.checkInDate ? (r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate)) : null;
      if (inDate && inDate < businessDay) {
        issues.push({
          type: "checked_in_with_past_checkin",
          message: `Reservation ${r.id} is checked-in but has check-in ${inDate.toISOString().slice(0,10)} < business day ${businessDayStr}`,
          reservationId: r.id
        });
      }
    }

    // 4) Postings vs payments reconciliation per reservation
    // We'll compute for reservations with any postings/payments today or open stays
    const resMap = new Map(reservations.map((r) => [r.id, r]));
    const postingsByRes = {};
    const paymentsByRes = {};
    for (const p of postings) {
      if (!p.reservationId) continue;
      postingsByRes[p.reservationId] = postingsByRes[p.reservationId] || [];
      postingsByRes[p.reservationId].push(p);
    }
    for (const p of payments) {
      if (!p.reservationId) continue;
      paymentsByRes[p.reservationId] = paymentsByRes[p.reservationId] || [];
      paymentsByRes[p.reservationId].push(p);
    }

    for (const [resId, r] of resMap) {
      const posts = postingsByRes[resId] || [];
      const pays = paymentsByRes[resId] || [];
      const postsTotal = posts.reduce((s, x) => s + Number(x.amount || 0) + Number(x.tax || 0) + Number(x.service || 0), 0);
      const paysTotal = pays.reduce((s, x) => s + Number(x.amount || 0), 0);
      // detect a discrepancy bigger than small rounding tolerance
      if (Math.abs(postsTotal - paysTotal) > 0.5 && (postsTotal > 0 || paysTotal > 0)) {
        issues.push({
          type: "payments_mismatch",
          message: `Reservation ${resId} postings ${postsTotal} != payments ${paysTotal}`,
          reservationId: resId,
          postingsTotal: postsTotal,
          paymentsTotal: paysTotal
        });
      }
      totalRoomRevenue += postsTotal;
      // channel & roomType counters
      const ch = (r.channel || "direct").toLowerCase();
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;
      const firstRoom = Array.isArray(r.roomNumbers) ? (r.roomNumbers[0] || null) : r.roomNumber;
      if (firstRoom) {
        const roomDoc = rooms.find((rr) => rr.roomNumber === firstRoom);
        const rt = roomDoc?.roomType || "unknown";
        roomTypeCounts[rt] = (roomTypeCounts[rt] || 0) + 1;
      }
    }

    // 5) No-shows: reservations with checkInDate < businessDay and not checked-in and status booked => possible no-show
    for (const r of reservations.filter((x) => (x.status || "").toLowerCase() === "booked")) {
      const inDate = r.checkInDate ? (r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate)) : null;
      if (inDate && inDate < businessDay) {
        issues.push({
          type: "possible_noshow",
          message: `Reservation ${r.id} with check-in ${inDate.toISOString().slice(0,10)} is still booked (past business day). Mark as no-show?`,
          reservationId: r.id
        });
      }
    }

    // 6) Rooms status sanity: rooms with status 'Occupied' but no open stay pointing at them
    for (const r of rooms.filter((x) => (x.status || "").toLowerCase() === "occupied")) {
      const hasOpenStay = stays.some((s) => (s.roomNumber == r.roomNumber) && (s.status || "").toLowerCase() === "open");
      if (!hasOpenStay) {
        issues.push({
          type: "room_occupied_without_stay",
          message: `Room ${r.roomNumber} shows Occupied but no open stay found.`,
          roomNumber: r.roomNumber
        });
      }
    }

    
    // 🔑 STEP: After collecting issues, load noticed ones
    const noticedSnap = await getDocs(
      query(collection(db, "nightAuditIssues"), where("noticed", "==", true))
    );
    const noticedKeys = new Set(noticedSnap.docs.map(d => d.id));

    // filter
    const newIssues = issues.filter(issue => {
      const key = `${issue.type}:${issue.reservationId || issue.stayId || issue.roomNumber || "?"}`;
      issue.issueKey = key;
      return !noticedKeys.has(key);
    });

    // Build summary
    const occupancyPct = roomsTotal > 0 ? (roomsOccupied / roomsTotal) * 100 : 0;
    const adr = roomsOccupied > 0 ? Math.round(totalRoomRevenue / roomsOccupied) : 0;
    const revpar = roomsTotal > 0 ? Math.round(totalRoomRevenue / roomsTotal) : 0;

    // Build summary
    const summary = {
      runAt: runAt.toISOString(),
      businessDay: businessDayStr,
      roomsTotal,
      roomsOccupied,
      occupancyPct: roomsTotal > 0 ? Math.round((roomsOccupied / roomsTotal) * 10000) / 100 : 0,
      adr: roomsOccupied > 0 ? Math.round(totalRoomRevenue / roomsOccupied) : 0,
      revpar: roomsTotal > 0 ? Math.round(totalRoomRevenue / roomsTotal) : 0,
      totalRoomRevenue: Math.round(totalRoomRevenue),
      channelCounts,
      roomTypeCounts,
      issuesCount: newIssues.length,
    };

    if (finalize) {
      const batch = writeBatch(db);

      // nightAuditLogs (summary + visible issues)
      batch.set(doc(db, "nightAuditLogs", businessDayStr), {
        runAt: new Date(),
        runBy,
        businessDay: businessDayStr,
        summary,
        issues: newIssues,
        createdAt: serverTimestamp(),
      });

      // snapshot
      batch.set(doc(db, "nightAuditSnapshots", businessDayStr), {
        roomsTotal,
        roomsOccupied,
        totalReservations: reservations.length,
        totalStays: stays.length,
        totalPostings: postings.length,
        totalPayments: payments.length,
        createdAt: serverTimestamp(),
      });

      // persist each issue
      for (const issue of newIssues) {
        batch.set(doc(db, "nightAuditIssues", issue.issueKey), {
          ...issue,
          businessDay: businessDayStr,
          noticed: false,
          createdAt: serverTimestamp(),
        }, { merge: true });
      }

      await batch.commit();
    }

    return { success: true, issues: newIssues, summary };
  } catch (err) {
    console.error("runNightAudit error:", err);
    return { success: false, error: err.message || String(err), issues: [], summary: null };
  }
}
