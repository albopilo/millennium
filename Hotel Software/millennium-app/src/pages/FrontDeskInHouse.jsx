// src/pages/FrontDeskInHouse.jsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs, query, where, getDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { fmt } from "../lib/dates";
import useRequireNightAudit from "../hooks/useRequireNightAudit";

export default function FrontDeskInHouse({ permissions = [] }) {
  const navigate = useNavigate();
  const can = (p) => permissions.includes(p) || permissions.includes("*");

  // 🔹 ALL HOOKS AT THE TOP
  const [stays, setStays] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const { ready } = useRequireNightAudit(7);

  // Helper to normalize reservationId (supports string or DocumentReference)
  const normalizeResId = (rid) => {
    if (!rid && rid !== 0) return ""; // null/undefined => empty string
    if (typeof rid === "object" && rid !== null) {
      if ("id" in rid && typeof rid.id === "string") return rid.id;
      try {
        return String(rid.id || rid.toString());
      } catch {
        return String(rid);
      }
    }
    return String(rid);
  };

  // 🔹 Load in-house stays
  const load = async () => {
    if (!ready) return; // only load when night audit ready
    setLoading(true);

    try {
      // 1) load open stays
      const qStays = query(collection(db, "stays"), where("status", "==", "open"));
      const sSnap = await getDocs(qStays);
      let staysData = sSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // 2) load deleted reservation ids from possible archive collections
      const archiveCandidates = ["deleted_reservations", "deletedReservations", "deleted_reservation"];
      const deletedIdSet = new Set();

      for (const colName of archiveCandidates) {
        try {
          const ds = await getDocs(collection(db, colName));
          if (!ds.empty) {
            ds.docs.forEach((d) => deletedIdSet.add(String(d.id)));
          }
        } catch (err) {
          // ignore missing collections / read permission errors for each candidate
          // console.debug(`Archive read ${colName} failed (ignored):`, err);
        }
      }

      // 3) initial filter using deleted archive ids (fast)
      let filtered = staysData.filter((s) => {
        const rid = normalizeResId(s.reservationId);
        if (!rid) return true; // keep stays without reservationId
        return !deletedIdSet.has(rid);
      });

      // 4) SECONDARY: verify reservation doc itself for each stay.
      //    Exclude stays when reservation doc either:
      //      • does not exist (reservation removed)
      //      • OR reservation.status === "deleted"
      // This handles soft-delete flows where reservation.status="deleted"
      const checked = await Promise.all(
        filtered.map(async (s) => {
          const rid = normalizeResId(s.reservationId);
          if (!rid) {
            // can't check, keep it (or choose to exclude — we keep to be conservative)
            return { keep: true, stay: s };
          }
          try {
            const resRef = doc(db, "reservations", rid);
            const resSnap = await getDoc(resRef);
            if (!resSnap.exists()) {
              // Reservation document missing — likely archived/deleted; exclude
              console.info(`Excluding stay ${s.id} because reservation ${rid} not found.`);
              return { keep: false, reason: "reservation-missing", stay: s, rid };
            }
            const rdata = resSnap.data();
            if ((rdata?.status || "").toLowerCase() === "deleted") {
              console.info(`Excluding stay ${s.id} because reservation ${rid} status="deleted".`);
              return { keep: false, reason: "reservation-deleted", stay: s, rid, reservationDoc: rdata };
            }
            // also exclude if archiving scheme used a different collection but reservation has a field like archived=true:
            if (rdata?.archived === true || rdata?.deleted === true) {
              console.info(`Excluding stay ${s.id} because reservation ${rid} flagged archived/deleted.`);
              return { keep: false, reason: "reservation-flagged-deleted", stay: s, rid, reservationDoc: rdata };
            }
            // Otherwise keep
            return { keep: true, stay: s };
          } catch (err) {
            // If getDoc fails due to permission/race, be conservative and keep the stay,
            // but also log for debugging.
            console.warn(`Could not verify reservation ${rid} for stay ${s.id}:`, err);
            return { keep: true, stay: s, verifyError: err };
          }
        })
      );

      const finalFiltered = checked.filter((c) => c.keep).map((c) => c.stay);

      // Debug: any excluded stays will be logged (console.info above). You can also see a summary:
      const excluded = checked.filter((c) => !c.keep);
      if (excluded.length > 0) {
        console.info("FrontDeskInHouse: excluded stays after reservation verification:", excluded.map(e => ({ stayId: e.stay.id, reservationId: e.rid, reason: e.reason })));
      }

      setStays(finalFiltered);
    } catch (err) {
      console.error("Error loading in-house stays:", err);
      setStays([]); // fail-safe
    } finally {
      setLoading(false);
    }
  };

  // 🔹 useEffect always declared
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 🔹 Filter stays based on search
  const filtered = stays.filter((s) => {
    const q = search.toLowerCase().trim();
    if ((s.status || "").toLowerCase() === "deleted") return false;
    if (!q) return true;

    const rooms = Array.isArray(s.roomNumber) ? s.roomNumber.join(",") : s.roomNumber;

    return (
      (s.guestName || "").toLowerCase().includes(q) ||
      (rooms || "").toLowerCase().includes(q) ||
      normalizeResId(s.reservationId).toLowerCase().includes(q)
    );
  });

  const formatRooms = (room) => {
    if (!room) return "-";
    if (Array.isArray(room)) return room.join(", ");
    return room;
  };

  // 🔹 Early return UI for night audit
  if (!ready) {
    return (
      <div>
        <h3>Night Audit required</h3>
        <p>
          Night Audit for the business day has not been completed. Please run
          Night Audit before viewing in-house guests.
        </p>
        <button onClick={() => navigate("/night-audit")}>Run Night Audit</button>
      </div>
    );
  }

  return (
    <div className="reservations-container">
      <h2>In-House</h2>

      <div className="reservation-form" style={{ marginBottom: 12 }}>
        <label>Search</label>
        <input
          placeholder="Guest / Room / Reservation"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <table className="reservations-table">
          <thead>
            <tr>
              <th>Reservation</th>
              <th>Guest</th>
              <th>Room</th>
              <th>Check-In</th>
              <th>Check-Out</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => (
              <tr key={s.id}>
                <td>{normalizeResId(s.reservationId)?.slice(0, 6) || "-"}</td>
                <td>{s.guestName || "-"}</td>
                <td>{formatRooms(s.roomNumber)}</td>
                <td>{fmt(s.checkInDate)}</td>
                <td>{fmt(s.checkOutDate)}</td>
                <td>
                  {can("canViewReservations") && s.reservationId ? (
                    <Link className="btn-primary" to={`/reservations/${normalizeResId(s.reservationId)}`}>
                      See details
                    </Link>
                  ) : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
