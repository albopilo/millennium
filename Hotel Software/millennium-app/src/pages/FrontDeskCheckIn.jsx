// src/pages/FrontDeskCheckIn.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../firebase";
import { startOfDayStr, endOfDayStr, todayStr, fmt, ymd } from "../lib/dates";
import useRequireNightAudit from "../hooks/useRequireNightAudit";

export default function FrontDeskCheckIn({ permissions = [] }) {
  const navigate = useNavigate();
  const can = (p) => permissions.includes(p) || permissions.includes("*");

  // 🔹 ALL HOOKS AT THE TOP
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [arrivals, setArrivals] = useState([]);
  const [rooms, setRooms] = useState([]);
  const { ready } = useRequireNightAudit(7);

  // 🔹 Load arrivals from Firestore
  async function loadArrivals(selectedDate) {
    const start = startOfDayStr(selectedDate);
    const end = endOfDayStr(selectedDate);
    const results = [];

    try {
      const qTs = query(
        collection(db, "reservations"),
        where("status", "==", "booked"),
        where("checkInDate", ">=", start),
        where("checkInDate", "<=", end)
      );
      const snapTs = await getDocs(qTs);
      snapTs.forEach((d) => results.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error("Error loading timestamp arrivals:", err);
    }

    try {
      const qStr = query(
        collection(db, "reservations"),
        where("status", "==", "booked"),
        where("checkInDate", "==", selectedDate)
      );
      const snapStr = await getDocs(qStr);
      snapStr.forEach((d) => results.push({ id: d.id, ...d.data() }));
    } catch (err) {
      console.error("Error loading string-date arrivals:", err);
    }

    // de-dup and remove deleted
    const seen = new Set();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return (r.status || "").toLowerCase() !== "deleted";
    });
  }

  // 🔹 Load and filter arrivals
  const load = async () => {
    const items = await loadArrivals(date);

    const s = search.trim().toLowerCase();
    const filtered = s
      ? items.filter(
          (r) =>
            (r.guestName || "").toLowerCase().includes(s) ||
            (r.resNo || r.id).toLowerCase().includes(s) ||
            (Array.isArray(r.roomNumbers)
              ? r.roomNumbers.join(",")
              : r.roomNumber || ""
            ).toLowerCase().includes(s)
        )
      : items;

    setArrivals(filtered);

    try {
      const rSnap = await getDocs(collection(db, "rooms"));
      setRooms(rSnap.docs.map((d) => d.data()));
    } catch (err) {
      console.error("Error loading rooms:", err);
    }
  };

  // 🔹 useEffect always declared
  useEffect(() => {
    if (!ready) return; // only run load when ready
    load();
  }, [date, search, ready]);

  // 🔹 Room status badge
  const roomBadge = (roomNumber) => {
    const rm = rooms.find((x) => x.roomNumber === roomNumber);
    const st = rm?.status || "";
    const tag =
      st === "Occupied"
        ? "OCC"
        : st === "Vacant Dirty"
        ? "VD"
        : st === "Vacant Clean"
        ? "VC"
        : st === "OOO"
        ? "OOO"
        : "";
    return `${roomNumber}${tag ? ` (${tag})` : ""}`;
  };

  // 🔹 Early return for Night Audit (UI only)
  if (!ready) {
    return (
      <div>
        <h3>Night Audit required</h3>
        <p>
          Night Audit for the business day has not been completed. Please run
          Night Audit before performing check-in operations.
        </p>
        <button onClick={() => navigate("/night-audit")}>Run Night Audit</button>
      </div>
    );
  }

  return (
    <div className="reservations-container">
      <h2>Check In</h2>

      <div className="reservation-form" style={{ marginBottom: 12 }}>
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="form-actions">
          <button className="btn-primary" onClick={() => setDate(todayStr())}>Today</button>
          <button
            onClick={() => {
              const t = new Date();
              t.setDate(t.getDate() + 1);
              setDate(ymd(t));
            }}
          >
            Tomorrow
          </button>
        </div>

        <label>Search</label>
        <input
          placeholder="Guest / Res No / Room"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <table className="reservations-table">
        <thead>
          <tr>
            <th>Res No</th>
            <th>Guest</th>
            <th>Rooms</th>
            <th>Check-In</th>
            <th>Check-Out</th>
            <th>Adults</th>
            <th>Children</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {arrivals.map((r) => (
            <tr key={r.id}>
              <td>{r.resNo || r.id}</td>
              <td>{r.guestName}</td>
              <td>
                {(Array.isArray(r.roomNumbers) ? r.roomNumbers : [r.roomNumber])
                  .filter(Boolean)
                  .map((n) => <span key={n}>{roomBadge(n)} </span>)}
              </td>
              <td>{fmt(r.checkInDate)}</td>
              <td>{fmt(r.checkOutDate)}</td>
              <td>{r.adults ?? "-"}</td>
              <td>{r.children ?? "-"}</td>
              <td>
                {can("canViewReservations") && (
                  <Link className="btn-primary" to={`/reservations/${r.id}`}>
                    See details
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
