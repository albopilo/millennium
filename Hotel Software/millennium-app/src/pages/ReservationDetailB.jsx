// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css";

export default function ReservationDetailB({
  reservation,
  assignRooms = [],
  setAssignRooms,
  rooms = [],
  stays = [],
  canOperate,
  canUpgrade,
  renderAssignmentRow,
  doCheckIn,
  doCheckOut,
  printCheckInForm,
  printCheckOutBill,
  doChangeRoom,
  doUpgradePreCheckIn,
  doUpgradeRoom,
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
  handleDeleteReservation,
  navigate,
  isAdmin,
  fmt = (d) => (d ? new Date(d).toLocaleDateString() : "-"),
  logReservationChange,
}) {
  const safeCall = async (fn, ...args) =>
    typeof fn === "function" ? await fn(...args) : null;

  if (!reservation)
    return <div className="p-4 text-gray-500">Reservation loading…</div>;

  // === ACTION HANDLERS ===
  const handleCheckIn = async () => {
    await safeCall(doCheckIn);
    await safeCall(logReservationChange, "check_in", {});
  };

  const handleCheckOut = async () => {
    await safeCall(doCheckOut);
    await safeCall(logReservationChange, "check_out", {});
  };

  const handleChangeRoom = async () => {
    await safeCall(doChangeRoom, moveRoomStay, newRoom);
    await safeCall(logReservationChange, "change_room", {
      from: moveRoomStay?.roomNumber,
      to: newRoom,
    });
    setMoveRoomStay(null);
    setNewRoom("");
  };

  const handleUpgradeBeforeCheckIn = async () => {
    await safeCall(doUpgradePreCheckIn, upgradeIndex, upgradePreRoom, 0);
    await safeCall(logReservationChange, "upgrade_pre_checkin", {
      to: upgradePreRoom,
    });
    setUpgradeIndex(null);
    setUpgradePreRoom("");
  };

  const handleUpgradeAfterCheckIn = async () => {
    await safeCall(doUpgradeRoom, upgradeStay, upgradeRoom, 0);
    await safeCall(logReservationChange, "upgrade_room", {
      from: upgradeStay?.roomNumber,
      to: upgradeRoom,
    });
    setUpgradeStay(null);
    setUpgradeRoom("");
  };

  // === UI ===
  return (
    <div className="reservation-detail-container">
      {/* Header */}
      <div className="card header-card">
        <div className="card-header">
          <h2>Reservation: {reservation.guestName || "—"}</h2>
          <div className="actions">
            {isAdmin && (
              <>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate?.(`/reservations/${reservation.id}/edit`)}
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => safeCall(handleDeleteReservation)}
                >
                  Delete
                </button>
              </>
            )}
          </div>
        </div>
        <div className="card-body summary-grid">
          <div>
            <strong>Guest:</strong> {reservation.guestName}
          </div>
          <div>
            <strong>Stay:</strong> {fmt(reservation.checkInDate)} →{" "}
            {fmt(reservation.checkOutDate)}
          </div>
          <div>
            <strong>Status:</strong> {reservation.status}
          </div>
          <div>
            <strong>Channel:</strong> {reservation.channel}
          </div>
        </div>
      </div>

      {/* === Pre Check-In Section === */}
      {reservation.status?.toLowerCase() === "booked" && (
        <div className="card">
          <div className="card-header">
            <h3>Pre Check-In</h3>
          </div>
          <div className="card-body">
            <label>Assign Rooms</label>
            <div className="assign-list">
              {(assignRooms.length ? assignRooms : [""]).map((_, i) => (
                <div key={i} className="assign-row">
                  {typeof renderAssignmentRow === "function" ? (
                    renderAssignmentRow(i)
                  ) : (
                    <select
                      value={assignRooms[i] || ""}
                      onChange={(e) => {
                        const updated = [...assignRooms];
                        updated[i] = e.target.value;
                        setAssignRooms(updated);
                      }}
                    >
                      <option value="">(Select)</option>
                      {rooms.map((r) => (
                        <option key={r.roomNumber} value={r.roomNumber}>
                          {r.roomNumber} ({r.roomType})
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>

            <div className="btn-group">
              {canOperate && (
                <button className="btn btn-primary" onClick={handleCheckIn}>
                  Check In
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => safeCall(printCheckInForm)}
              >
                Print Check-In Form
              </button>
            </div>

            {/* Upgrade Before Check-In */}
            {canUpgrade && (
              <div className="upgrade-block">
                <h4>Upgrade Before Check-In</h4>
                <select
                  value={upgradeIndex ?? ""}
                  onChange={(e) =>
                    setUpgradeIndex(
                      e.target.value === "" ? null : Number(e.target.value)
                    )
                  }
                >
                  <option value="">Select index</option>
                  {assignRooms.map((rm, i) => (
                    <option key={i} value={i}>
                      #{i + 1}: {rm || "(unassigned)"}
                    </option>
                  ))}
                </select>

                {upgradeIndex != null && (
                  <>
                    <select
                      style={{ marginTop: 8 }}
                      value={upgradePreRoom}
                      onChange={(e) => setUpgradePreRoom(e.target.value)}
                    >
                      <option value="">Select new room</option>
                      {preUpgradeOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <div className="btn-group">
                      <button
                        className="btn btn-primary"
                        onClick={handleUpgradeBeforeCheckIn}
                        disabled={!upgradePreRoom}
                      >
                        Confirm
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          setUpgradeIndex(null);
                          setUpgradePreRoom("");
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* === In-House Section === */}
      {stays.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>In-House</h3>
          </div>
          <div className="card-body">
            <div>
              <strong>Open stays:</strong>{" "}
              {stays
                .filter((s) => s.status === "open")
                .map((s) => s.roomNumber)
                .join(", ") || "—"}
            </div>

            <div className="btn-group" style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary"
                disabled={!stays.some((s) => s.status === "open")}
                onClick={() =>
                  setMoveRoomStay(stays.find((s) => s.status === "open"))
                }
              >
                Change Room
              </button>
              {canUpgrade && (
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    setUpgradeStay(stays.find((s) => s.status === "open"))
                  }
                >
                  Upgrade Room
                </button>
              )}
              <button className="btn btn-danger" onClick={handleCheckOut}>
                Check Out
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => safeCall(printCheckInForm)}
              >
                Print Check-In Form
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => safeCall(printCheckOutBill)}
              >
                Print Check-Out Bill
              </button>
            </div>

            {/* Change Room */}
            {moveRoomStay && (
              <div className="action-box">
                <h4>Change Room</h4>
                <div>
                  Current: <strong>{moveRoomStay.roomNumber}</strong>
                </div>
                <select
                  value={newRoom}
                  onChange={(e) => setNewRoom(e.target.value)}
                >
                  <option value="">Select room</option>
                  {sameTypeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="btn-group">
                  <button
                    className="btn btn-primary"
                    disabled={!newRoom}
                    onClick={handleChangeRoom}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setMoveRoomStay(null);
                      setNewRoom("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Upgrade After Check-In */}
            {upgradeStay && (
              <div className="action-box">
                <h4>Upgrade Room (After Check-In)</h4>
                <div>
                  Current: <strong>{upgradeStay.roomNumber}</strong>
                </div>
                <select
                  value={upgradeRoom}
                  onChange={(e) => setUpgradeRoom(e.target.value)}
                >
                  <option value="">Select room</option>
                  {upgradeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <div className="btn-group">
                  <button
                    className="btn btn-primary"
                    disabled={!upgradeRoom}
                    onClick={handleUpgradeAfterCheckIn}
                  >
                    Confirm
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => {
                      setUpgradeStay(null);
                      setUpgradeRoom("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
