// src/pages/ReservationDetailB.jsx
import React from "react";
import "../styles/ReservationDetail.css"; // optional shared style

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
  handleDeleteReservation,
  navigate,
  isAdmin,
  fmt,
  logReservationChange,
  currentUser,
  children,
}) {
  // Safe handler helper
  const safeCall = async (fn, ...args) => {
    if (typeof fn === "function") return await fn(...args);
  };

  // --- Wrapped Actions (with logging) ---
  const handleDoCheckIn = async () => {
    await safeCall(doCheckIn);
    await safeCall(logReservationChange, "check_in", { data: null });
  };

  const handleDoCheckOut = async () => {
    await safeCall(doCheckOut);
    await safeCall(logReservationChange, "checkout", {
      data: {
        penalty: settings?.earlyDeparturePenalty || 0,
        refund: settings?.earlyDepartureRefund || 0,
      },
    });
  };

  const handleConfirmChangeRoom = async () => {
    await safeCall(doChangeRoom);
    await safeCall(logReservationChange, "change_room", {
      data: {
        from: moveRoomStay?.roomNumber || null,
        to: newRoom || null,
      },
    });
  };

  const handleConfirmUpgradePreCheckIn = async () => {
    await safeCall(doUpgradePreCheckIn);
    await safeCall(logReservationChange, "upgrade_pre_checkin", {
      data: { index: upgradeIndex, to: upgradePreRoom },
    });
  };

  const handleConfirmUpgradeRoom = async () => {
    await safeCall(doUpgradeRoom);
    await safeCall(logReservationChange, "upgrade_room", {
      data: { from: upgradeStay?.roomNumber, to: upgradeRoom },
    });
  };

  if (!reservation) return <div className="p-4 text-gray-500">Loading reservation...</div>;

  // --- Helper renderers ---
  const Section = ({ title, children }) => (
    <section className="reservation-section">
      <h3 className="section-title">{title}</h3>
      {children}
    </section>
  );

  // ============================
  // Main Render
  // ============================
  return (
    <div className="reservation-detail-container">
      {/* Header */}
      <div className="header-row">
        <h2 className="title">Reservation Detail</h2>
        <div className="header-actions">
          {isAdmin && (
            <>
              <button
                className="btn btn-primary"
                onClick={() => navigate(`/reservations/${reservation.id}/edit`)}
              >
                Edit
              </button>
              <button className="btn btn-danger" onClick={handleDeleteReservation}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary */}
      <Section title="Summary">
        <div className="summary-grid">
          <div><strong>Guest:</strong> {reservation.guestName || "-"} {guest?.tier ? `(${guest.tier})` : ""}</div>
          <div><strong>Stay:</strong> {fmt(reservation.checkInDate)} → {fmt(reservation.checkOutDate)}</div>
          <div><strong>Status:</strong> {reservation.status || "-"}</div>
          <div><strong>Channel:</strong> {reservation.channel || "-"}</div>
          <div><strong>Assigned Rooms:</strong> {Array.isArray(reservation.roomNumbers)
            ? reservation.roomNumbers.join(", ")
            : reservation.roomNumber || "-"}</div>
        </div>
      </Section>

      {/* BOOKED STATE */}
      {reservation.status?.toLowerCase() === "booked" && (
        <Section title="Pre Check-In">
          <label>Assign Rooms</label>
          <div className="assign-list">
            {(assignRooms.length ? assignRooms : [""]).map((_, i) => renderAssignmentRow?.(i))}
          </div>

          {canOperate && (
            <div className="btn-group">
              <button className="btn btn-primary" onClick={handleDoCheckIn}>Check In</button>
              <button className="btn btn-secondary" onClick={printCheckInForm}>Print Form</button>
            </div>
          )}

          {canUpgrade && (
            <div className="upgrade-section">
              <h4>Upgrade Before Check-In</h4>
              <label>Room Index</label>
              <select
                value={upgradeIndex ?? ""}
                onChange={(e) => setUpgradeIndex(e.target.value === "" ? null : Number(e.target.value))}
              >
                <option value="">Select</option>
                {assignRooms.map((rm, i) => (
                  <option key={i} value={i}>{`#${i + 1}: ${rm || "(unassigned)"}`}</option>
                ))}
              </select>

              {upgradeIndex != null && (
                <>
                  <label>New Room</label>
                  <select
                    value={upgradePreRoom}
                    onChange={(e) => setUpgradePreRoom(e.target.value)}
                  >
                    <option value="">Select</option>
                    {preUpgradeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>

                  <div className="btn-group">
                    <button
                      className="btn btn-primary"
                      onClick={handleConfirmUpgradePreCheckIn}
                      disabled={!upgradePreRoom}
                    >
                      Confirm Upgrade
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
        </Section>
      )}

      {/* CHECKED-IN / IN-HOUSE */}
      {stays?.length > 0 && (
        <Section title="In-House Guests">
          <p>
            <strong>Active rooms:</strong>{" "}
            {stays.filter((s) => s.status === "open").map((s) => s.roomNumber).join(", ") || "—"}
          </p>

          {canOperate && reservation.status === "checked-in" && (
            <div className="btn-group">
              <button
                className="btn btn-primary"
                disabled={!stays.some((s) => s.status === "open")}
                onClick={() => setMoveRoomStay(stays.find((s) => s.status === "open"))}
              >
                Change Room
              </button>
              {canUpgrade && (
                <button
                  className="btn btn-primary"
                  onClick={() => setUpgradeStay(stays.find((s) => s.status === "open"))}
                >
                  Upgrade Room
                </button>
              )}
              <button className="btn btn-danger" onClick={handleDoCheckOut}>
                Check Out
              </button>
              <button className="btn btn-secondary" onClick={printCheckInForm}>
                Print Check-In Form
              </button>
              <button className="btn btn-secondary" onClick={printCheckOutBill}>
                Print Bill
              </button>
            </div>
          )}
        </Section>
      )}

      {/* ROOM CHANGE */}
      {moveRoomStay && (
        <Section title="Change Room">
          <p><strong>Current Room:</strong> {moveRoomStay.roomNumber}</p>
          <label>New Room (Same Type)</label>
          <select value={newRoom} onChange={(e) => setNewRoom(e.target.value)}>
            <option value="">Select Room</option>
            {sameTypeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="btn-group">
            <button className="btn btn-primary" onClick={handleConfirmChangeRoom} disabled={!newRoom}>
              Confirm
            </button>
            <button className="btn btn-secondary" onClick={() => { setMoveRoomStay(null); setNewRoom(""); }}>
              Cancel
            </button>
          </div>
        </Section>
      )}

      {/* ROOM UPGRADE */}
      {canUpgrade && upgradeStay && (
        <Section title="Upgrade Room">
          <p><strong>Current Room:</strong> {upgradeStay.roomNumber}</p>
          <label>New Room</label>
          <select value={upgradeRoom} onChange={(e) => setUpgradeRoom(e.target.value)}>
            <option value="">Select Room</option>
            {upgradeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <div className="btn-group">
            <button className="btn btn-primary" onClick={handleConfirmUpgradeRoom} disabled={!upgradeRoom}>
              Confirm
            </button>
            <button className="btn btn-secondary" onClick={() => { setUpgradeStay(null); setUpgradeRoom(""); }}>
              Cancel
            </button>
          </div>
        </Section>
      )}

      {/* CHILD COMPONENT (C) INJECTION */}
      {children &&
        React.cloneElement(children, {
          reservation,
          guest,
          settings,
          rooms,
          currentUser,
          logReservationChange,
          checkoutReservation: handleDoCheckOut,
          printCheckInForm,
          printCheckOutBill,
        })}
    </div>
  );
}
