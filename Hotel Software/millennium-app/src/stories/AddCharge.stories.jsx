import React from "react";
import ReservationDetailC from "../pages/ReservationDetailC";

export default {
  title: "Folio/AddChargeModal",
  component: ReservationDetailC,
};

const Template = (args) => <ReservationDetailC {...args} />;

export const EmptyFolio = Template.bind({});
EmptyFolio.args = {
  reservation: { id: "r1" },
  postings: [],
  payments: [],
  submitCharge: async (data) => {
    // simulate response
    console.log("submitCharge", data);
  },
  submitPayment: async (data) => {
    console.log("submitPayment", data);
  },
  currency: "IDR",
};
