// src/lib/reservationId.js
export function generateReservationId({ channel = "direct", roomCount = 1, roomType = "standard double" }) {
  const monthLetters = "ABCDEFGHIJKL"; // Jan=A, ..., Dec=L
  const now = new Date();
  const month = monthLetters[now.getMonth()];

  // channel letter - changeable as needed
  const channelMap = {
    direct: "D",
    ota: "O",
    group: "G",
    corporate: "C",
    default: "X"
  };
  const channelCode = channelMap[channel] || channelMap.default;

  // room count (1 digit or X if >9)
  const roomCountCode = roomCount > 9 ? "X" : String(roomCount);

  // normalize key (remove spaces, lowercase) - changeable as needed
  const normalize = (s) => (s || "").toLowerCase().replace(/\s+/g, "");
  const roomTypeMap = {
    standarddouble: "S",
    deluxedouble: "D",
    suitedouble: "U",
    suitevip: "Z"
  };
  const roomTypeCode = roomTypeMap[normalize(roomType)] || "Z";

  // random unique suffix
  const rand = Math.random().toString(36).substring(2, 7).toUpperCase();

  return `${month}${channelCode}${roomCountCode}${roomTypeCode}${rand}`;
}
