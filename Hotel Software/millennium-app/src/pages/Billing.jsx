// src/pages/Billing.jsx
import { useEffect, useState } from "react";
import { doc, getDoc, collection, addDoc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import AppLayout from "../AppLayout";
import { computeFolioTotal } from "../lib/folio";
// usage in Billing.jsx (record payment)
import { getGateway } from "../lib/payments";

async function takePayment(reservationId, amount, settings) {
  const gw = getGateway(settings.gateway || "none");
  const res = await gw.charge({ amount, currency: settings.currency || "IDR", description: `Payment for ${reservationId}`, reference: reservationId });
  // add doc to payments, update folio/balance...
}

export default function Billing({ permissions }) {
  const [reservation, setReservation] = useState(null);
  const [folio, setFolio] = useState({ items: [] });
  const [settings, setSettings] = useState({ taxPct: 0, servicePct: 0 });

  // ...load reservation, folio (by reservationId), finance settings...
  // ...render items, input to add charges, show totals...

  const totals = computeFolioTotal({ items: folio.items, ...settings });

  return (
    <AppLayout title="Billing" permissions={permissions}>
      {/* Folio UI with add item, payment, totals */}
      <div>
        <div>Subtotal: {totals.subtotal}</div>
        <div>Service ({settings.servicePct}%): {totals.service}</div>
        <div>Tax ({settings.taxPct}%): {totals.tax}</div>
        <div><strong>Total: {totals.total}</strong></div>
      </div>
    </AppLayout>
  );
}