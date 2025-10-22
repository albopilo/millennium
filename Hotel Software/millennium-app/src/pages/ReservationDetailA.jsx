
// src/pages/ReservationDetailA.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  runTransaction,
  query,
  where,
  onSnapshot,
  orderBy,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { fmt, ymd } from "../lib/dates";
import ReservationDetailB from "./ReservationDetailB";
import ReservationDetailC from "./ReservationDetailC";

export default function ReservationDetailA({ permissions = [], currentUser, userData }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const actorName =
    currentUser?.displayName ||
    currentUser?.name ||
    currentUser?.email ||
    "frontdesk";
  const isAdmin = userData?.roleId === "admin";

  // === Core states ===
  const [reservation, setReservation] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [guest, setGuest] = useState(null);
  const [settings, setSettings] = useState({ currency: "IDR", depositPerRoom: 0 });
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [channels, setChannels] = useState([]);
  const [stays, setStays] = useState([]);
  const [postings, setPostings] = useState([]);
  const [payments, setPayments] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const canOperate = can("canOperateFrontDesk") || can("canEditReservations");

  const [assignRooms, setAssignRooms] = useState([]);
  const [showAddCharge, setShowAddCharge] = useState(false);
  const [showAddPayment, setShowAddPayment] = useState(false);

  // Simple numeric-friendly states
  const [chargeForm, setChargeForm] = useState({
    description: "",
    qtyStr: "1",
    unitStr: "",
    accountCode: "MISC",
  });

  const [paymentForm, setPaymentForm] = useState({
    amountStr: "",
    method: "cash",
    refNo: "",
  });

  const currency = settings.currency || "IDR";
  const fmtMoney = (n) =>
    isNaN(n) ? "-" : Number(n).toLocaleString("id-ID", { minimumFractionDigits: 0 });

  // === Load data ===
  const load = async () => {
    setLoading(true);
    try {
      const [resSnap, roomsSnap, settingsSnap, ratesSnap, eventsSnap, channelsSnap] = await Promise.all([
        getDoc(doc(db, "reservations", id)),
        getDocs(collection(db, "rooms")),
        getDoc(doc(db, "settings", "general")),
        getDocs(collection(db, "rates")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "channels")),
      ]);
      if (!resSnap.exists()) return navigate("/calendar");
      const res = { id: resSnap.id, ...resSnap.data() };
      setReservation(res);
      setRooms(roomsSnap.docs.map((d) => d.data()));
      if (settingsSnap.exists()) setSettings(settingsSnap.data());
      setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setChannels(channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Load guest
      if (res.guestId) {
        const gSnap = await getDoc(doc(db, "guests", res.guestId));
        if (gSnap.exists()) setGuest({ id: gSnap.id, ...gSnap.data() });
      }

      // Load folio
      const [pSnap, paySnap] = await Promise.all([
        getDocs(query(collection(db, "postings"), where("reservationId", "==", id))),
        getDocs(query(collection(db, "payments"), where("reservationId", "==", id))),
      ]);
      setPostings(pSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setPayments(paySnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      // Stays
      const sSnap = await getDocs(query(collection(db, "stays"), where("reservationId", "==", id)));
      setStays(sSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

      setAssignRooms(Array.isArray(res.roomNumbers) ? [...res.roomNumbers] : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) load();
  }, [id]);

  // === Live log subscription ===
  useEffect(() => {
    if (!id) return;
    const ref = collection(doc(db, "reservations", id), "logs");
    const q = query(ref, orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [id]);

  // === Derived folio values ===
  const statusOf = (p) => (p.status || "").toLowerCase();
  const acctOf = (p) => (p.accountCode || "").toUpperCase();
  const visiblePostings = useMemo(
    () => postings.filter((p) => statusOf(p) !== "void"),
    [postings]
  );

  const displayChargeLines = visiblePostings.filter((p) => acctOf(p) !== "PAY");
  const displayChargesTotal = displayChargeLines.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );
  const displayPaymentsTotal = payments.reduce(
    (sum, p) => sum + Number(p.amount || 0),
    0
  );
  const displayBalance = displayChargesTotal - displayPaymentsTotal;

  // === Submit handlers (no debounce / free typing) ===
  const submitCharge = async () => {
    const qty = parseFloat(chargeForm.qtyStr) || 1;
    const unit = parseFloat(chargeForm.unitStr) || 0;
    const total = qty * unit;
    if (!chargeForm.description.trim()) return alert("Description required.");
    if (total <= 0) return alert("Total must be > 0");
    const status = (reservation?.status || "").toLowerCase() === "checked-in" ? "posted" : "forecast";
    await addDoc(collection(db, "postings"), {
      reservationId: id,
      description: chargeForm.description.trim(),
      accountCode: (chargeForm.accountCode || "MISC").toUpperCase(),
      amount: total,
      quantity: qty,
      unitAmount: unit,
      status,
      createdAt: new Date(),
      createdBy: actorName,
    });
    setChargeForm({ description: "", qtyStr: "1", unitStr: "", accountCode: "MISC" });
    setShowAddCharge(false);
    await load();
  };

  const submitPayment = async () => {
    const amt = parseFloat(paymentForm.amountStr) || 0;
    if (amt <= 0) return alert("Payment must be > 0");
    await addDoc(collection(db, "payments"), {
      reservationId: id,
      amount: amt,
      method: paymentForm.method || "cash",
      refNo: paymentForm.refNo || "",
      capturedAt: new Date(),
      capturedBy: actorName,
    });
    setPaymentForm({ amountStr: "", method: "cash", refNo: "" });
    setShowAddPayment(false);
    await load();
  };

  // === UI ===
  if (loading) return <div className="p-6 text-center">Loading reservation…</div>;
  if (!reservation) return <div className="p-6 text-center text-gray-600">Reservation not found.</div>;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-800 mb-2">
        Reservation Detail
      </h2>

      <ReservationDetailB
        reservation={reservation}
        guest={guest}
        rooms={rooms}
        assignRooms={assignRooms}
        setAssignRooms={setAssignRooms}
        canOperate={canOperate}
      />

      <ReservationDetailC
        reservation={reservation}
        displayChargeLines={displayChargeLines}
        displayChargesTotal={displayChargesTotal}
        displayPaymentsTotal={displayPaymentsTotal}
        displayBalance={displayBalance}
        currency={currency}
        showAddCharge={showAddCharge}
        setShowAddCharge={setShowAddCharge}
        chargeForm={chargeForm}
        setChargeForm={setChargeForm}
        submitCharge={submitCharge}
        showAddPayment={showAddPayment}
        setShowAddPayment={setShowAddPayment}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        submitPayment={submitPayment}
      />

      {/* === Add Charge Modal === */}
      {showAddCharge && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-md w-96">
            <h3 className="text-lg font-semibold mb-4">Add Charge</h3>
            <input
              className="border rounded-md w-full mb-3 p-2"
              placeholder="Description"
              value={chargeForm.description}
              onChange={(e) =>
                setChargeForm({ ...chargeForm, description: e.target.value })
              }
            />
            <div className="flex gap-3 mb-3">
              <input
                type="number"
                className="border rounded-md w-1/2 p-2"
                placeholder="Qty"
                value={chargeForm.qtyStr}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, qtyStr: e.target.value })
                }
              />
              <input
                type="number"
                className="border rounded-md w-1/2 p-2"
                placeholder="Unit"
                value={chargeForm.unitStr}
                onChange={(e) =>
                  setChargeForm({ ...chargeForm, unitStr: e.target.value })
                }
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md"
                onClick={() => setShowAddCharge(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-blue-600 text-white rounded-md"
                onClick={submitCharge}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Add Payment Modal === */}
      {showAddPayment && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-md w-96">
            <h3 className="text-lg font-semibold mb-4">Add Payment</h3>
            <input
              type="number"
              className="border rounded-md w-full mb-3 p-2"
              placeholder="Amount"
              value={paymentForm.amountStr}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, amountStr: e.target.value })
              }
            />
            <input
              className="border rounded-md w-full mb-3 p-2"
              placeholder="Reference No"
              value={paymentForm.refNo}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, refNo: e.target.value })
              }
            />
            <select
              className="border rounded-md w-full mb-3 p-2"
              value={paymentForm.method}
              onChange={(e) =>
                setPaymentForm({ ...paymentForm, method: e.target.value })
              }
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Transfer</option>
            </select>
            <div className="flex justify-end gap-3">
              <button
                className="px-4 py-2 bg-gray-200 rounded-md"
                onClick={() => setShowAddPayment(false)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 bg-green-600 text-white rounded-md"
                onClick={submitPayment}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Logs === */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <header className="px-4 py-2 border-b bg-gray-50 rounded-t-xl">
          <h3 className="font-semibold text-gray-700">Change Log</h3>
        </header>
        <div className="p-4 space-y-2 max-h-72 overflow-y-auto text-sm">
          {logs.length === 0 ? (
            <div className="text-gray-500 italic">No logs yet.</div>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="border-b pb-2">
                <div className="font-medium">{l.action?.toUpperCase()}</div>
                <div className="text-gray-600 text-xs">
                  by {l.by || "Unknown"} at{" "}
                  {new Date(l.createdAt?.seconds * 1000 || Date.now()).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}