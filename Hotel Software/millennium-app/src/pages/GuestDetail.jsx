// src/pages/GuestDetail.jsx
import { useParams, useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { fmt } from "../lib/dates";

export default function GuestDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [guest, setGuest] = useState(null);
  const [reservations, setReservations] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        // Load guest data
        const gSnap = await getDoc(doc(db, "guests", id));
        if (gSnap.exists()) setGuest(gSnap.data());

        // Load active reservations
        const qActive = query(
          collection(db, "reservations"),
          where("guestId", "==", id),
          where("status", "in", ["booked", "checked-in", "cancelled"])
        );
        const resSnap = await getDocs(qActive);

        // Load deleted reservations
        const qDeleted = query(
          collection(db, "deleted_reservations"),
          where("guestId", "==", id)
        );
        const delSnap = await getDocs(qDeleted);

        const actives = resSnap.docs.map(d => ({ id: d.id, status: d.data().status, ...d.data() }));
        const deleteds = delSnap.docs.map(d => ({ id: d.id, status: "deleted", ...d.data() }));

        setReservations([...actives, ...deleteds]);
      } catch (err) {
        console.error("Error loading guest detail:", err);
      }
    }

    loadData();
  }, [id]);

  if (!guest) return <div>Loading…</div>;

  const formatRooms = (rooms) => {
    if (!rooms) return "-";
    return Array.isArray(rooms) ? rooms.join(", ") : rooms;
  };

  return (
    <div className="guest-detail">
      <button
        className="btn-secondary"
        style={{ marginBottom: "12px" }}
        onClick={() => navigate(-1)}
      >
        ← Back
      </button>

      <h2>{guest.name}</h2>
      <p><b>Email:</b> {guest.email || "—"}</p>
      <p><b>Phone:</b> {guest.phone || "—"}</p>
      <p><b>City:</b> {guest.city || "—"}</p>
      <p><b>Company:</b> {guest.company || "—"}</p>
      <p><b>KTP:</b> {guest.ktpNumber || "—"}</p>

      <h3>Reservations</h3>
      <table className="reservations-table">
        <thead>
          <tr>
            <th>Res ID</th>
            <th>Check-In</th>
            <th>Check-Out</th>
            <th>Status</th>
            <th>Room(s)</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map(r => (
            <tr key={r.id} className={r.status === "deleted" ? "deleted" : ""}>
              <td>{r.resNo || r.id}</td>
              <td>{fmt(r.checkInDate)}</td>
              <td>{fmt(r.checkOutDate)}</td>
              <td>{r.status}</td>
              <td>{formatRooms(r.roomNumbers)}</td>
              <td>
                {r.status !== "deleted" ? (
                  <Link to={`/reservations/${r.id}`} className="btn-primary">
                    See details
                  </Link>
                ) : (
                  <span style={{ color: "red" }}>Deleted</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
