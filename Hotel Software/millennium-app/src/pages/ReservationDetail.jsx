import React from "react";
import ReservationDetailA from "./ReservationDetailA";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

export default function ReservationDetailPage(props) {
  return (
    <div className="reservations-container">
      <ReservationDetailA {...props} />
      <ReservationDetailB {...props} />
      <ReservationDetailC {...props} />
    </div>
  );
}
