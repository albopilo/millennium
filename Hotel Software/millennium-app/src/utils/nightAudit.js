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

/* ============================================================
   🔧 TIMEZONE HELPERS (Jakarta / GMT+7)
   ============================================================ */
function nowInTZ(offset = 7) {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + offset * 3600 * 1000);
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function businessDayForRunTime(date = null, offset = 7) {
  const current = date ? new Date(date) : nowInTZ(offset);
  if (current.getHours() < 4) {
    const prev = new Date(current);
    prev.setDate(prev.getDate() - 1);
    return startOfDay(prev);
  }
  return startOfDay(current);
}

/* ============================================================
   🛡️ SAFE FETCH WRAPPER
   ============================================================ */
async function safeGetDocs(collName, q = null) {
  try {
    const snap = q ? await getDocs(q) : await getDocs(collection(db, collName));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error(`[NightAudit] Failed to read "${collName}"`, err);
    throw new Error(`Permission or read error for "${collName}"`);
  }
}

/* ============================================================
   🏨 MAIN NIGHT AUDIT FUNCTION
   ============================================================ */
export async function runNightAudit({
  runBy = "system",
  finalize = false,
  tzOffset = 7,
} = {}) {
  const runAt = nowInTZ(tzOffset);
  const businessDay = businessDayForRunTime(runAt, tzOffset);
  const businessDayStr = businessDay.toISOString().slice(0, 10);

  const result = {
    summary: {},
    issues: [],
  };

  try {
    // Load core collections (read-only)
    const [rooms, stays, reservations, postings, payments] = await Promise.all([
      safeGetDocs("rooms"),
      safeGetDocs("stays"),
      safeGetDocs(
        "reservations",
        query(
          collection(db, "reservations"),
          where("status", "in", ["booked", "checked-in", "checked-out", "cancelled"])
        )
      ),
      safeGetDocs("postings"),
      safeGetDocs("payments"),
    ]);

    const roomsTotal = rooms.length;
    const roomsOccupied = rooms.filter((r) => (r.status || "").toLowerCase() === "occupied").length;
    let totalRoomRevenue = 0;
    const channelCounts = {};
    const roomTypeCounts = [];
    const issues = [];

    /* ================================
       🔍 Validation 1: Stay consistency
       ================================ */
    for (const stay of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      if (!stay.reservationId) {
        issues.push({
          type: "stay_without_reservation",
          message: `Stay ${stay.id} (${stay.roomNumber}) has no reservationId.`,
          stayId: stay.id,
        });
        continue;
      }
      const resExists = reservations.some((r) => r.id === stay.reservationId);
      if (!resExists) {
        issues.push({
          type: "stay_reservation_missing",
          message: `Stay ${stay.id} references missing reservation ${stay.reservationId}.`,
          stayId: stay.id,
          reservationId: stay.reservationId,
        });
      }
    }

    /* =====================================
       ⏰ Validation 2: Stays past checkout
       ===================================== */
    for (const s of stays.filter((x) => (x.status || "").toLowerCase() === "open")) {
      const r = reservations.find((rr) => rr.id === s.reservationId);
      const checkOut = r?.checkOutDate
        ? r.checkOutDate.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate)
        : null;
      if (!checkOut) {
        issues.push({
          type: "stay_missing_checkout",
          message: `Stay ${s.id} missing checkout on reservation ${r?.id || "unknown"}.`,
        });
        continue;
      }
      if (checkOut < businessDay) {
        issues.push({
          type: "stay_past_checkout",
          message: `Stay ${s.id} (${s.roomNumber}) past checkout (${checkOut.toISOString().slice(0, 10)}).`,
          checkOut,
        });
      }
    }

    /* =======================================
       🧾 Validation 3: Payment reconciliation
       ======================================= */
    const postingsByRes = {};
    const paymentsByRes = {};
    for (const p of postings) {
      if (p.reservationId)
        (postingsByRes[p.reservationId] ||= []).push(p);
    }
    for (const p of payments) {
      if (p.reservationId)
        (paymentsByRes[p.reservationId] ||= []).push(p);
    }

    for (const r of reservations) {
      const posts = postingsByRes[r.id] || [];
      const pays = paymentsByRes[r.id] || [];
      const postsTotal = posts.reduce(
        (sum, x) => sum + Number(x.amount || 0) + Number(x.tax || 0) + Number(x.service || 0),
        0
      );
      const paysTotal = pays.reduce((sum, x) => sum + Number(x.amount || 0), 0);

      if (Math.abs(postsTotal - paysTotal) > 0.5 && (postsTotal > 0 || paysTotal > 0)) {
        issues.push({
          type: "payments_mismatch",
          message: `Reservation ${r.id}: postings=${postsTotal}, payments=${paysTotal}`,
          reservationId: r.id,
        });
      }

      totalRoomRevenue += postsTotal;
      const channel = (r.channel || "direct").toLowerCase();
      channelCounts[channel] = (channelCounts[channel] || 0) + 1;

      const roomNum = Array.isArray(r.roomNumbers)
        ? r.roomNumbers[0]
        : r.roomNumber;
      const roomType = rooms.find((x) => x.roomNumber === roomNum)?.roomType || "unknown";
      roomTypeCounts[roomType] = (roomTypeCounts[roomType] || 0) + 1;
    }

    /* =========================================
       🚪 Validation 4: Occupied rooms w/out stay
       ========================================= */
    for (const r of rooms.filter((x) => (x.status || "").toLowerCase() === "occupied")) {
      const hasStay = stays.some(
        (s) => s.roomNumber === r.roomNumber && (s.status || "").toLowerCase() === "open"
      );
      if (!hasStay) {
        issues.push({
          type: "room_occupied_without_stay",
          message: `Room ${r.roomNumber} marked occupied but has no active stay.`,
        });
      }
    }

    /* =========================================
       ⏱️ Validation 5: No-shows
       ========================================= */
    for (const r of reservations.filter((x) => (x.status || "").toLowerCase() === "booked")) {
      const inDate = r.checkInDate
        ? r.checkInDate.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate)
        : null;
      if (inDate && inDate < businessDay) {
        issues.push({
          type: "possible_noshow",
          message: `Reservation ${r.id} booked for ${inDate.toISOString().slice(0, 10)} still not checked in.`,
        });
      }
    }

    /* =========================================
       🧮 Summary Calculation
       ========================================= */
    const summary = {
      runAt: runAt.toISOString(),
      businessDay: businessDayStr,
      roomsTotal,
      roomsOccupied,
      occupancyPct: roomsTotal ? Math.round((roomsOccupied / roomsTotal) * 10000) / 100 : 0,
      adr: roomsOccupied ? Math.round(totalRoomRevenue / roomsOccupied) : 0,
      revpar: roomsTotal ? Math.round(totalRoomRevenue / roomsTotal) : 0,
      totalRoomRevenue: Math.round(totalRoomRevenue),
      issuesCount: issues.length,
      channelCounts,
      roomTypeCounts,
    };

    result.summary = summary;
    result.issues = issues;

    /* =========================================
       🧱 Finalization (Write Logs & Issues)
       ========================================= */
    if (finalize) {
      const batch = writeBatch(db);
      const logRef = doc(db, "nightAuditLogs", businessDayStr);
      const snapshotRef = doc(db, "nightAuditSnapshots", businessDayStr);

      batch.set(logRef, {
        runAt,
        runBy,
        businessDay: businessDayStr,
        summary,
        issues,
        createdAt: serverTimestamp(),
      });

      batch.set(snapshotRef, {
        totals: {
          rooms: roomsTotal,
          reservations: reservations.length,
          stays: stays.length,
          postings: postings.length,
          payments: payments.length,
        },
        createdAt: serverTimestamp(),
      });

      for (const i of issues) {
        const key = `${i.type}:${i.reservationId || i.stayId || i.roomNumber}`;
        batch.set(doc(db, "nightAuditIssues", key), {
          ...i,
          businessDay: businessDayStr,
          noticed: false,
          createdAt: serverTimestamp(),
        });
      }

      await batch.commit();
    }

    return result;
  } catch (err) {
    console.error("[NightAudit] Critical failure:", err);
    throw err;
  }
}
