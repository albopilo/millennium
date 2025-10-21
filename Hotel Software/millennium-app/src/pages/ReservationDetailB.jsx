// src/pages/ReservationDetailB.jsx
import React, { useState } from "react";
import "../styles/ReservationDetail.css";

/**
 * ReservationDetailB
 * - Displays reservation summary and action buttons
 * - Calls doCheckIn/doCheckOut/changeRoom/upgradeRoom passed from parent
 * - Responsible for conditional print button visibility per your rule
 */

export default function ReservationDetailB({
  reservation,
  guest,
  stays = [],
  settings = {},
  canOperate = false,
  doCheckIn,
  doCheckOut,
  changeRoom,
  upgradeRoom,
  printCheckInForm,
  printCheckOutBill,
  balance,
}) {
  const [processing, setProcessing] = useState(false);
  const status = (reservation.status || "").toLowerCase();

  const handleCheckIn = async () => {
    try {
      setProcessing(true);
      await doCheckIn();
      alert("Checked in");
    } catch (err) {
      alert(err.message || "Check-in failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleCheckOut = async () => {
    try {
      setProcessing(true);
      // prompt whether to auto-post room charge per default
      const doAuto = window.confirm("Auto-post room checkout adjustment? OK = yes, Cancel = no");
      await doCheckOut({ autoPost: doAuto });
      alert("Checked out");
    } catch (err) {
      alert(err.message || "Check-out failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleChangeRoom = async () => {
    const fromRoom = prompt("Current room number to change (e.g., 101):");
    if (!fromRoom) return;
    const toRoom = prompt("New room number:");
    if (!toRoom) return;
    const note = prompt("Optional note:");
    try {
      setProcessing(true);
      await changeRoom({ fromRoom, toRoom, note });
      alert("Room changed");
    } catch (err) {
      alert(err.message || "Change room failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleUpgradeRoom = async () => {
    const fromRoom = prompt("From room number:");
    if (!fromRoom) return;
    const toRoom = prompt("To room number:");
    if (!toRoom) return;
    const charge = prompt("Upgrade charge amount (numeric):", "0");
    const note = prompt("Optional note:");
    try {
      setProcessing(true);
      await upgradeRoom({ fromRoom, toRoom, upgradeCharge: Number(charge || 0), note });
      alert("Room upgraded");
    } catch (err) {
      alert(err.message || "Upgrade failed");
    } finally {
      setProcessing(false);
    }
  };

  const statusBadge = () => {
    const s = status;
    let cls = "badge muted";
    if (s === "booked") cls = "badge badge-gray";
    if (s === "checked-in") cls = "badge badge-blue";
    if (s === "checked-out") cls = "badge badge-green";
    return <span className={cls}>{reservation.status}</span>;
  };

  return (
    <div className="card panel">
      <div className="panel-header">
        <div>
          <h3>{guest?.fullName || reservation.guestName || "Guest"}</h3>
          <div className="muted">
            {new Date(reservation.checkInDate || Date.now()).toLocaleString()} →{" "}
            {reservation.checkOutDate ? new Date(reservation.checkOutDate).toLocaleString() : "—"}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {statusBadge()}
          <div style={{ textAlign: "right" }}>
            <div className="muted">Balance</div>
            <div style={{ fontWeight: 700 }}>{settings.currency || "IDR"} {balance !== undefined ? Number(balance).toLocaleString("id-ID") : "-"}</div>
          </div>
        </div>
      </div>

      <div className="panel-body">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div><strong>Rooms</strong></div>
            <div className="muted">{Array.isArray(reservation.roomNumbers) ? reservation.roomNumbers.join(", ") : reservation.roomNumber || "-"}</div>
          </div>

          <div style={{ textAlign: "right" }}>
            <div><strong>Channel</strong></div>
            <div className="muted">{reservation.channel || "-"}</div>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          {/* Check-in / check-out */}
          {canOperate && status === "booked" && (
            <>
              <button className="btn btn-primary" onClick={handleCheckIn} disabled={processing}>Check In</button>
              {/* Print check-in visible unless reservation already checked-out */}
              {reservation.status?.toLowerCase() !== "checked-out" && (
                <button className="btn btn-secondary" onClick={printCheckInForm}>Print Check-In Form</button>
              )}
            </>
          )}

          {canOperate && status === "checked-in" && (
            <>
              <button className="btn btn-warning" onClick={handleCheckOut} disabled={processing}>Check Out</button>
              {/* hide print check-out form when still checked-in (per your rule) */}
            </>
          )}

          {canOperate && status === "checked-out" && (
            <>
              {/* show print check-out when checked-out */}
              <button className="btn btn-secondary" onClick={printCheckOutBill}>Print Check-Out / Bill</button>
            </>
          )}

          {canOperate && (
            <>
              <button className="btn btn-outline" onClick={handleChangeRoom}>Change Room</button>
              <button className="btn btn-outline" onClick={handleUpgradeRoom}>Upgrade Room</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
