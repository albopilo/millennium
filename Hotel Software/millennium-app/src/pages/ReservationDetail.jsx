import React from "react";
import ReservationDetailA from "./ReservationDetailA";

// ✅ ReservationDetailA already includes ReservationDetailB  C internally
// This wrapper just exists for routing or layout consistency.
export default function ReservationDetailPage(props) {
  return (
    <div className="reservations-container">
      <ReservationDetailA {...props} />
    </div>
  );
}