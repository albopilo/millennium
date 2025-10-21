// src/pages/Reservations.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  getDocs,
  getDoc,
  addDoc,
  query,
  where,
  doc,
  Timestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import { checkRoomBlocks } from "../lib/availability";
import { todayStr, ymd } from "../lib/dates";
import useRequireNightAudit from "../hooks/useRequireNightAudit";
import "./Reservations.css";

/* ---------- Helpers ---------- */
const JAKARTA_TZ = "Asia/Jakarta";
const formatDate = (d) => ymd(d);
const nowInJakarta = () => new Date(new Date().toLocaleString("en-US", { timeZone: JAKARTA_TZ }));
const minCheckInDateJakarta = () => {
  const now = nowInJakarta();
  const allowYesterday = now.getHours() < 4;
  if (allowYesterday) now.setDate(now.getDate() - 1);
  return ymd(now);
};

/* ---------- Component ---------- */
export default function Reservations({ permissions = [], currentUser = null }) {
  const navigate = useNavigate();
  const { ready } = useRequireNightAudit(7);

  const can = (perm) => permissions.includes(perm) || permissions.includes("*");
  const actor = currentUser?.email || currentUser?.id || "frontdesk";

  /* ---------- States ---------- */
  const [rooms, setRooms] = useState([]);
  const [guests, setGuests] = useState([]);
  const [channels, setChannels] = useState([]);
  const [rates, setRates] = useState([]);
  const [events, setEvents] = useState([]);
  const [depositPerRoom, setDepositPerRoom] = useState(0);
  const [loading, setLoading] = useState(true);
  const [guestSearch, setGuestSearch] = useState("");

  const [form, setForm] = useState({
    guestName: "",
    guestId: "",
    checkInDate: todayStr(),
    checkOutDate: formatDate(new Date(Date.now() + 86400000)),
    roomNumbers: [],
    channel: "",
    rate: 0,
  });

  const selectedChannel = useMemo(
    () => channels.find((c) => c.name === form.channel) || null,
    [channels, form.channel]
  );

  const selectedGuest = useMemo(
    () => guests.find((g) => g.name === form.guestName),
    [guests, form.guestName]
  );

  /* ---------- Load Data ---------- */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      try {
        const [roomsSnap, guestsSnap, channelsSnap, ratesSnap, eventsSnap, settingsSnap] =
          await Promise.all([
            getDocs(collection(db, "rooms")),
            getDocs(collection(db, "guests")),
            getDocs(collection(db, "channels")),
            getDocs(collection(db, "rates")),
            getDocs(collection(db, "events")),
            getDoc(doc(db, "settings", "general")),
          ]);

        setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setGuests(guestsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setChannels(channelsSnap.docs.map((d) => d.data()));
        setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setEvents(eventsSnap.docs.map((d) => d.data()));
        setDepositPerRoom(Number(settingsSnap.data()?.depositPerRoom || 0));
      } catch (err) {
        console.error("Error loading reservation data:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [ready]);

  /* ---------- Pricing ---------- */
  const rateFor = (roomType, channel, date) => {
    const chId = (channel || "").toLowerCase();
    const rateDoc = rates.find(
      (r) =>
        (r.roomType || "").toLowerCase() === (roomType || "").toLowerCase() &&
        (r.channelId || "").toLowerCase() === chId
    );
    if (!rateDoc) return 0;

    if (chId === "direct") {
      const isWeekend = [0, 6].includes(date.getDay());
      return isWeekend ? Number(rateDoc.weekendRate || 0) : Number(rateDoc.weekdayRate || 0);
    }
    return Number(rateDoc.price || 0);
  };

  const calcRate = () => {
    if (!form.channel || !form.checkInDate || !form.checkOutDate || !form.roomNumbers.length)
      return 0;
    if (selectedChannel?.rateType === "custom") return form.rate; // manual override

    const start = new Date(form.checkInDate + "T00:00:00");
    const end = new Date(form.checkOutDate + "T00:00:00");
    if (end <= start) return 0;

    const nights = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      nights.push(new Date(d));
    }

    let total = 0;
    for (const num of form.roomNumbers) {
      const room = rooms.find((r) => r.roomNumber === num);
      if (!room) continue;
      for (const date of nights) {
        total += rateFor(room.roomType, form.channel, date);
      }
    }

    // Tier discount for direct guests
    if ((form.channel || "").toLowerCase() === "direct") {
      if (selectedGuest?.tier === "Silver") total *= 0.95;
      if (selectedGuest?.tier === "Gold") total *= 0.9;
    }

    total += depositPerRoom * form.roomNumbers.length;
    return Math.round(total);
  };

  useEffect(() => {
    if (!loading && ready && selectedChannel?.rateType !== "custom") {
      setForm((f) => ({ ...f, rate: calcRate() }));
    }
  }, [
    form.roomNumbers,
    form.checkInDate,
    form.checkOutDate,
    form.channel,
    selectedGuest,
    ready,
    loading,
  ]);

  /* ---------- Availability ---------- */
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

  /* ---------- Submit ---------- */
  async function handleSubmit(e) {
    e.preventDefault();
    try {
      if (!can("canCreateReservations")) throw new Error("Permission denied.");
      if (!form.guestName) throw new Error("Guest is required.");
      if (!form.channel) throw new Error("Channel is required.");
      if (!form.roomNumbers.length) throw new Error("Select at least one room.");

      const inDate = new Date(form.checkInDate + "T00:00:00");
      const outDate = new Date(form.checkOutDate + "T00:00:00");
      if (outDate <= inDate) throw new Error("Check-out must be after check-in.");

      const { blocked, conflicts } = await checkRoomBlocks(form.roomNumbers, inDate, outDate);
      if (blocked)
        throw new Error(
          "Blocked rooms:\n" + conflicts.map((c) => `${c.roomNumber} (${c.reason})`).join("\n")
        );

      for (const num of form.roomNumbers) {
        const ok = await isRoomAvailable(num, form.checkInDate, form.checkOutDate);
        if (!ok) throw new Error(`Room ${num} is not available.`);
      }

      const data = {
        guestId: selectedGuest?.id || null,
        guestName: form.guestName,
        channel: form.channel,
        checkInDate: Timestamp.fromDate(inDate),
        checkOutDate: Timestamp.fromDate(outDate),
        roomNumbers: [...form.roomNumbers],
        rate: Number(form.rate || 0),
        depositPerRoom,
        paymentMade: 0,
        createdAt: new Date(),
        createdBy: actor,
        status: "booked",
      };

      const ref = await addDoc(collection(db, "reservations"), data);
      navigate(`/reservations/${ref.id}`);
    } catch (err) {
      alert(err.message || String(err));
    }
  }

  /* ---------- UI ---------- */
  if (!ready)
    return (
      <div className="night-audit-warning">
        <h3>Night Audit Required</h3>
        <p>Complete Night Audit before creating new reservations.</p>
        <button onClick={() => navigate("/night-audit")}>Run Night Audit</button>
      </div>
    );

  if (loading) return <p>Loading...</p>;

  /* ---------- Guest Filter ---------- */
  const filteredGuests = guests.filter((g) =>
    g.name.toLowerCase().includes(guestSearch.toLowerCase())
  );

  /* ---------- Render ---------- */
  return (
    <div className="reservations-page">
      <h1 className="page-title">Create Reservation</h1>

      <form className="reservation-form-wide" onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group full">
            <label>Search Guest</label>
            <input
              type="text"
              placeholder="Type guest name..."
              value={guestSearch}
              onChange={(e) => setGuestSearch(e.target.value)}
            />
          </div>

          <div className="form-group full">
            <label>Select Guest</label>
            <select
              value={form.guestName}
              onChange={(e) => {
                const name = e.target.value;
                const g = guests.find((x) => x.name === name);
                setForm((prev) => ({ ...prev, guestName: name, guestId: g?.id || "" }));
              }}
            >
              <option value="">Select Guest</option>
              {filteredGuests.map((g) => (
                <option key={g.id} value={g.name}>
                  {g.name} {g.tier ? `(${g.tier})` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Check-in</label>
            <input
              type="date"
              min={minCheckInDateJakarta()}
              value={form.checkInDate}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  checkInDate: e.target.value,
                  checkOutDate:
                    prev.checkOutDate <= e.target.value
                      ? ymd(new Date(new Date(e.target.value).getTime() + 86400000))
                      : prev.checkOutDate,
                }))
              }
            />
          </div>

          <div className="form-group">
            <label>Check-out</label>
            <input
              type="date"
              min={form.checkInDate}
              value={form.checkOutDate}
              onChange={(e) => setForm((prev) => ({ ...prev, checkOutDate: e.target.value }))}
            />
          </div>

          <div className="form-group">
            <label>Channel</label>
            <select
              value={form.channel}
              onChange={(e) => setForm((prev) => ({ ...prev, channel: e.target.value }))}
            >
              <option value="">Select Channel</option>
              {channels.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} {c.rateType ? `(${c.rateType})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Room Selection */}
        <div className="room-selection">
          <h3>Select Rooms</h3>
          <table className="room-table">
            <thead>
              <tr>
                <th></th>
                <th>Room #</th>
                <th>Type</th>
                <th>Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.roomNumber}>
                  <td>
                    <input
                      type="checkbox"
                      checked={form.roomNumbers.includes(r.roomNumber)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setForm((f) => ({
                            ...f,
                            roomNumbers: [...f.roomNumbers, r.roomNumber],
                          }));
                        } else {
                          setForm((f) => ({
                            ...f,
                            roomNumbers: f.roomNumbers.filter((n) => n !== r.roomNumber),
                          }));
                        }
                      }}
                    />
                  </td>
                  <td>{r.roomNumber}</td>
                  <td>{r.roomType || "—"}</td>
                  <td>{r.status || "Available"}</td>
                  <td>{r.notes || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rate */}
        <div className="rate-summary">
          <label>
            Total Amount {selectedChannel?.rateType === "custom" ? "(editable for OTA)" : ""}
          </label>
          <input
            type="number"
            value={form.rate}
            readOnly={selectedChannel?.rateType !== "custom"}
            onChange={(e) =>
              selectedChannel?.rateType === "custom" &&
              setForm((prev) => ({ ...prev, rate: Number(e.target.value) }))
            }
          />
          <small>
            Deposit per room: {depositPerRoom.toLocaleString()} × {form.roomNumbers.length} room(s)
          </small>
        </div>

        <div className="form-actions">
          <button
            type="submit"
            className="btn-primary"
            disabled={!can("canCreateReservations") || !form.roomNumbers.length}
          >
            Save & Open Details
          </button>
        </div>
      </form>
    </div>
  );
}
