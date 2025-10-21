// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailB(props) {
  const {
    reservation,
    guest,
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
    doChangeRoom,
    doUpgradePreCheckIn,
    doUpgradeRoom,
    stays = [],
    handleDeleteReservation,
    navigate,
    isAdmin,
    fmt,
    logReservationChange,
    currentUser,
    children,
  } = props;

  // Safe call helper (only call if function)
  const safeCall = async (fn, ...args) => {
    if (typeof fn === "function") return await fn(...args);
  };

  // Wrapped actions that log (if logger exists)
  const handleDoCheckIn = async () => {
    await safeCall(doCheckIn);
    await safeCall(logReservationChange, "check_in", { data: null });
  };

  const handleDoCheckOut = async () => {
    await safeCall(doCheckOut);
    await safeCall(logReservationChange, "checkout", { data: null });
  };

  const handleConfirmChangeRoom = async () => {
    await safeCall(doChangeRoom, moveRoomStay, newRoom);
    await safeCall(logReservationChange, "change_room", { from: moveRoomStay?.roomNumber, to: newRoom });
    setMoveRoomStay(null);
    setNewRoom("");
  };

  const handleConfirmUpgradePreCheckIn = async () => {
    // For this UI we allow user to keep an optional adjustment field in future.
    await safeCall(doUpgradePreCheckIn, upgradeIndex, upgradePreRoom, 0);
    await safeCall(logReservationChange, "upgrade_pre_checkin", { index: upgradeIndex, to: upgradePreRoom });
    setUpgradeIndex(null);
    setUpgradePreRoom("");
  };

  const handleConfirmUpgradeRoom = async () => {
    await safeCall(doUpgradeRoom, upgradeStay, upgradeRoom, 0);
    await safeCall(logReservationChange, "upgrade_room", { from: upgradeStay?.roomNumber, to: upgradeRoom });
    setUpgradeStay(null);
    setUpgradeRoom("");
  };

  if (!reservation) {
    return <div className="p-4 text-gray-500">Reservation loading...</div>;
  }

  return (
    <div className="reservation-detail-container">
      {/* Header */}
      <div className="header-row">
        <h2 className="title">Reservation: {reservation.guestName || "-"}</h2>
        <div className="header-actions">
          {isAdmin && (
            <>
              <button className="btn btn-primary" onClick={() => navigate?.(`/reservations/${reservation.id}/edit`)}>
                Edit
              </button>
              <button className="btn btn-danger" onClick={() => safeCall(handleDeleteReservation)}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="reservation-section">
        <h3 className="section-title">Summary</h3>
        <div className="summary-grid">
          <div><strong>Guest:</strong> {reservation.guestName || "-"}</div>
          <div><strong>Stay:</strong> {fmt(reservation.checkInDate)} → {fmt(reservation.checkOutDate)}</div>
          <div><strong>Status:</strong> {reservation.status || "-"}</div>
          <div><strong>Channel:</strong> {reservation.channel || "-"}</div>
          <div style={{ gridColumn: "1 / -1" }}>
            <strong>Assigned Rooms:</strong>{" "}
            {(assignRooms && assignRooms.length) ? assignRooms.join(", ") : "-"}
          </div>
        </div>
      </div>

      {/* Pre Check-In (assign rooms) */}
      {String((reservation.status || "").toLowerCase()) === "booked" && (
        <div className="reservation-section">
          <h3 className="section-title">Pre Check-In</h3>
          <label>Assign Rooms (type is locked by index)</label>
          <div className="assign-list" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {(assignRooms.length ? assignRooms : [""]).map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* renderAssignmentRow returns a select element bound to persisting logic */}
                {typeof renderAssignmentRow === "function" ? renderAssignmentRow(i) : (
                  <select
                    value={assignRooms[i] || ""}
                    onChange={async (e) => {
                      const next = [...assignRooms];
                      next[i] = e.target.value;
                      setAssignRooms && setAssignRooms(next);
                    }}
                  >
                    <option value="">(select)</option>
                    {rooms.map((r) => <option key={r.roomNumber} value={r.roomNumber}>{r.roomNumber} ({r.roomType})</option>)}
                  </select>
                )}
                <div style={{ fontSize: 13, color: "#64748b" }}>{/* helper area */}</div>
              </div>
            ))}
          </div>

          <div className="btn-group" style={{ marginTop: 12 }}>
            {canOperate && <button className="btn btn-primary" onClick={handleDoCheckIn}>Check In</button>}
            <button className="btn btn-secondary" onClick={() => safeCall(printCheckInForm)}>Print Form</button>
          </div>

          {/* upgrade before check-in */}
          {canUpgrade && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ margin: "8px 0" }}>Upgrade Before Check-In</h4>
              <label>Room Index</label>
              <select value={upgradeIndex ?? ""} onChange={(e) => setUpgradeIndex && setUpgradeIndex(e.target.value === "" ? null : Number(e.target.value))}>
                <option value="">Select index</option>
                {assignRooms.map((rm, i) => <option key={i} value={i}>{`#${i + 1}: ${rm || "(unassigned)"} `}</option>)}
              </select>

              {upgradeIndex != null && (
                <>
                  <label style={{ marginTop: 8 }}>New Room</label>
                  <select value={upgradePreRoom || ""} onChange={(e) => setUpgradePreRoom && setUpgradePreRoom(e.target.value)}>
                    <option value="">Select</option>
                    {preUpgradeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>

                  <div className="btn-group" style={{ marginTop: 8 }}>
                    <button className="btn btn-primary" onClick={handleConfirmUpgradePreCheckIn} disabled={!upgradePreRoom}>Confirm Upgrade</button>
                    <button className="btn btn-secondary" onClick={() => { setUpgradeIndex && setUpgradeIndex(null); setUpgradePreRoom && setUpgradePreRoom(""); }}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* In-house controls */}
      {Array.isArray(stays) && stays.length > 0 && (
        <div className="reservation-section">
          <h3 className="section-title">In-House</h3>
          <div style={{ marginBottom: 8 }}>
            <strong>Open stays:</strong> {stays.filter(s => s.status === "open").map(s => s.roomNumber).join(", ") || "—"}
          </div>

          <div className="btn-group">
            <button className="btn btn-primary" disabled={!stays.some(s => s.status === "open")} onClick={() => setMoveRoomStay && setMoveRoomStay(stays.find(s => s.status === "open"))}>
              Change Room
            </button>
            {canUpgrade && <button className="btn btn-primary" onClick={() => setUpgradeStay && setUpgradeStay(stays.find(s => s.status === "open"))}>Upgrade Room</button>}
            <button className="btn btn-danger" onClick={handleDoCheckOut}>Check Out</button>
            <button className="btn btn-secondary" onClick={() => safeCall(printCheckInForm)}>Print Check-In Form</button>
            <button className="btn btn-secondary" onClick={() => safeCall(printCheckOutBill)}>Print Check-Out Bill</button>
          </div>

          {/* change room panel */}
          {moveRoomStay && (
            <div style={{ marginTop: 12 }}>
              <h4>Change Room (same type)</h4>
              <div><strong>Current room:</strong> {moveRoomStay.roomNumber}</div>
              <label>New room (same type)</label>
              <select value={newRoom || ""} onChange={(e) => setNewRoom && setNewRoom(e.target.value)}>
                <option value="">Select room</option>
                {sameTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleConfirmChangeRoom} disabled={!newRoom}>Confirm</button>
                <button className="btn btn-secondary" onClick={() => { setMoveRoomStay && setMoveRoomStay(null); setNewRoom && setNewRoom(""); }}>Cancel</button>
              </div>
            </div>
          )}

          {/* upgrade after check-in */}
          {upgradeStay && (
            <div style={{ marginTop: 12 }}>
              <h4>Upgrade Room (post check-in)</h4>
              <div><strong>Current room:</strong> {upgradeStay.roomNumber}</div>
              <label>New room</label>
              <select value={upgradeRoom || ""} onChange={(e) => setUpgradeRoom && setUpgradeRoom(e.target.value)}>
                <option value="">Select</option>
                {upgradeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div className="btn-group" style={{ marginTop: 8 }}>
                <button className="btn btn-primary" onClick={handleConfirmUpgradeRoom} disabled={!upgradeRoom}>Confirm</button>
                <button className="btn btn-secondary" onClick={() => { setUpgradeStay && setUpgradeStay(null); setUpgradeRoom && setUpgradeRoom(""); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* allow injection of children (folio) */}
      {children && React.cloneElement(children, { reservation, guest, rooms })}
    </div>
  );
}
