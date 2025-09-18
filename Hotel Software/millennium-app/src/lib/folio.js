// src/lib/folio.js
export function computeFolioTotal({ items = [], taxPct = 0, servicePct = 0 }) {
  const subtotal = items.reduce((s, it) => s + Number(it.amount || 0) * Number(it.qty || 1), 0);
  const service = subtotal * (servicePct / 100);
  const tax = (subtotal + service) * (taxPct / 100);
  const total = Math.round((subtotal + service + tax) * 100) / 100;
  return { subtotal, service, tax, total };
}