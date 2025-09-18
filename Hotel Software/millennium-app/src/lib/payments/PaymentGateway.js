// src/lib/payments/PaymentGateway.js
export class PaymentGateway {
  async charge({ amount, currency, description, reference }) {
    throw new Error("Not implemented");
  }
}