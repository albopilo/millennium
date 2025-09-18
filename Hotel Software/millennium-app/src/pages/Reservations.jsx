// src/pages/Reservations.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  addDoc,
  collection,
  getDocs,
  getDoc,
  updateDoc,
  doc,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import "./Reservations.css";
import { checkRoomBlocks } from "../lib/availability";
import { todayStr, ymd } from "../lib/dates";
import useRequireNightAudit from "../hooks/useRequireNightAudit";

function minCheckInDateForJakarta() {
  // create a Date object in Asia/Jakarta timezone (GMT+7) as local time string
  const nowJakarta = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  // if hotel's business day hasn't rolled past 04:00 local, allow yesterday
  const allowYesterday = nowJakarta.getHours() < 4;
  const dt = allowYesterday ? new Date(nowJakarta.getFullYear(), nowJakarta.getMonth(), nowJakarta.getDate() - 1) : new Date(nowJakarta.getFullYear(), nowJakarta.getMonth(), nowJakarta.getDate());
  return ymd(dt); // uses your existing ymd function to format 'YYYY-MM-DD'
}


export default function Reservations({ permissions = [], currentUser = null }) {
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");
  const actor = currentUser?.id || currentUser?.email || "frontdesk";
  const navigate = useNavigate();

  // 🔹 Night audit hook
  const { ready } = useRequireNightAudit(7);

  // 🔹 ALL HOOKS AT THE TOP
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [guests, setGuests] = useState([]);
  const [depositPerRoom, setDepositPerRoom] = useState(0);
  const [rates, setRates] = useState([]);

  const [form, setForm] = useState({
    guestName: "",
    guestId: "",
    checkInDate: todayStr(),
    checkOutDate: (() => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return ymd(d);
    })(),
    roomNumbers: [],
    channel: "",
    rate: 0,
    status: "booked",
  });

  const [errors, setErrors] = useState({});
  const [birthdayApplied, setBirthdayApplied] = useState(false);

  // 🔹 Selected guest memo
  const selectedGuest = useMemo(() => {
    return guests.find((g) => g.name === form.guestName) || null;
  }, [guests, form.guestName]);

  // 🔹 Room types memo
  const roomTypes = useMemo(() => {
    return Array.from(new Set(rooms.map((r) => r.roomType).filter(Boolean)));
  }, [rooms]);

  // 🔹 Load reference data
  useEffect(() => {
    if (!ready) return;

    (async () => {
      try {
        const roomSnap = await getDocs(collection(db, "rooms"));
        setRooms(roomSnap.docs.map((d) => d.data()));

        const chanSnap = await getDocs(collection(db, "channels"));
        setChannels(chanSnap.docs.map((d) => d.data()));

        const eventSnap = await getDocs(collection(db, "events"));
        setEvents(eventSnap.docs.map((d) => d.data()));

        const guestSnap = await getDocs(collection(db, "guests"));
        setGuests(
          guestSnap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        );

        const settingsSnap = await getDoc(doc(db, "settings", "general"));
        if (settingsSnap.exists()) {
          setDepositPerRoom(Number(settingsSnap.data().depositPerRoom || 0));
        }

        const ratesSnap = await getDocs(collection(db, "rates"));
        setRates(
          ratesSnap.docs.map((d) => ({
            id: d.id,
            ...d.data(),
            roomType: (d.data().roomType || "").trim(),
            channelId: (d.data().channelId || "").toLowerCase(),
          }))
        );
      } catch (err) {
        console.error("Error loading reference data:", err);
      }
    })();
  }, [ready]);

  // 🔹 Helpers
  const getEventForDate = (date) =>
    events.find((ev) => {
      const start = new Date(ev.startDate);
      const end = new Date(ev.endDate);
      return date >= start && date <= end;
    });

  const rateFor = (roomType, channelName, date) => {
    const channelId = (channelName || "").toLowerCase();
    const rd = rates.find(
      (r) =>
        (r.roomType || "").trim() === (roomType || "").trim() &&
        (r.channelId || "").toLowerCase() === channelId
    );
    if (!rd) return 0;

    if (channelId === "direct") {
      const day = date.getDay();
      const isWeekend = day === 0 || day === 6;
      return isWeekend ? Number(rd.weekendRate || 0) : Number(rd.weekdayRate || 0);
    }
    return Number(rd.price || 0);
  };

  function datesInStay(inStr, outStr) {
    const start = new Date(inStr + "T00:00:00");
    const end = new Date(outStr + "T00:00:00");
    const list = [];
    const cur = new Date(start);
    while (cur < end) {
      list.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return list;
  }

  function sameMonthDay(d1, d2) {
    return d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  }

  // 🔹 Compute total rate (birthday/tier perks)
  useEffect(() => {
    if (!ready) return;
    if (!form.channel || !form.roomNumbers.length || !form.checkInDate || !form.checkOutDate) return;

    const checkIn = new Date(form.checkInDate + "T00:00:00");
    const checkOut = new Date(form.checkOutDate + "T00:00:00");
    if (!(checkOut > checkIn)) {
      setErrors((prev) => ({ ...prev, date: "Check-out must be after check-in" }));
      setForm((prev) => ({ ...prev, rate: 0 }));
      return;
    } else {
      setErrors((prev) => ({ ...prev, date: null }));
    }

    const nights = datesInStay(form.checkInDate, form.checkOutDate);
    let baseTotal = 0;

    let birthdayNight = null;
    if (selectedGuest?.birthdate) {
      const b = new Date(selectedGuest.birthdate);
      birthdayNight = nights.find((n) => sameMonthDay(n, b)) || null;
    }

    const selectedRooms = form.roomNumbers
      .map((num) => rooms.find((r) => r.roomNumber === num))
      .filter(Boolean);
    const anyDeluxe = selectedRooms.some((r) => (r.roomType || "").toLowerCase() === "deluxe");
    const firstDeluxeRoom = selectedRooms.find(
      (r) => (r.roomType || "").toLowerCase() === "deluxe"
    );

    for (const roomDoc of selectedRooms) {
      for (const d of nights) {
        const ev = getEventForDate(d);
        let nightly = 0;
        if (ev && ev.rateType === "custom" && ev.customRates) {
          nightly = ev.customRates[roomDoc.roomType] ?? rateFor(roomDoc.roomType, form.channel, d);
        } else {
          nightly = rateFor(roomDoc.roomType, form.channel, d);
        }
        baseTotal += Number(nightly || 0);
      }
    }

    let tierDiscountPct = 0;
    if ((form.channel || "").toLowerCase() === "direct" && selectedGuest?.tier) {
      if (selectedGuest.tier === "Silver") tierDiscountPct = 0.05;
      if (selectedGuest.tier === "Gold") tierDiscountPct = 0.1;
    }
    let discountedTotal = baseTotal * (1 - tierDiscountPct);

    let birthdayExtraDiscount = 0;
    let willMarkClaim = false;
    if ((form.channel || "").toLowerCase() === "direct" && birthdayNight && selectedGuest) {
      const year = new Date().getFullYear();
      const alreadyClaimed = Number(selectedGuest.lastBirthdayClaimYear || 0) === year;

      if (!alreadyClaimed) {
        if (selectedGuest.tier === "Silver") {
          const pickRoom = selectedRooms[0];
          if (pickRoom) {
            const ev = getEventForDate(birthdayNight);
            let nightly = 0;
            if (ev && ev.rateType === "custom" && ev.customRates) {
              nightly =
                ev.customRates[pickRoom.roomType] ?? rateFor(pickRoom.roomType, form.channel, birthdayNight);
            } else {
              nightly = rateFor(pickRoom.roomType, form.channel, birthdayNight);
            }
            birthdayExtraDiscount = Number(nightly || 0) * 0.5;
            willMarkClaim = true;
          }
        } else if (selectedGuest.tier === "Gold" && anyDeluxe && firstDeluxeRoom) {
          const ev = getEventForDate(birthdayNight);
          let nightly = 0;
          if (ev && ev.rateType === "custom" && ev.customRates) {
            nightly =
              ev.customRates[firstDeluxeRoom.roomType] ?? rateFor(firstDeluxeRoom.roomType, form.channel, birthdayNight);
          } else {
            nightly = rateFor(firstDeluxeRoom.roomType, form.channel, birthdayNight);
          }
          birthdayExtraDiscount = Number(nightly || 0);
          willMarkClaim = true;
        }
      }
    }

    const total =
      Math.max(0, discountedTotal - birthdayExtraDiscount) +
      Number(depositPerRoom || 0) * form.roomNumbers.length;

    setForm((prev) => ({ ...prev, rate: Math.round(total) }));
    setBirthdayApplied(willMarkClaim);
  }, [form.channel, form.roomNumbers, form.checkInDate, form.checkOutDate, rooms, events, depositPerRoom, rates, selectedGuest, ready]);

  // 🔹 Availability check function
  const isRoomAvailable = async (roomNumber, checkInDate, checkOutDate) => {
    const qRooms = query(
      collection(db, "reservations"),
      where("roomNumbers", "array-contains", roomNumber),
      where("status", "in", ["booked", "checked-in"])
    );
    const snapshot = await getDocs(qRooms);
    return snapshot.docs.every((docSnap) => {
      const r = docSnap.data();
      const existingIn = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
      const existingOut = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
      const inDate = new Date(checkInDate + "T00:00:00");
      const outDate = new Date(checkOutDate + "T00:00:00");
      return outDate <= existingIn || inDate >= existingOut;
    });
  };

  // 🔹 Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!can("canCreateReservations")) return;

    if (!form.guestName.trim()) {
      window.alert("Guest is required.");
      return;
    }
    if (!form.checkInDate || !form.checkOutDate) {
      window.alert("Both check-in and check-out dates are required.");
      return;
    }

    const inDateLocal = new Date(form.checkInDate + "T00:00:00");
    const outDateLocal = new Date(form.checkOutDate + "T00:00:00");
    if (!(outDateLocal > inDateLocal)) {
      window.alert("Check-out must be after check-in.");
      return;
    }

    const { blocked, conflicts } = await checkRoomBlocks(
      form.roomNumbers,
      inDateLocal,
      outDateLocal
    );
    if (blocked) {
      window.alert(
        "Cannot create reservation. The following rooms are blocked:\n" +
          conflicts.map((c) => `${c.roomNumber || c.roomType} (${c.reason})`).join("\n")
      );
      return;
    }

    for (const roomNumber of form.roomNumbers) {
      const available = await isRoomAvailable(roomNumber, form.checkInDate, form.checkOutDate);
      if (!available) {
        window.alert(`Room ${roomNumber} is already booked for those dates.`);
        return;
      }
    }

    const data = {
      status: "booked",
      guestId: selectedGuest?.id || null,
      guestName: form.guestName.trim(),
      channel: form.channel,
      checkInDate: Timestamp.fromDate(inDateLocal),
      checkOutDate: Timestamp.fromDate(outDateLocal),
      roomNumbers: [...form.roomNumbers],
      rate: Number(form.rate || 0),
      depositPerRoom: Number(depositPerRoom || 0),
      paymentMade: 0,
      createdAt: new Date(),
      createdBy: actor,
    };

    try {
      const ref = await addDoc(collection(db, "reservations"), data);

      if (birthdayApplied && selectedGuest?.id) {
        const year = new Date().getFullYear();
        try {
          await updateDoc(doc(db, "guests", selectedGuest.id), {
            lastBirthdayClaimYear: year,
          });
        } catch (err) {
          console.error("Failed to update guest birthday claim:", err);
        }
      }

      navigate(`/reservations/${ref.id}`);
    } catch (err) {
      window.alert(err.message || String(err));
    }
  };

  // 🔹 Early return UI for Night Audit
  if (!ready) {
    return (
      <div>
        <h3>Night Audit required</h3>
        <p>
          Night Audit for the business day has not been completed. Please run
          Night Audit before performing reservation, check-in, or check-out operations.
        </p>
        <button onClick={() => navigate("/night-audit")}>Run Night Audit</button>
      </div>
    );
  }

  // 🔹 Render form
  return (
    <div className="reservations-container">
      <h2>Add Reservation</h2>

      <form onSubmit={handleSubmit} className="reservation-form">
        <label>Guest</label>
        <select
          value={form.guestName}
          onChange={(e) => {
            const name = e.target.value;
            const g = guests.find((x) => x.name === name);
            setForm((prev) => ({ ...prev, guestName: name, guestId: g?.id || "" }));
          }}
          required
        >
          <option value="">Select Guest</option>
          {guests.map((g) => (
            <option
              key={g.id}
              value={g.name}
              title={g.benefits?.length ? g.benefits.join(", ") : ""}
            >
              {g.name} {g.tier ? `(${g.tier})` : ""}
            </option>
          ))}
        </select>

        <label>Dates</label>
        <div style={{ display: "flex", gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Check-in</div>
            <input
              type="date"
              min={minCheckInDateForJakarta()}
              value={form.checkInDate}
              onChange={(e) => {
                const v = e.target.value;
                setForm((prev) => ({
                  ...prev,
                  checkInDate: v,
                  checkOutDate:
                    prev.checkOutDate && prev.checkOutDate <= v
                      ? ymd(new Date(new Date(v).setDate(new Date(v).getDate() + 1)))
                      : prev.checkOutDate,
                }));
              }}
              required
            />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#64748b" }}>Check-out</div>
            <input
              type="date"
              min={form.checkInDate || minCheckInDateForJakarta()}
              value={form.checkOutDate}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, checkOutDate: e.target.value }))
              }
              required
            />
          </div>
        </div>
        {errors.date && <div className="error">{errors.date}</div>}

        <label>Rooms</label>
        <select
          multiple
          style={{ width: "100%", minHeight: "180px" }}
          value={form.roomNumbers}
          onChange={(e) =>
            setForm({
              ...form,
              roomNumbers: Array.from(e.target.selectedOptions, (opt) => opt.value),
            })
          }
          required
        >
          {rooms.map((r) => (
            <option key={r.roomNumber} value={r.roomNumber}>
              {r.roomNumber} ({r.roomType || "—"}) {r.status ? `[${r.status}]` : ""}
            </option>
          ))}
        </select>

        <div className="helper-text">
          Room types available: {roomTypes.join(", ") || "—"}
        </div>

        <label>Channel</label>
        <select
          value={form.channel}
          onChange={(e) => setForm({ ...form, channel: e.target.value })}
          required
        >
          <option value="">Select Channel</option>
          {channels.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>

        <label>Total Amount (includes deposit)</label>
        <input type="number" value={form.rate} readOnly />
        <div className="helper-text">
          Deposit per room: {Number(depositPerRoom || 0).toLocaleString()} ×{" "}
          {form.roomNumbers.length} room(s)
        </div>

        <div className="form-actions" style={{ marginTop: 8 }}>
          <button
            type="submit"
            disabled={
              !can("canCreateReservations") ||
              !form.guestName ||
              !form.checkInDate ||
              !form.checkOutDate ||
              !form.roomNumbers.length ||
              !form.channel ||
              !!errors.date
            }
            className="btn-primary"
          >
            Save & open details
          </button>
        </div>
      </form>
    </div>
  );
}
