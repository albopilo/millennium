import { addDoc, collection, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { checkRoomBlocks } from "./availability"; // ✅ reuse the helper

/**
 * Creates a group reservation with multiple room reservations.
 * Checks for room blocks before creating any reservations.
 */
export async function createGroupWithReservations({
  name,
  organiser,
  contact,
  arrivalDate,
  departureDate,
  roomNumbers = [],
  channel = "direct",
  depositPerRoom = 0
}) {
  const checkIn = new Date(arrivalDate);
  const checkOut = new Date(departureDate);

  // 🔍 Check all rooms for blocks before creating anything
  const { blocked, conflicts } = await checkRoomBlocks(roomNumbers, checkIn, checkOut);
  if (blocked) {
    throw new Error(
      "Cannot create group reservation. The following rooms are blocked:\n" +
      conflicts.map(c => `${c.roomNumber || c.roomType} (${c.reason})`).join("\n")
    );
  }

  // ✅ No conflicts — proceed
  const groupRef = await addDoc(collection(db, "groupReservations"), {
    name,
    organiser,
    contact,
    arrivalDate: checkIn,
    departureDate: checkOut,
    reservations: [],
    billingMode: "master"
  });

  const resIds = [];
  for (const rn of roomNumbers) {
    const resRef = await addDoc(collection(db, "reservations"), {
      groupId: groupRef.id,
      guestName: organiser,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomNumbers: [rn],
      channel,
      rate: 0,
      depositPerRoom,
      paymentMade: 0,
      status: "booked"
    });
    resIds.push(resRef.id);
  }

  await updateDoc(doc(db, "groupReservations", groupRef.id), { reservations: resIds });
  return groupRef.id;
}