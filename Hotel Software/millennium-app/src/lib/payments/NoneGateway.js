// src/lib/payments/NoneGateway.js
import { PaymentGateway } from "./PaymentGateway";
export default class NoneGateway extends PaymentGateway {
  async charge({ amount }) { return { status: "simulated", id: `SIM-${Date.now()}`, amount }; }
}