// src/pages/Reservations.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import useRequireNightAudit from "../hooks/useRequireNightAudit";
import { checkRoomBlocks } from "../lib/availability";
import { todayStr, ymd } from "../lib/dates";
import "./Reservations.css";

/* ------------------ Utilities ------------------ */
const JAKARTA_TZ = "Asia/Jakarta";

function nowJakarta() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: JAKARTA_TZ }));
}

function minCheckInDate() {
  const now = nowJakarta();
  const allowYesterday = now.getHours() < 4;
  const base = new Date(now);
  if (allowYesterday) base.setDate(base.getDate() - 1);
  return ymd(base);
}

function showError(msg) {
  alert(msg);
}

/* ------------------ Hooks ------------------ */
function useReferenceData(ready) {
  const [data, setData] = useState({
    rooms: [],
    channels: [],
    guests: [],
    events: [],
    rates: [],
    depositPerRoom: 0,
    loading: true,
  });

  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const [rooms, channels, guests, events, rates, settings] = await Promise.all([
          getDocs(collection(db, "rooms")),
          getDocs(collection(db, "channels")),
          getDocs(collection(db, "guests")),
          getDocs(collection(db, "events")),
          getDocs(collection(db, "rates")),
          getDoc(doc(db, "settings", "general")),
        ]);

        setData({
          rooms: rooms.docs.map((d) => d.data()),
          channels: channels.docs.map((d) => d.data()),
          guests: guests.docs.map((d) => ({ id: d.id, ...d.data() })),
          events: events.docs.map((d) => d.data()),
          rates: rates.docs.map((d) => ({ id: d.id, ...d.data() })),
          depositPerRoom: Number(settings.data()?.depositPerRoom || 0),
          loading: false,
        });
      } catch (err) {
        console.error("Failed loading reference data:", err);
        setData((prev) => ({ ...prev, loading: false }));
      }
    })();
  }, [ready]);

  return data;
}

/* ------------------ Core Logic ------------------ */
function useRateCalculator({ rooms, events, rates, depositPerRoom }) {
  const calc = (guest, form) => {
    if (!form.roomNumbers.length || !form.channel || !form.checkInDate || !form.checkOutDate) return 0;

    const checkIn = new Date(form.checkInDate + "T00:00:00");
    const checkOut = new Date(form.checkOutDate + "T00:00:00");
    if (!(checkOut > checkIn)) return 0;

    const nights = [];
    for (let d = new Date(checkIn); d < checkOut; d.setDate(d.getDate() + 1)) {
      nights.push(new Date(d));
    }

    const rateFor = (roomType, channel, date) => {
      const chId = (channel || "").toLowerCase();
      const r = rates.find(
        (x) => x.roomType?.trim() === roomType?.trim() && (x.channelId || "").toLowerCase() === chId
      );
      if (!r) return 0;
      if (chId === "direct") {
        const day = date.getDay();
        const isWeekend = day === 0 || day === 6;
        return isWeekend ? Number(r.weekendRate || 0) : Number(r.weekdayRate || 0);
      }
      return Number(r.price || 0);
    };

    const getEventRate = (date, roomType, baseRate) => {
      const ev = events.find((ev) => {
        const s = new Date(ev.startDate);
        const e = new Date(ev.endDate);
        return date >= s && date <= e;
      });
      if (ev && ev.rateType === "custom" && ev.customRates?.[roomType])
        return ev.customRates[roomType];
      return baseRate;
    };

    const selectedRooms = form.roomNumbers
      .map((num) => rooms.find((r) => r.roomNumber === num))
      .filter(Boolean);

    let total = 0;
    for (const room of selectedRooms) {
      for (const d of nights) {
        const base = rateFor(room.roomType, form.channel, d);
        total += getEventRate(d, room.roomType, base);
      }
    }

    // Loyalty discount
    let discount = 0;
    if (guest?.tier && form.channel.toLowerCase() === "direct") {
      if (guest.tier === "Silver") discount = 0.05;
      if (guest.tier === "Gold") discount = 0.1;
    }

    total *= 1 - discount;

    // Deposit
    total += depositPerRoom * form.roomNumbers.length;
    return Math.round(total);
  };

  return { calc };
}

