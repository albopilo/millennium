// src/pages/FrontDeskCheckIn.jsx
 import React, { useCallback, useEffect, useMemo, useState } from "react";
 import { Link, useNavigate } from "react-router-dom";
 import { collection, getDocs, query, where, onSnapshot } from "firebase/firestore";
 import { db } from "../firebase";
 import { startOfDayStr, endOfDayStr, todayStr, fmt, ymd } from "../lib/dates";
 import useRequireNightAudit from "../hooks/useRequireNightAudit";

export default function FrontDeskCheckIn({ permissions = [] }) {
  const navigate = useNavigate();
  const can = useCallback(
    (perm) => permissions.includes(perm) || permissions.includes("*"),
    [permissions]
  );

  // --- State ---
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [arrivals, setArrivals] = useState([]);
  const [rooms, setRooms] = useState([]);
 const [loading, setLoading] = useState(true);
 const [error, setError] = useState(null);

  const { ready } = useRequireNightAudit(7);

  // --- Helper: debounce search ---
 const [debouncedSearch, setDebouncedSearch] = useState("");
 useEffect(() => {
   const handler = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 400);
   return () => clearTimeout(handler);
 }, [search]);

  // --- Fetch arrivals (async) ---
  const loadArrivals = useCallback(async (selectedDate) => {
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
      setError("Failed to load timestamp-based reservations.");
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
      setError("Failed to load string-date reservations.");
    }

    const seen = new Set();
    return results.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return (r.status || "").toLowerCase() !== "deleted";
    });
  }, []);

  // --- Load and filter ---
  const load = useCallback(async () => {
   setLoading(true);
    try {
      const items = await loadArrivals(date);

      const filtered = debouncedSearch
        ? items.filter((r) =>
            [r.guestName, r.resNo, r.id, ...(Array.isArray(r.roomNumbers) ? r.roomNumbers : [r.roomNumber])]
              .join(" ")
              .toLowerCase()
              .includes(debouncedSearch)
          )
        : items;

      setArrivals(filtered);

      // load room statuses
      const rSnap = await getDocs(collection(db, "rooms"));
      setRooms(rSnap.docs.map((d) => d.data() || {}));
    } catch (err) {
      console.error("Error loading arrivals:", err);
      setError("Failed to load arrivals.");
    } finally {
      setLoading(false);
    }
  }, [date, debouncedSearch, loadArrivals]);

  // --- Auto load when date or search changes ---
  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  // --- Room badge ---
  const roomBadge = useCallback(
    (roomNumber) => {
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
    },
    [rooms]
  );

  // --- Derived states ---
  const hasArrivals = arrivals.length > 0;

  // --- Early Night Audit check ---
  if (!ready) {
    return (
      <div className="notice-box">
        <h3>Night Audit Required</h3>
        <p>
          The Night Audit for this business day has not been completed.
          Please complete Night Audit before performing check-in operations.
        </p>
        <button className="btn-primary" onClick={() => navigate("/night-audit")}>
          Run Night Audit
        </button>
      </div>
    );
  }

  // --- UI ---
  return (
    <div className="reservations-container">
      <h2 style={{ marginBottom: 8 }}>Front Desk Check-In</h2>

      {/* Search Form */}
      <div className="reservation-form" style={{ marginBottom: 16 }}>
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <div className="form-actions" style={{ marginBottom: 8 }}>
          <button className="btn btn-primary" onClick={() => setDate(todayStr())}>Today</button>
          <button className="btn" onClick={() => setDate(ymd(new Date(Date.now() + 86400000)))}>
            Tomorrow
          </button>
        </div>

        <label>Search</label>
        <input
          placeholder="Search Guest / Res No / Room"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Loading / Error / Empty States */}
      {loading && <div className="muted">Loading arrivals...</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !hasArrivals && <div className="muted">No arrivals for this date.</div>}

      {/* Arrivals Table */}
      {hasArrivals && (
        <table className="reservations-table" style={{ marginTop: 8 }}>
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
                <td>{r.guestName || "-"}</td>
                <td>
                  {(Array.isArray(r.roomNumbers) ? r.roomNumbers : [r.roomNumber])
                    .filter(Boolean)
                    .map((n) => (
                      <span key={n}>{roomBadge(n)} </span>
                    ))}
                </td>
                <td>{fmt(r.checkInDate)}</td>
                <td>{fmt(r.checkOutDate)}</td>
                <td>{r.adults ?? "-"}</td>
                <td>{r.children ?? "-"}</td>
                <td>
                  {can("canViewReservations") && (
                    <Link className="btn btn-primary" to={`/reservations/${r.id}`}>
                      See Details
                    </Link>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
