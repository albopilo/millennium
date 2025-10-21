import React from "react";
import ReservationDetailC from "../pages/ReservationDetailC";

export default {
  title: "Folio/AddPaymentModal",
  component: ReservationDetailC,
};

export const WithPayments = (args) => <ReservationDetailC {...args} />;
WithPayments.args = {
  reservation: { id: "r1" },
  postings: [
    { id: "p1", description: "Room Basic", amount: 500000 },
  ],
  payments: [{ id: "pay1", amount: 200000, method: "cash", capturedAt: new Date() }],
  submitCharge: async (data) => console.log("charge", data),
  submitPayment: async (data) => console.log("payment", data),
  currency: "IDR",
};