/* ------------------ Reservation Page ------------------ */
export default function Reservations({ permissions = [], currentUser = null }) {
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const actor = currentUser?.id || currentUser?.email || "frontdesk";
  const navigate = useNavigate();
  const { ready } = useRequireNightAudit(7);
  const { rooms, channels, guests, events, rates, depositPerRoom, loading } = useReferenceData(ready);
  const { calc } = useRateCalculator({ rooms, events, rates, depositPerRoom });

  const [form, setForm] = useState({
    guestId: "",
    guestName: "",
    checkInDate: todayStr(),
    checkOutDate: ymd(new Date(Date.now() + 86400000)),
    roomNumbers: [],
    channel: "",
    rate: 0,
  });

  const selectedGuest = useMemo(
    () => guests.find((g) => g.name === form.guestName) || null,
    [guests, form.guestName]
  );

  // Auto recalc rate
  useEffect(() => {
    if (ready && !loading) {
      const rate = calc(selectedGuest, form);
      setForm((prev) => ({ ...prev, rate }));
    }
  }, [form.channel, form.roomNumbers, form.checkInDate, form.checkOutDate, selectedGuest, ready, loading]);

  async function validate(form) {
    const inDate = new Date(form.checkInDate + "T00:00:00");
    const outDate = new Date(form.checkOutDate + "T00:00:00");
    if (!form.guestName.trim()) throw new Error("Guest name required");
    if (!(outDate > inDate)) throw new Error("Check-out must be after check-in");

    const { blocked, conflicts } = await checkRoomBlocks(form.roomNumbers, inDate, outDate);
    if (blocked)
      throw new Error("Blocked rooms: " + conflicts.map((c) => c.roomNumber).join(", "));

    for (const room of form.roomNumbers) {
      const qRooms = query(
        collection(db, "reservations"),
        where("roomNumbers", "array-contains", room),
        where("status", "in", ["booked", "checked-in"])
      );
      const snap = await getDocs(qRooms);
      const overlap = snap.docs.some((d) => {
        const r = d.data();
        const exIn = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
        const exOut = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
        return !(outDate <= exIn || inDate >= exOut);
      });
      if (overlap) throw new Error(`Room ${room} is already booked`);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (!can("canCreateReservations")) throw new Error("No permission");
      await validate(form);

      const inDate = new Date(form.checkInDate + "T00:00:00");
      const outDate = new Date(form.checkOutDate + "T00:00:00");

      const ref = await addDoc(collection(db, "reservations"), {
        ...form,
        guestId: selectedGuest?.id || null,
        checkInDate: Timestamp.fromDate(inDate),
        checkOutDate: Timestamp.fromDate(outDate),
        createdAt: new Date(),
        createdBy: actor,
        status: "booked",
      });

      navigate(`/reservations/${ref.id}`);
    } catch (err) {
      showError(err.message || String(err));
    }
  }

  if (!ready)
    return (
      <div>
        <h3>Night Audit Required</h3>
        <button onClick={() => navigate("/night-audit")}>Run Night Audit</button>
      </div>
    );

  if (loading) return <p>Loading reference data...</p>;

  return (
    <div className="reservations-container">
      <h2>Create Reservation</h2>
      <form onSubmit={handleSubmit} className="reservation-form">
        <label>Guest</label>
        <select
          value={form.guestName}
          onChange={(e) => {
            const name = e.target.value;
            const g = guests.find((x) => x.name === name);
            setForm((f) => ({ ...f, guestName: name, guestId: g?.id || "" }));
          }}
        >
          <option value="">Select Guest</option>
          {guests.map((g) => (
            <option key={g.id} value={g.name}>
              {g.name} {g.tier ? `(${g.tier})` : ""}
            </option>
          ))}
        </select>

        <label>Check-in</label>
        <input
          type="date"
          min={minCheckInDate()}
          value={form.checkInDate}
          onChange={(e) => setForm((f) => ({ ...f, checkInDate: e.target.value }))}
        />

        <label>Check-out</label>
        <input
          type="date"
          min={form.checkInDate}
          value={form.checkOutDate}
          onChange={(e) => setForm((f) => ({ ...f, checkOutDate: e.target.value }))}
        />

        <label>Rooms</label>
        <select
          multiple
          value={form.roomNumbers}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              roomNumbers: Array.from(e.target.selectedOptions, (opt) => opt.value),
            }))
          }
        >
          {rooms.map((r) => (
            <option key={r.roomNumber} value={r.roomNumber}>
              {r.roomNumber} ({r.roomType})
            </option>
          ))}
        </select>

        <label>Channel</label>
        <select
          value={form.channel}
          onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}
        >
          <option value="">Select Channel</option>
          {channels.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        <label>Total</label>
        <input type="number" value={form.rate} readOnly />

        <button type="submit" className="btn-primary">
          Save & Open
        </button>
      </form>
    </div>
  );
}
