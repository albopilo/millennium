// src/lib/payments/index.js
import NoneGateway from "./NoneGateway";
// import MidtransGateway from "./MidtransGateway";
// import StripeGateway from "./StripeGateway";
export function getGateway(name) {
  switch (name) {
    // case "midtrans": return new MidtransGateway();
    // case "stripe": return new StripeGateway();
    default: return new NoneGateway();
  }
}