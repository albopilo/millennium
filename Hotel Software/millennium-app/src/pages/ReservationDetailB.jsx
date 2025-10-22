// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailB({
  reservation,
  assignRooms = [],
  setAssignRooms,
  doCheckIn,
  doCheckOut,
  printCheckInForm,
  printCheckOutForm,
  stays = [],
  fmt = (d) => d
}) {
  if (!reservation) return null;
  const status = (reservation.status || "").toLowerCase();

  return (
    <div className="reservation-detail-container card">
      <div className="header-row">
        <div>
          <h2 style={{ margin: 0 }}>{reservation.guestName || "Reservation"}</h2>
          <div className="muted">{fmt(reservation.checkInDate)} → {fmt(reservation.checkOutDate)}</div>
        </div>
        <div className="header-actions" style={{ display: "flex", gap: 8 }}>
          {/* Print buttons visible according to rules */}
          {(status !== "checked-out") && (
            <button className="btn btn-secondary" onClick={printCheckInForm}>Print Check-In Form</button>
          )}
          {(status === "checked-out") && (
            <button className="btn btn-secondary" onClick={printCheckOutForm}>Print Check-Out Form</button>
          )}
        </div>
      </div>

      <section className="reservation-section">
        <h3 className="section-title">Summary</h3>
        <div className="summary-grid">
          <div><strong>Guest</strong><div>{reservation.guestName}</div></div>
          <div><strong>Channel</strong><div>{reservation.channel}</div></div>
          <div><strong>Status</strong><div>{reservation.status}</div></div>
          <div><strong>Assigned Rooms</strong><div>{(Array.isArray(reservation.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation.roomNumber) || "-"}</div></div>
        </div>
      </section>

      {/* Pre check-in */}
      {status === "booked" && (
        <section className="reservation-section">
          <h3 className="section-title">Pre Check-In</h3>
          <label>Assign Rooms</label>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {(assignRooms.length ? assignRooms : [""]).map((r, i) => (
              <input key={i} value={r} onChange={(e) => {
                const next = [...assignRooms];
                next[i] = e.target.value;
                setAssignRooms(next);
              }} placeholder="Room number (e.g., 311)" />
            ))}
            <button className="btn btn-outline" onClick={() => setAssignRooms([...assignRooms, ""])}>+ Add room</button>
          </div>
          <div className="btn-group">
            <button className="btn btn-primary" onClick={doCheckIn}>Check In</button>
          </div>
        </section>
      )}

      {/* In-house */}
      {status === "checked-in" && (
        <section className="reservation-section">
          <h3 className="section-title">In-House</h3>
          <div style={{ marginBottom: 8 }}>
            <strong>Active Rooms:</strong> {stays.filter(s => s.status === "open").map(s => s.roomNumber).join(", ")}
          </div>
          <div className="btn-group">
            <button className="btn btn-warning" onClick={doCheckOut}>Check Out</button>
            {/* Print check-in hidden when checked-in? We show check-in print while not checked-out; that's already handled in header */}
          </div>
        </section>
      )}

      {/* Checked-out */}
      {status === "checked-out" && (
        <section className="reservation-section">
          <h3 className="section-title">Post Check-Out</h3>
          <div className="muted">Reservation checked-out on {fmt(reservation.checkedOutAt)}</div>
        </section>
      )}
    </div>
  );
}
