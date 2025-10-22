// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailB({
  reservation,
  guest,
  settings,
  rooms = [],
  assignRooms = [],
  renderAssignmentRow,
  setAssignRooms,
  canOperate,
  canUpgrade,
  doCheckIn,
  doCheckOut,
  printCheckInForm,
  printCheckOutForm,
  stays = [],
  handleDeleteReservation,
  isAdmin,
  navigate,
  fmt,
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
        <div className="header-actions">
          {isAdmin && (
            <>
              <button className="btn btn-primary" onClick={() => navigate(`/reservations/${reservation.id}/edit`)}>Edit</button>
              <button className="btn btn-danger" onClick={handleDeleteReservation}>Delete</button>
            </>
          )}
        </div>
      </div>

      <section className="reservation-section">
        <h3 className="section-title">Summary</h3>
        <div className="summary-grid">
          <div><strong>Guest</strong><div>{reservation.guestName || "-"}</div></div>
          <div><strong>Channel</strong><div>{reservation.channel || "-"}</div></div>
          <div><strong>Status</strong><div>{reservation.status || "-"}</div></div>
          <div><strong>Assigned Rooms</strong><div>{(Array.isArray(reservation.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation.roomNumber) || "-"}</div></div>
        </div>
      </section>

      {/* Pre check-in */}
      {status === "booked" && (
        <section className="reservation-section">
          <h3 className="section-title">Pre Check-In</h3>
          <label>Assign Rooms</label>
          <div className="assign-list">
            {(assignRooms.length ? assignRooms : [""]).map((_, i) => renderAssignmentRow?.(i))}
          </div>

          <div className="btn-group">
            {canOperate && <button className="btn btn-primary" onClick={doCheckIn}>Check In</button>}
            {/* Print Check-In should be hidden when reservation is checked-out; that means we show it now since status === booked */}
            <button className="btn btn-secondary" onClick={printCheckInForm}>Print Check-In Form</button>
          </div>
        </section>
      )}

      {/* In-house */}
      {stays?.some(s => s.status === "open") && (
        <section className="reservation-section">
          <h3 className="section-title">In-House</h3>
          <p><strong>Active Rooms:</strong> {stays.filter(s => s.status === "open").map(s => s.roomNumber).join(", ")}</p>
          <div className="btn-group">
            {canOperate && <button className="btn btn-warning" onClick={doCheckOut}>Check Out</button>}
            {/* Print Check-Out should be hidden while still checked-in; we only display it when reservation.status === checked-out. So hide now. */}
          </div>
        </section>
      )}

      {/* If checked-out, show print check-out button */}
      {status === "checked-out" && (
        <section className="reservation-section">
          <h3 className="section-title">Post Check-Out</h3>
          <div className="btn-group">
            <button className="btn btn-secondary" onClick={printCheckOutForm}>Print Check-Out Bill</button>
          </div>
        </section>
      )}
    </div>
  );
}
