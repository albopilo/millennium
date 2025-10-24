// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css";
import useMountLogger from "../hooks/useMountLogger";


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
  printCheckOutBill,
  preUpgradeOptions = [],
  sameTypeOptions = [],
  upgradeOptions = [],
  moveRoomStay,
  setMoveRoomStay,
  newRoom,
  setNewRoom,
  upgradeStay,
  setUpgradeStay,
  upgradeRoom,
  setUpgradeRoom,
  upgradeIndex,
  setUpgradeIndex,
  upgradePreRoom,
  setUpgradePreRoom,
  doUpgradePreCheckIn,
  doUpgradeRoom,
  stays = [],
  doNoShow,
  handleEditReservation,
  handleDeleteReservation,
  navigate,
  isAdmin,
  fmt,
  logReservationChange
}) {
  useMountLogger("ReservationDetailB");

  if (!reservation) return <div className="p-4">Loading reservation...</div>;

  const status = (reservation.status || "").toLowerCase();

  return (
    <div className="reservation-detail-container card">
      <div className="card-header">
        <h2>Reservation Detail</h2>
        <div className="header-actions">
                  {reservation.status === "booked" && canOperate && (
  <button onClick={doNoShow} className="btn btn-warning">Mark No Show</button>
)}
{/* Removed navigation-based edit to prevent blank page */}
          {isAdmin && (
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => handleEditReservation && handleEditReservation()}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => handleDeleteReservation && handleDeleteReservation()}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="card-body">
        <div className="summary-grid">
          <div><strong>Guest:</strong> {reservation.guestName || "-" } {guest?.tier ? `(${guest.tier})` : ""}</div>
          <div><strong>Stay:</strong> {fmt(reservation.checkInDate)} → {fmt(reservation.checkOutDate)}</div>
          <div><strong>Status:</strong> {reservation.status || "-"}</div>
          <div><strong>Channel:</strong> {reservation.channel || "-"}</div>
          <div><strong>Assigned Rooms:</strong> {Array.isArray(reservation.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation.roomNumber || "-"}</div>
        </div>

        {status === "booked" && (
          <section className="reservation-section">
            <h3 className="section-title">Pre Check-In</h3>
            <label>Assign Rooms</label>
            <div className="assign-list">
              {(assignRooms.length ? assignRooms : [""]).map((_, i) => renderAssignmentRow?.(i))}
            </div>

{canOperate && (
              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={doCheckIn}>Check In</button>
              </div>
            )}
          </section>
        )}

        {stays?.length > 0 && (
          <section className="reservation-section">
            <h3 className="section-title">In-House Guests</h3>
            <p><strong>Active rooms:</strong> {stays.filter(s => s.status === "open").map(s => s.roomNumber).join(", ") || "—"}</p>
 {canOperate && (
             <div className="btn-group" style={{ marginTop: 8 }}>
                {/* Show buttons dynamically based on reservation status */}
                {status === "checked-in" && (
                  <>
                    <button className="btn btn-primary" onClick={doCheckOut}>Check Out</button>
                    <button
                      className="btn btn-outline"
                      onClick={printCheckInForm}>
                      Print Check-In Form
                    </button>
                  </>
                )}

                {status === "checked-out" && (
                  <button
                    className="btn btn-outline"
                    onClick={printCheckOutBill}>
                    Print Check-Out Form
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {/* Move / Upgrade UIs simplified (keep functions) */}
        {moveRoomStay && (
          <section className="reservation-section">
            <h3 className="section-title">Move Room</h3>
            <p><strong>From:</strong> {moveRoomStay.roomNumber}</p>
            <label>New Room (Same Type)</label>
            <select value={newRoom} onChange={(e) => setNewRoom(e.target.value)}>
              <option value="">Select Room</option>
              {sameTypeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
            <div className="btn-group" style={{ marginTop: 8 }}>
              <button className="btn btn-primary" onClick={() => { /* wrapper handled in parent */ }}>Confirm</button>
              <button className="btn btn-secondary" onClick={() => { setMoveRoomStay(null); setNewRoom(""); }}>Cancel</button>
            </div>
          </section>
        )}

        {canUpgrade && (
          <section className="reservation-section">
            <h3 className="section-title">Upgrades</h3>
            <label>Upgrade Before Check-In</label>
            <select value={upgradeIndex ?? ""} onChange={(e) => setUpgradeIndex(e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Select</option>
              {assignRooms.map((rm, i) => <option key={i} value={i}>{`#${i+1}: ${rm || "(unassigned)"}`}</option>)}
            </select>
            {upgradeIndex != null && (
              <>
                <label>New Room</label>
                <select value={upgradePreRoom} onChange={(e) => setUpgradePreRoom(e.target.value)}>
                  <option value="">Select</option>
                  {preUpgradeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
                <div className="btn-group">
                  <button className="btn btn-primary" onClick={() => doUpgradePreCheckIn && doUpgradePreCheckIn()} disabled={!upgradePreRoom}>Confirm Upgrade</button>
                  <button className="btn btn-secondary" onClick={() => { setUpgradeIndex(null); setUpgradePreRoom(""); }}>Cancel</button>
                </div>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
