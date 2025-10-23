// src/pages/FrontDeskCheckIn.jsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { startOfDayStr, endOfDayStr, todayStr, fmt, ymd } from "../lib/dates";
import useRequireNightAudit from "../hooks/useRequireNightAudit";

/**
 * FrontDeskCheckIn
 *
 * Responsibilities (kept intact):
 *  - list arrivals (reservations with status === "booked") for a selected date
 *  - support both timestamp-based checkInDate (range query) and string-based checkInDate (equality)
 *  - provide search across guestName / resNo / id / roomNumbers
 *  - show room status badges (Occupied, Vacant Dirty, Vacant Clean, OOO)
 *  - enforce Night Audit (useRequireNightAudit(7)) before allowing operations
 *
 * Enhancements (non-destructive):
 *  - request token to avoid race conditions
 *  - mounted ref to prevent state updates after unmount
 *  - realtime subscription for rooms (keeps getDocs approach so no logic removed)
 *  - retry button on error
 */

export default function FrontDeskCheckIn({ permissions = [] }) {
  const navigate = useNavigate();

  // permission helper (keeps original behavior)
  const can = useCallback((perm) => permissions.includes(perm) || permissions.includes("*"), [permissions]);

  // --- UI state (kept) ---
  const [date, setDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [arrivals, setArrivals] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // night audit requirement (kept)
  const { ready } = useRequireNightAudit(7);

  // --- debounce search (kept semantics) ---
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch((search || "").trim().toLowerCase()), 400);
    return () => clearTimeout(handler);
  }, [search]);

  // mounted guard + request token to avoid race conditions
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // request token increments each time load() is invoked; only the latest token may apply results
  const reqTokenRef = useRef(0);

  /**
   * loadArrivals(selectedDate)
   *
   * Kept core logic:
   *  - query reservations where status == 'booked' && checkInDate within timestamp range
   *  - query reservations where status == 'booked' && checkInDate == selectedDate (string)
   *  - combine, dedupe by id and filter out deleted
   *
   * Returns: Promise<Reservation[]>
   */
  const loadArrivals = useCallback(async (selectedDate) => {
    const start = startOfDayStr(selectedDate);
    const end = endOfDayStr(selectedDate);
    const results = [];

    // Attempt timestamp-range query (some records store checkInDate as timestamp)
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
      // preserve original behavior: log + user-visible error message
      console.error("Error loading timestamp arrivals:", err);
      // append to error; preserve other flows
      // Do not throw — keep behavior as original but surface friendly message
      throw new Error("Failed to load timestamp-based reservations.");
    }

    // Attempt string equality query (some records store checkInDate as YYYY-MM-DD string)
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
      throw new Error("Failed to load string-date reservations.");
    }

    // dedupe by id and exclude deleted
    const seen = new Set();
    const out = results.filter((r) => {
      if (!r || !r.id) return false;
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return (r.status || "").toLowerCase() !== "deleted";
    });

    return out;
  }, []);

  /**
   * load()
   *
   * - increments req token
   * - uses loadArrivals(date) (kept)
   * - filters using debouncedSearch (kept logic)
   * - sets arrivals and loads rooms via getDocs (kept)
   * - sets loading & error states defensively
   */
  const load = useCallback(async () => {
    const myToken = ++reqTokenRef.current; // capture token for this invocation
    setLoading(true);
    setError(null);

    try {
      const items = await loadArrivals(date);

      // if component unmounted or a newer request has started, bail
      if (!mountedRef.current || reqTokenRef.current !== myToken) return;

      const filtered = debouncedSearch
        ? items.filter((r) =>
            [r.guestName, r.resNo, r.id, ...(Array.isArray(r.roomNumbers) ? r.roomNumbers : [r.roomNumber])]
              .join(" ")
              .toLowerCase()
              .includes(debouncedSearch)
          )
        : items;

      // Apply arrivals (kept)
      setArrivals(filtered);

      // Now load rooms collection (kept)
      try {
        const rSnap = await getDocs(collection(db, "rooms"));
        if (!mountedRef.current || reqTokenRef.current !== myToken) return;
        setRooms(rSnap.docs.map((d) => d.data() || {}));
      } catch (err) {
        // preserve behavior: log + set error but don't throw
        console.error("Error loading rooms:", err);
        if (mountedRef.current) setError("Failed to load room statuses.");
      }
    } catch (err) {
      // loadArrivals throws stringified error messages above; keep user-facing error
      console.error("Error loading arrivals:", err);
      if (mountedRef.current) setError(err.message || "Failed to load arrivals.");
    } finally {
      if (mountedRef.current && reqTokenRef.current === myToken) setLoading(false);
    }
  }, [date, debouncedSearch, loadArrivals]);

  // Auto load whenever ready flag or search/date changes
  useEffect(() => {
    if (!ready) return;
    // call load; because load uses reqTokenRef it prevents race overwrite
    load();
  }, [ready, date, debouncedSearch, load]);

  /**
   * Real-time subscription for rooms (non-destructive)
   * - original code used getDocs for rooms on each load()
   * - we keep that call (so no behavior removed) but also subscribe once to rooms
   * - subscription keeps room state up-to-date between loads without removing original logic
   */
  useEffect(() => {
    const coll = collection(db, "rooms");
    // onSnapshot returns unsubscribe
    const unsub = onSnapshot(
      coll,
      (snap) => {
        if (!mountedRef.current) return;
        setRooms(snap.docs.map((d) => d.data() || {}));
      },
      (err) => {
        console.warn("rooms onSnapshot error", err);
        // do not fail hard — keep original logic's reliance on getDocs
      }
    );
    return () => unsub();
  }, []);

  /**
   * roomBadge(roomNumber)
   *
   * Kept mapping:
   *  - Occupied -> OCC
   *  - Vacant Dirty -> VD
   *  - Vacant Clean -> VC
   *  - OOO -> OOO
   * Returns "roomNumber (TAG)" when tag present
   */
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

  const hasArrivals = arrivals.length > 0;

  // Night Audit enforcement (kept early return)
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

  // UI helpers
  const handleKeySearch = (e) => {
    if (e.key === "Enter") {
      // pressing Enter triggers immediate update of debouncedSearch by updating `search` value is enough
      // because effect above will debounce — we also trigger load immediately to be responsive
      // keep logic intact but give UX improvement
      load();
    }
  };

  const handleRetry = () => {
    setError(null);
    load();
  };

  // Render
  return (
    <div className="reservations-container">
      <h2 style={{ marginBottom: 8 }}>Front Desk Check-In</h2>

      <div className="reservation-form" style={{ marginBottom: 16 }}>
        <label htmlFor="fd-date">Date</label>
        <input
          id="fd-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Select business date"
        />

        <div className="form-actions" style={{ marginBottom: 8 }}>
          <button
            className="btn btn-primary"
            onClick={() => {
              setDate(todayStr());
            }}
            title="Set to today's date"
          >
            Today
          </button>

          <button
            className="btn"
            onClick={() => {
              const t = new Date();
              t.setDate(t.getDate() + 1);
              setDate(ymd(t));
            }}
            title="Set to tomorrow"
          >
            Tomorrow
          </button>
        </div>

        <label htmlFor="fd-search">Search</label>
        <input
          id="fd-search"
          placeholder="Search Guest / Res No / Room"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={handleKeySearch}
          aria-label="Search arrivals"
        />
      </div>

      {/* Loading, error, empty states (kept and enhanced) */}
      {loading && <div className="muted">Loading arrivals...</div>}

      {error && (
        <div style={{ marginBottom: 12 }}>
          <div className="error">{error}</div>
          <div style={{ marginTop: 8 }}>
            <button className="btn" onClick={handleRetry}>Retry</button>
          </div>
        </div>
      )}

      {!loading && !hasArrivals && !error && (
        <div className="muted">No arrivals for this date.</div>
      )}

      {/* Arrivals table (kept columns & structure) */}
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
            {arrivals.map((r) => {
              const roomList = Array.isArray(r.roomNumbers) ? r.roomNumbers : [r.roomNumber];
              return (
                <tr key={r.id}>
                  <td>{r.resNo || r.id}</td>
                  <td>{r.guestName || "-"}</td>
                  <td>
                    {roomList.filter(Boolean).map((n) => (
                      <span key={n} style={{ marginRight: 8 }}>{roomBadge(n)}</span>
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
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
