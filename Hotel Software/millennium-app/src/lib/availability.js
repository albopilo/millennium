import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";

/**
 * Checks if any of the given rooms are blocked for the given date range.
 * @param {string[]} roomNumbers - Rooms to check
 * @param {Date} checkIn - Check-in date
 * @param {Date} checkOut - Check-out date
 * @returns {Promise<{blocked: boolean, conflicts: Array}>}
 */
export async function checkRoomBlocks(roomNumbers, checkIn, checkOut) {
  if (!roomNumbers?.length) return { blocked: false, conflicts: [] };

  // Fetch all blocks that overlap the requested date range
  const snap = await getDocs(collection(db, "roomBlocks"));
  const conflicts = [];

  snap.forEach(docSnap => {
    const b = docSnap.data();
    const blockStart = b.startDate?.toDate ? b.startDate.toDate() : new Date(b.startDate);
    const blockEnd = b.endDate?.toDate ? b.endDate.toDate() : new Date(b.endDate);

    // Overlap check: start < blockEnd && end > blockStart
    const overlaps = checkIn < blockEnd && checkOut > blockStart;

    // Match if block applies to this room or to the whole type
    const appliesToRoom = b.roomNumber && roomNumbers.includes(b.roomNumber);
    const appliesToType = b.roomType && roomNumbers.some(rn => rn.includes(b.roomType));

    if (overlaps && (appliesToRoom || appliesToType)) {
      conflicts.push({
        roomNumber: b.roomNumber || null,
        roomType: b.roomType || null,
        reason: b.reason || "Blocked"
      });
    }
  });

  return { blocked: conflicts.length > 0, conflicts };
}