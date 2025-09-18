// src/lib/dates.js
// Avoid toISOString() because it converts to UTC and causes off-by-one day in many timezones.

export function toDate(val) {
  if (!val) return null;
  return val?.seconds ? new Date(val.seconds * 1000) : new Date(val);
}

export function fmt(val) {
  const d = toDate(val);
  if (!d) return "";
  return d.toLocaleDateString();
}

export function ymd(d) {
  const x = d instanceof Date ? new Date(d) : new Date(d);
  x.setHours(0, 0, 0, 0);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayStr() {
  // local "YYYY-MM-DD"
  return ymd(new Date());
}

export function startOfDayStr(str) {
  // str is "YYYY-MM-DD" local
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  return date;
}

export function endOfDayStr(str) {
  const [y, m, d] = str.split("-").map(Number);
  const date = new Date(y, m - 1, d, 23, 59, 59, 999);
  return date;
}