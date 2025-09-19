// src/pages/ReservationDetailB.jsx
import React, { useState, useEffect } from "react";
import { addDoc, collection, serverTimestamp, doc, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";


export default function ReservationDetailB(props) {
  const {
    reservation,
    guest,
    settings,
    rooms,
    assignRooms,
    renderAssignmentRow,
    setAssignRooms,
    canOperate,
    canUpgrade,
    doCheckIn,
    printCheckInForm,
    upgradeIndex,
    setUpgradeIndex,
    preUpgradeOptions,
    upgradePreRoom,
    setUpgradePreRoom,
    doUpgradePreCheckIn,
    stays,
    setMoveRoomStay,
    setUpgradeStay,
    canOverrideBilling,
    doCheckOut,
    printCheckOutBill,
    moveRoomStay,
    newRoom,
    setNewRoom,
    sameTypeOptions,
    doChangeRoom,
    upgradeStay,
    upgradeRoom,
    setUpgradeRoom,
    upgradeOptions,
    doUpgradeRoom,
    handleDeleteReservation,
    isAdmin,
    navigate,
    fmt,
    currentUser, // pass from parent auth context if available
    children,    // allow rendering ReservationDetailC inside
   } = props;

   const [logs, setLogs] = useState([]);

   // Logging helper
  async function logReservationChange({ action, data = null }) {
    if (!reservation?.id) return;

    const entry = {
      reservationId: reservation.id,
      action,
      data,
      actorUid: currentUser?.uid || null,
      actorEmail: currentUser?.email || "unknown",
      actorDisplay: currentUser?.displayName || null,
      createdAt: serverTimestamp(),
    };

    try {
      // Scoped log under this reservation
      await addDoc(collection(doc(db, "reservations", reservation.id), "logs"), entry);

      // (Optional) also keep global log collection
      await addDoc(collection(db, "reservationLogs"), entry);
    } catch (err) {
      console.error("Failed to write reservation log", err);
    }
  }

  // Subscribe to logs for this reservation
  useEffect(() => {
    if (!reservation?.id) return;
    const q = query(
      collection(doc(db, "reservations", reservation.id), "logs"),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [reservation?.id]);

  // Defensive: don't attempt to render if reservation isn't available yet
  if (!reservation) {
    return null;
  }

  return (
    <div className="reservations-container">
      <h2 style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Reservation Detail</span>

        {isAdmin && (
          <button
            onClick={() => navigate(`/reservations/${reservation.id}/edit`)}
            style={{ backgroundColor: "#2563eb", color: "#fff", marginRight: "8px" }}
          >
            Edit Reservation
          </button>
        )}

        {isAdmin && (
          <button className="btn btn-danger" onClick={handleDeleteReservation}>
            Delete Reservation
          </button>
        )}
      </h2>

      {/* Summary */}
      <div className="reservation-form" style={{ marginBottom: 12 }}>
        <label>Guest</label>
        <div>
          {reservation?.guestName || "-"} {guest?.tier ? `(${guest.tier})` : ""}
        </div>
        <label>Stay</label>
        <div>
          {fmt(reservation?.checkInDate)} → {fmt(reservation?.checkOutDate)}
        </div>
        <label>Status</label>
        <div>{reservation?.status || "-"}</div>
        <label>Channel</label>
        <div>{reservation?.channel || "-"}</div>
        <label>Assigned rooms</label>
        <div>
          {Array.isArray(reservation?.roomNumbers)
            ? reservation.roomNumbers.join(", ")
            : reservation?.roomNumber || "-"}
        </div>
      </div>

      {/* Check-in / Pre-check-in upgrades */}
      {((reservation.status || "").toLowerCase() === "booked") && (
        <div className="reservation-form" style={{ marginBottom: 12 }}>
          <h4>Check-In</h4>

          <label>Assign rooms (locked by type per index)</label>
          <div>
            {(assignRooms.length ? assignRooms : [""]).map((_, idx) =>
              renderAssignmentRow(idx)
            )}
          </div>

          <div className="form-actions" style={{ marginTop: 8 }}>
            {canOperate && (
              <>
                <button className="btn-primary" onClick={doCheckIn}>
                  Check In
                </button>
                <button onClick={printCheckInForm} style={{ marginLeft: 8 }}>
                  Print Check-In Form
                </button>
              </>
            )}
          </div>

          {canUpgrade && assignRooms.length > 0 && (
            <>
              <h5 style={{ marginTop: 16 }}>Upgrade (different type, before check-in)</h5>
              <label>Select room index to upgrade</label>
              <select
                value={upgradeIndex ?? ""}
                onChange={(e) =>
                  setUpgradeIndex(e.target.value === "" ? null : Number(e.target.value))
                }
              >
                <option value="">Choose index</option>
                {assignRooms.map((rm, i) => (
                  <option key={i} value={i}>
                    #{i + 1}: {rm || "(unassigned)"}
                  </option>
                ))}
              </select>

              {upgradeIndex != null && (
                <>
                  <label>New room (different type allowed)</label>
                  <select
                    value={upgradePreRoom}
                    onChange={(e) => setUpgradePreRoom(e.target.value)}
                  >
                    <option value="">Select room</option>
                    {preUpgradeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <div className="form-actions" style={{ marginTop: 8 }}>
                    <button
                      className="btn-primary"
                      onClick={doUpgradePreCheckIn}
                      disabled={!upgradePreRoom}
                    >
                      Confirm Upgrade
                    </button>
                    <button
                      style={{ marginLeft: 8 }}
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
            </>
          )}
        </div>
      )}

      {/* In-House controls (checked-in) */}
      {stays.length > 0 && (
        <>
          <div className="reservation-form" style={{ marginBottom: 12 }}>
            <h4>In-House</h4>

            <label>Open stays</label>
            <div>
              {stays.filter((s) => s.status === "open").length
                ? stays
                    .filter((s) => s.status === "open")
                    .map((s) => s.roomNumber)
                    .join(", ")
                : "-"}
            </div>

            <div className="form-actions" style={{ marginTop: 8 }}>
              {canOperate && (reservation.status === "checked-in") && (
                <>
                  <button
                    className="btn-primary"
                    onClick={() =>
                      setMoveRoomStay(stays.find((s) => s.status === "open") || null)
                    }
                    disabled={!stays.some((s) => s.status === "open")}
                  >
                    Change Room (same type)
                  </button>

                  {canUpgrade && (
                    <button
                      className="btn-primary"
                      style={{ marginLeft: 8 }}
                      onClick={() =>
                        setUpgradeStay(stays.find((s) => s.status === "open") || null)
                      }
                      disabled={!stays.some((s) => s.status === "open")}
                    >
                      Upgrade Room (different type)
                    </button>
                  )}

                  <button
                    className="btn-primary"
                    style={{ marginLeft: 8 }}
                    onClick={doCheckOut}
                    disabled={stays.every((s) => s.status !== "open")}
                  >
                    Check Out
                  </button>

                  {/* ✅ Added so check-in form can be printed even after checked in */}
                  <button style={{ marginLeft: 8 }} onClick={printCheckInForm}>
                    Print Check-In Form
                  </button>

                  <button style={{ marginLeft: 8 }} onClick={printCheckOutBill}>
                    Print Check-Out Bill
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Change room panel */}
          {moveRoomStay && (
            <div className="reservation-form" style={{ marginBottom: 12 }}>
              <label>Current room</label>
              <div>{moveRoomStay.roomNumber}</div>

              <label>New room (same type)</label>
              <select value={newRoom} onChange={(e) => setNewRoom(e.target.value)}>
                <option value="">Select room</option>
                {sameTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="form-actions">
                <button className="btn-primary" onClick={doChangeRoom} disabled={!newRoom}>
                  Confirm Change
                </button>
                <button
                  style={{ marginLeft: 8 }}
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

          {/* Upgrade room panel */}
          {canUpgrade && upgradeStay && (
            <div className="reservation-form" style={{ marginBottom: 12 }}>
              <label>Current room</label>
              <div>{upgradeStay.roomNumber}</div>

              <label>New room (different type allowed)</label>
              <select value={upgradeRoom} onChange={(e) => setUpgradeRoom(e.target.value)}>
                <option value="">Select room</option>
                {upgradeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>

              <div className="form-actions">
                <button
                  className="btn-primary"
                  onClick={doUpgradeRoom}
                  disabled={!upgradeRoom}
                >
                  Confirm Upgrade
                </button>
                <button
                  style={{ marginLeft: 8 }}
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
        </>
      )}
      {/* ✅ Inject children such as ReservationDetailC with logging support */}
      {children &&
        React.cloneElement(children, {
          reservation,
          guest,
          settings,
          rooms,
          logReservationChange,  // pass logger down
        })}

        {/* ✅ Logs Timeline */}
      <div className="reservation-form" style={{ marginTop: 24 }}>
        <h4>Change Log</h4>
        {logs.length === 0 && <div style={{ fontStyle: "italic" }}>No changes logged yet.</div>}
        <ul style={{ listStyle: "none", paddingLeft: 0 }}>
          {logs.map((log) => (
            <li key={log.id} style={{ marginBottom: 8, borderBottom: "1px solid #eee", paddingBottom: 6 }}>
              <div>
                <strong>{log.action}</strong>{" "}
                {log.data && <code>{JSON.stringify(log.data)}</code>}
              </div>
              <div style={{ fontSize: "0.85em", color: "#555" }}>
                By: {log.actorDisplay || log.actorEmail}{" "}
                {log.createdAt?.toDate
                  ? `at ${log.createdAt.toDate().toLocaleString()}`
                  : ""}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
