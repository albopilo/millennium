// src/utils/nightAudit.js
import {
  collection,
  query,
  where,
  getDocs,
  setDoc,
  doc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { db } from "../firebase";

/**
 * Helpers for Jakarta timezone (GMT+7)
 */
function nowInTZ(offsetHours = 7) {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const tzMs = utcMs + offsetHours * 3600 * 1000;
  return new Date(tzMs);
}

function startOfDayInTZ(d) {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function businessDayForRunTime(runDate = null, tzOffset = 7) {
  const now = runDate ? new Date(runDate) : nowInTZ(tzOffset);
  const hours = now.getHours();
  if (hours < 4) {
    const prev = new Date(now);
    prev.setDate(prev.getDate() - 1);
    return startOfDayInTZ(prev);
  }
  return startOfDayInTZ(now);
}

/**
 * Helper wrapper: safe reads with diagnostics
 */
async function safeGetDocs(collName, q = null) {
  try {
    const snap = q
      ? await getDocs(q)
      : await getDocs(collection(db, collName));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`nightAudit: read failed for collection "${collName}"`, err);
    throw err; // rethrow so runNightAudit sees permission problems
  }
}

/**
 * runNightAudit
 */
export async function runNightAudit({ runBy = "system", finalize = false, tzOffset = 7 } = {}) {
  const runAt = nowInTZ(tzOffset);
  const businessDay = businessDayForRunTime(runAt, tzOffset);
  const businessDayStr = businessDay.toISOString().slice(0, 10);

  let issues = [];
  let roomsTotal = 0;
  let roomsOccupied = 0;
  let totalRoomRevenue = 0;
  const channelCounts = {};
  const roomTypeCounts = {};

  try {
    // Data loads
    const rooms = await safeGetDocs("rooms");
    const reservations = await safeGetDocs(
      "reservations",
      query(
        collection(db, "reservations"),
        where("status", "in", ["booked", "checked-in", "checked-out", "cancelled"])
      )
    );
    const stays = await safeGetDocs("stays");
    const postings = await safeGetDocs("postings");
    const payments = await safeGetDocs("payments");

    roomsTotal = rooms.length;
    roomsOccupied = rooms.filter((r) => (r.status || "").toLowerCase() === "occupied").length;

    // 1) Stays must link to reservation
    for (const s of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      if (!s.reservationId) {
        issues.push({
          type: "stay_without_reservation",
          message: `Open stay ${s.id} (${s.roomNumber}) missing reservationId`,
          stayId: s.id,
        });
      } else {
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

    // 2) Stays past checkout
    for (const s of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      const rId = s.reservationId;
      const res = reservations.find((rr) => rr.id === rId);
      const checkOut = res?.checkOutDate
        ? res.checkOutDate?.toDate
          ? res.checkOutDate.toDate()
          : new Date(res.checkOutDate)
        : null;
      if (checkOut) {
        if (checkOut < businessDay) {
          issues.push({
            type: "stay_past_checkout",
            message: `Stay ${s.id} in room ${s.roomNumber} has check-out ${checkOut.toISOString().slice(0, 10)} < business day ${businessDayStr}`,
            stayId: s.id,
            reservationId: rId,
            checkOut,
          });
        }
      } else {
        issues.push({
          type: "stay_missing_checkout",
          message: `Stay ${s.id} in room ${s.roomNumber} has no check-out date on reservation ${rId}`,
          stayId: s.id,
          reservationId: rId,
        });
      }
    }

    // 3) Reservations checked-in with old check-in date
    for (const r of reservations.filter((x) => (x.status || "").toLowerCase() === "checked-in")) {
      const inDate = r.checkInDate
        ? r.checkInDate?.toDate
          ? r.checkInDate.toDate()
          : new Date(r.checkInDate)
        : null;
      if (inDate && inDate < businessDay) {
        issues.push({
          type: "checked_in_with_past_checkin",
          message: `Reservation ${r.id} is checked-in but has check-in ${inDate.toISOString().slice(0, 10)} < business day ${businessDayStr}`,
          reservationId: r.id,
        });
      }
    }

    // 4) Reconcile postings & payments
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
      const postsTotal = posts.reduce(
        (s, x) => s + Number(x.amount || 0) + Number(x.tax || 0) + Number(x.service || 0),
        0
      );
      const paysTotal = pays.reduce((s, x) => s + Number(x.amount || 0), 0);

      if (Math.abs(postsTotal - paysTotal) > 0.5 && (postsTotal > 0 || paysTotal > 0)) {
        issues.push({
          type: "payments_mismatch",
          message: `Reservation ${resId} postings ${postsTotal} != payments ${paysTotal}`,
          reservationId: resId,
          postingsTotal: postsTotal,
          paymentsTotal: paysTotal,
        });
      }

      totalRoomRevenue += postsTotal;
      const ch = (r.channel || "direct").toLowerCase();
      channelCounts[ch] = (channelCounts[ch] || 0) + 1;

      const firstRoom = Array.isArray(r.roomNumbers) ? (r.roomNumbers[0] || null) : r.roomNumber;
      if (firstRoom) {
        const roomDoc = rooms.find((rr) => rr.roomNumber === firstRoom);
        const rt = roomDoc?.roomType || "unknown";
        roomTypeCounts[rt] = (roomTypeCounts[rt] || 0) + 1;
      }
    }

    // 5) No-shows
    for (const r of reservations.filter((x) => (x.status || "").toLowerCase() === "booked")) {
      const inDate = r.checkInDate
        ? r.checkInDate?.toDate
          ? r.checkInDate.toDate()
          : new Date(r.checkInDate)
        : null;
      if (inDate && inDate < businessDay) {
        issues.push({
          type: "possible_noshow",
          message: `Reservation ${r.id} with check-in ${inDate.toISOString().slice(0, 10)} is still booked (past business day).`,
          reservationId: r.id,
        });
      }
    }

    // 6) Rooms occupied but no stay
    for (const r of rooms.filter((x) => (x.status || "").toLowerCase() === "occupied")) {
      const hasOpenStay = stays.some(
        (s) => s.roomNumber === r.roomNumber && (s.status || "").toLowerCase() === "open"
      );
      if (!hasOpenStay) {
        issues.push({
          type: "room_occupied_without_stay",
          message: `Room ${r.roomNumber} shows Occupied but no open stay found.`,
          roomNumber: r.roomNumber,
        });
      }
    }

    // Load already noticed issues
    const noticedSnap = await safeGetDocs(
      "nightAuditIssues",
      query(collection(db, "nightAuditIssues"), where("noticed", "==", true))
    );
    const noticedKeys = new Set(noticedSnap.map((d) => d.id));

    const newIssues = issues.filter((issue) => {
      const key = `${issue.type}:${issue.reservationId || issue.stayId || issue.roomNumber || "?"}`;
      issue.issueKey = key;
      return !noticedKeys.has(key);
    });

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
      const logRef = doc(db, "nightAuditLogs", businessDayStr);
      const snapshotRef = doc(db, "nightAuditSnapshots", businessDayStr);
      const issueWrites = newIssues.map((issue) => ({
        ref: doc(db, "nightAuditIssues", issue.issueKey),
        data: {
          ...issue,
          businessDay: businessDayStr,
          noticed: false,
          createdAt: serverTimestamp(),
        },
      }));

      try {
        const batch = writeBatch(db);
        batch.set(logRef, {
          runAt: new Date(),
          runBy,
          businessDay: businessDayStr,
          summary,
          issues: newIssues,
          createdAt: serverTimestamp(),
        });
        batch.set(snapshotRef, {
          roomsTotal,
          roomsOccupied,
          totalReservations: reservations.length,
          totalStays: stays.length,
          totalPostings: postings.length,
          totalPayments: payments.length,
          createdAt: serverTimestamp(),
        });
        for (const w of issueWrites) {
          batch.set(w.ref, w.data, { merge: true });
        }
        await batch.commit();
      } catch (batchErr) {
        console.error("runNightAudit batch.commit failed:", batchErr);

        await setDoc(logRef, {
          runAt: new Date(),
          runBy,
          businessDay: businessDayStr,
          summary,
          issues: newIssues,
          createdAt: serverTimestamp(),
        });

        await setDoc(snapshotRef, {
          roomsTotal,
          roomsOccupied,
          totalReservations: reservations.length,
          totalStays: stays.length,
          totalPostings: postings.length,
          totalPayments: payments.length,
          createdAt: serverTimestamp(),
        });

        for (const w of issueWrites) {
          await setDoc(w.ref, w.data, { merge: true });
        }
      }
    }

    return { issues: newIssues, summary };
  } catch (err) {
    console.error("runNightAudit error:", err);
    throw err;
  }
}
