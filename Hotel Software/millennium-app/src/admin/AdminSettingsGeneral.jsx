// src/admin/AdminSettingsGeneral.jsx
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "../firebase";

// === Helper UI Components ===
const Section = ({ title, children }) => (
  <section className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
    <header className="px-4 py-2 bg-gray-50 border-b flex justify-between items-center rounded-t-xl">
      <h3 className="font-semibold text-lg text-gray-700">{title}</h3>
    </header>
    <div className="p-4">{children}</div>
  </section>
);

const Input = ({ label, value, onChange, type = "text", placeholder }) => (
  <div className="flex flex-col gap-1 mb-3">
    {label && <label className="text-sm text-gray-600">{label}</label>}
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

const Button = ({ label, onClick, color = "blue" }) => (
  <button
    onClick={onClick}
    className={`bg-${color}-600 text-white px-4 py-2 rounded-md hover:bg-${color}-700 transition-all`}
  >
    {label}
  </button>
);

export default function AdminSettingsGeneral({ permissions = [] }) {
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");

  const [loading, setLoading] = useState(true);
  const [deposit, setDeposit] = useState("");

  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [rates, setRates] = useState([]);

  const [unsavedRates, setUnsavedRates] = useState({}); // buffer for manual edits

  // === Load data from Firestore ===
  const loadAll = async () => {
    setLoading(true);
    try {
      const [settingsSnap, roomSnap, chanSnap, eventSnap, rateSnap] = await Promise.all([
        getDoc(doc(db, "settings", "general")),
        getDocs(collection(db, "rooms")),
        getDocs(collection(db, "channels")),
        getDocs(collection(db, "events")),
        getDocs(collection(db, "rates")),
      ]);

      if (settingsSnap.exists()) setDeposit(settingsSnap.data().depositPerRoom || "");

      setRooms(roomSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setChannels(chanSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEvents(eventSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRates(rateSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to load admin settings:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  // === Save deposit ===
  const saveDeposit = async () => {
    const val = Number(deposit);
    if (!Number.isFinite(val) || val < 0) return alert("Invalid amount.");
    await setDoc(doc(db, "settings", "general"), { depositPerRoom: val }, { merge: true });
    alert("Deposit saved successfully.");
  };

  // === Editable room types ===
  const handleRoomChange = (index, key, value) => {
    const updated = [...rooms];
    updated[index][key] = value;
    setRooms(updated);
  };

  const saveRooms = async () => {
    for (const r of rooms) {
      await setDoc(doc(db, "rooms", r.id || r.roomNumber), {
        roomNumber: r.roomNumber,
        roomType: r.roomType,
      }, { merge: true });
    }
    alert("Rooms saved successfully.");
  };

  // === Channels section ===
  const handleChannelChange = (index, key, value) => {
    const updated = [...channels];
    updated[index][key] = value;
    setChannels(updated);
  };

  const saveChannels = async () => {
    for (const c of channels) {
      await setDoc(doc(db, "channels", c.id || c.name), {
        name: c.name,
        rateType: c.rateType,
      }, { merge: true });
    }
    alert("Channels saved successfully.");
  };

  // === Events section ===
  const handleEventChange = (index, key, value) => {
    const updated = [...events];
    updated[index][key] = value;
    setEvents(updated);
  };

  const saveEvents = async () => {
    for (const e of events) {
      await setDoc(doc(db, "events", e.id || e.name), e, { merge: true });
    }
    alert("Events saved successfully.");
  };

  // === Rates (editable) ===
  const handleRateEdit = (roomType, channel, key, value) => {
    const keyName = `${roomType}_${channel}`;
    setUnsavedRates((prev) => ({
      ...prev,
      [keyName]: {
        ...(prev[keyName] || {}),
        roomType,
        channelId: channel,
        [key]: value,
      },
    }));
  };

  const saveRates = async () => {
    const entries = Object.values(unsavedRates);
    for (const rateObj of entries) {
      await setDoc(doc(db, "rates", `${rateObj.roomType}__${rateObj.channelId}`), rateObj, { merge: true });
    }
    setUnsavedRates({});
    alert("Rates updated successfully.");
  };

  if (loading) return <p className="text-center text-gray-500">Loading settings...</p>;

  const roomTypes = Array.from(new Set(rooms.map((r) => r.roomType)));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">⚙️ Admin Settings</h2>

      {/* Section 1: Deposit */}
      <Section title="Deposit Per Room">
        <div className="flex gap-3 items-end">
          <Input
            label="Deposit (per room)"
            type="number"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            placeholder="Enter amount"
          />
          <Button label="Save" onClick={saveDeposit} />
        </div>
      </Section>

      {/* Section 2: Rooms */}
      <Section title="Room Configuration">
        <table className="w-full border-collapse text-sm mb-3">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Room Number</th>
              <th className="p-2 text-left">Room Type</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r, i) => (
              <tr key={r.id || i} className="border-t">
                <td className="p-2">
                  <input
                    value={r.roomNumber}
                    onChange={(e) => handleRoomChange(i, "roomNumber", e.target.value)}
                    className="border-b border-gray-300 w-full focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="p-2">
                  <input
                    value={r.roomType}
                    onChange={(e) => handleRoomChange(i, "roomType", e.target.value)}
                    className="border-b border-gray-300 w-full focus:border-blue-500 focus:outline-none"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button label="Save Rooms" onClick={saveRooms} />
      </Section>

      {/* Section 3: Channels */}
      <Section title="Channels">
        <table className="w-full border-collapse text-sm mb-3">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Channel Name</th>
              <th className="p-2 text-left">Rate Type</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c, i) => (
              <tr key={c.id || i} className="border-t">
                <td className="p-2">
                  <input
                    value={c.name}
                    onChange={(e) => handleChannelChange(i, "name", e.target.value)}
                    className="border-b w-full"
                  />
                </td>
                <td className="p-2">
                  <select
                    value={c.rateType || ""}
                    onChange={(e) => handleChannelChange(i, "rateType", e.target.value)}
                    className="border rounded-md px-2 py-1 w-full"
                  >
                    <option value="">Select</option>
                    <option value="number">Fixed Rate</option>
                    <option value="custom">Custom (OTA)</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button label="Save Channels" onClick={saveChannels} />
      </Section>

      {/* Section 4: Events */}
      <Section title="Events">
        <table className="w-full border-collapse text-sm mb-3">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Event Name</th>
              <th className="p-2 text-left">Start Date</th>
              <th className="p-2 text-left">End Date</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={ev.id || i} className="border-t">
                <td className="p-2">
                  <input
                    value={ev.name}
                    onChange={(e) => handleEventChange(i, "name", e.target.value)}
                    className="border-b w-full"
                  />
                </td>
                <td className="p-2">
                  <input
                    type="date"
                    value={ev.startDate || ""}
                    onChange={(e) => handleEventChange(i, "startDate", e.target.value)}
                  />
                </td>
                <td className="p-2">
                  <input
                    type="date"
                    value={ev.endDate || ""}
                    onChange={(e) => handleEventChange(i, "endDate", e.target.value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button label="Save Events" onClick={saveEvents} />
      </Section>

      {/* Section 5: Rates */}
      <Section title="Room Rates">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-gray-100">
            <tr>
              <th className="p-2 text-left">Room Type</th>
              <th className="p-2 text-center">Direct (Weekday)</th>
              <th className="p-2 text-center">Direct (Weekend)</th>
              <th className="p-2 text-center">OTA (Custom)</th>
            </tr>
          </thead>
          <tbody>
            {roomTypes.map((type) => {
              const direct = rates.find(r => r.roomType === type && r.channelId === "direct") || {};
              const ota = rates.find(r => r.roomType === type && r.channelId === "ota") || {};
              return (
                <tr key={type} className="border-t">
                  <td className="p-2 font-medium">{type}</td>
                  <td className="p-2 text-center">
                    <input
                      type="number"
                      value={unsavedRates[`${type}_direct`]?.weekdayRate ?? direct.weekdayRate ?? ""}
                      onChange={(e) => handleRateEdit(type, "direct", "weekdayRate", Number(e.target.value))}
                      className="border rounded px-2 py-1 w-24 text-center"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="number"
                      value={unsavedRates[`${type}_direct`]?.weekendRate ?? direct.weekendRate ?? ""}
                      onChange={(e) => handleRateEdit(type, "direct", "weekendRate", Number(e.target.value))}
                      className="border rounded px-2 py-1 w-24 text-center"
                    />
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="number"
                      value={unsavedRates[`${type}_ota`]?.price ?? ota.price ?? ""}
                      onChange={(e) => handleRateEdit(type, "ota", "price", Number(e.target.value))}
                      className="border rounded px-2 py-1 w-24 text-center"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-3">
          <Button label="Save Rates" onClick={saveRates} />
        </div>
      </Section>
    </div>
  );
}
