import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";

export default function AdminSettings({ permissions = [], permLoading }) {
  const can = (perm) =>
    Array.isArray(permissions) &&
    (permissions.includes(perm) || permissions.includes("*"));

  // State
  const [depositPerRoom, setDepositPerRoom] = useState("");
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [rateTypes, setRateTypes] = useState([]);
  const [rates, setRates] = useState([]); // [{ id?, roomType, channelId, weekdayRate?, weekendRate?, price?, rateType? }]

  const [newRoom, setNewRoom] = useState({ roomNumber: "", roomType: "" });
  const [newChannel, setNewChannel] = useState({ name: "", rateType: "" });
  const [newEvent, setNewEvent] = useState({
    name: "",
    startDate: "",
    endDate: "",
    rateType: ""
  });

  // Load data
  const fetchData = useCallback(async () => {
    console.log("🔍 UID:", getAuth().currentUser?.uid);
    console.log("🔍 can('*'):", can("*"));
    console.log("🔍 permissions array:", permissions);

    try {
      const settingsSnap = await getDoc(doc(db, "settings", "general"));
      setDepositPerRoom(
        settingsSnap.exists() && typeof settingsSnap.data().depositPerRoom === "number"
          ? String(settingsSnap.data().depositPerRoom)
          : ""
      );
    } catch (e) {
      console.error("Failed to read settings/general:", e);
    }

    try {
      const roomSnap = await getDocs(collection(db, "rooms"));
      setRooms(roomSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to read rooms:", e);
    }

    try {
      const chanSnap = await getDocs(collection(db, "channels"));
      setChannels(chanSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to read channels:", e);
    }

    try {
      const eventSnap = await getDocs(collection(db, "events"));
      setEvents(eventSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to read events:", e);
    }

    try {
      const rateTypeSnap = await getDocs(collection(db, "rateTypes"));
      setRateTypes(
        rateTypeSnap.docs.map((d) => ({
          id: d.id,
          label: d.data().label
        }))
      );
    } catch (e) {
      console.error("Failed to read rateTypes:", e);
    }

    try {
      const ratesSnap = await getDocs(collection(db, "rates"));
      setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Failed to read rates:", e);
    }
  }, [permissions]);

  useEffect(() => {
    if (!permLoading && can("*")) {
      fetchData();
    }
  }, [permLoading, permissions, fetchData]);

  if (permLoading) return <p>Loading permissions…</p>;
  if (!can("*")) return <p>Access denied</p>;

  // Permissions mapping
  const PERM = {
    settings: "canManageSettings",
    rooms: "canManageRooms",
    channels: "canManageChannels",
    events: "canManageEvents",
    rates: "canManageRates"
  };

  const guard = (path, permName) => {
    if (permLoading || !(can(permName) || can("*"))) {
      console.warn(`⛔ Blocked write to ${path}: missing permission ${permName} or loading`);
      return false;
    }
    console.log(`✏️ Writing to: ${path} (perm: ${permName})`);
    return true;
  };

  // Settings
  const saveDeposit = async () => {
    if (!guard("settings/general", PERM.settings)) return;
    try {
      const value = Number(depositPerRoom);
      if (!Number.isFinite(value) || value < 0) {
        alert("Enter a valid non-negative number for Deposit per room.");
        return;
      }
      await setDoc(doc(db, "settings", "general"), { depositPerRoom: value }, { merge: true });
      alert("Deposit per room updated");
    } catch (e) {
      console.error("Write failed: settings/general", e);
      alert("Failed to save settings. Check permissions and try again.");
    }
  };

  // Rooms
  const addRoom = async () => {
    if (!guard("rooms (add)", PERM.rooms)) return;
    if (!newRoom.roomNumber || !newRoom.roomType) return;
    try {
      await addDoc(collection(db, "rooms"), newRoom);
      setNewRoom({ roomNumber: "", roomType: "" });
      fetchData();
    } catch (e) {
      console.error("Add room failed", e);
      alert("Failed to add room.");
    }
  };

  const updateRoom = async (id, field, value) => {
    if (!guard(`rooms/${id}`, PERM.rooms)) return;
    try {
      await updateDoc(doc(db, "rooms", id), { [field]: value });
      fetchData();
    } catch (e) {
      console.error(`Update room ${id} failed`, e);
      alert("Failed to update room.");
    }
  };

  const deleteRoom = async (id) => {
    if (!guard(`rooms/${id}`, PERM.rooms)) return;
    if (!window.confirm("Delete this room?")) return;
    try {
      await deleteDoc(doc(db, "rooms", id));
      fetchData();
    } catch (e) {
      console.error(`Delete room ${id} failed`, e);
      alert("Failed to delete room.");
    }
  };

  // Channels
  const addChannel = async () => {
    if (!guard("channels (add)", PERM.channels)) return;
    if (!newChannel.name) return;
    try {
      await addDoc(collection(db, "channels"), newChannel);
      setNewChannel({ name: "", rateType: "" });
      fetchData();
    } catch (e) {
      console.error("Add channel failed", e);
      alert("Failed to add channel.");
    }
  };

  const updateChannel = async (id, field, value) => {
    if (!guard(`channels/${id}`, PERM.channels)) return;
    try {
      await updateDoc(doc(db, "channels", id), { [field]: value });
      fetchData();
    } catch (e) {
      console.error(`Update channel ${id} failed`, e);
      alert("Failed to update channel.");
    }
  };

  const deleteChannel = async (id) => {
    if (!guard(`channels/${id}`, PERM.channels)) return;
    if (!window.confirm("Delete this channel?")) return;
    try {
      await deleteDoc(doc(db, "channels", id));
      fetchData();
    } catch (e) {
      console.error(`Delete channel ${id} failed`, e);
      alert("Failed to delete channel.");
    }
  };

  // Events
  const addEvent = async () => {
    if (!guard("events (add)", PERM.events)) return;
    if (!newEvent.name) return;
    try {
      await addDoc(collection(db, "events"), newEvent);
      setNewEvent({ name: "", startDate: "", endDate: "", rateType: "" });
      fetchData();
    } catch (e) {
      console.error("Add event failed", e);
      alert("Failed to add event.");
    }
  };

  const updateEvent = async (id, field, value) => {
    if (!guard(`events/${id}`, PERM.events)) return;
    try {
      await updateDoc(doc(db, "events", id), { [field]: value });
      fetchData();
    } catch (e) {
      console.error(`Update event ${id} failed`, e);
      alert("Failed to update event.");
    }
  };

  const deleteEvent = async (id) => {
    if (!guard(`events/${id}`, PERM.events)) return;
    if (!window.confirm("Delete this event?")) return;
    try {
      await deleteDoc(doc(db, "events", id));
      fetchData();
    } catch (e) {
      console.error(`Delete event ${id} failed`, e);
      alert("Failed to delete event.");
    }
  };

  // Rates: update local state (ephemeral if missing)
  const updateRate = (roomType, channelId, partial) => {
    setRates((prev) => {
      const idx = prev.findIndex((r) => r.roomType === roomType && r.channelId === channelId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...partial };
        return next;
        }
      // Create new local row
      const base =
        channelId === "direct"
          ? { roomType, channelId, weekdayRate: 0, weekendRate: 0 }
          : { roomType, channelId, price: 0, rateType: "custom" };
      return [...prev, { ...base, ...partial }];
    });
  };

  // Rates: persist to Firestore (deterministic ID to avoid duplicates)
  const saveRate = async (roomType, channelId) => {
    if (!guard(`rates/${roomType}__${channelId}`, PERM.rates)) return;
    try {
      const current = rates.find((r) => r.roomType === roomType && r.channelId === channelId);
      if (!current) return;

      if (channelId === "direct") {
        const wr = Number(current.weekdayRate);
        const er = Number(current.weekendRate);
        if ((!Number.isFinite(wr) || wr < 0) || (!Number.isFinite(er) || er < 0)) {
          alert("Enter valid non-negative numbers for Direct rates.");
          return;
        }
        await setDoc(
          doc(db, "rates", `${roomType}__${channelId}`),
          { roomType, channelId, weekdayRate: wr, weekendRate: er },
          { merge: true }
        );
      } else {
        const price = Number(current.price);
        if (!Number.isFinite(price) || price < 0) {
          alert("Enter a valid non-negative number for OTA price.");
          return;
        }
        await setDoc(
          doc(db, "rates", `${roomType}__${channelId}`),
          { roomType, channelId, rateType: current.rateType || "custom", price },
          { merge: true }
        );
      }
      // Refresh to reflect server state
      fetchData();
    } catch (e) {
      console.error("Save rate failed", e);
      alert("Failed to save rate.");
    }
  };

  return (
    <div className="container">
      <h2 className="mt-0 mb-2">Admin Settings</h2>

      {/* Deposit */}
      <section className="card">
        <header className="card-header">
          <h3>Deposit Per Room</h3>
        </header>
        <div className="card-body">
          <input
            inputMode="decimal"
            value={depositPerRoom}
            onChange={(e) => setDepositPerRoom(e.target.value)}
          />
          <button className="mt-1" onClick={saveDeposit}>Save</button>
        </div>
      </section>

      {/* Rooms */}
      <section className="card">
        <header className="card-header">
          <h3>Rooms</h3>
        </header>
        <div className="card-body">
          <table className="table">
            <thead>
              <tr>
                <th>Number</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id}>
                  <td>
                    <input
                      value={r.roomNumber ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRooms((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, roomNumber: v } : x))
                        );
                      }}
                      onBlur={(e) => updateRoom(r.id, "roomNumber", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={r.roomType ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setRooms((prev) =>
                          prev.map((x) => (x.id === r.id ? { ...x, roomType: v } : x))
                        );
                      }}
                      onBlur={(e) => updateRoom(r.id, "roomType", e.target.value)}
                    />
                  </td>
                  <td>
                    <button onClick={() => deleteRoom(r.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="mt-2">Add Room</h4>
          <input
            placeholder="Room Number"
            value={newRoom.roomNumber}
            onChange={(e) => setNewRoom({ ...newRoom, roomNumber: e.target.value })}
          />
          <input
            placeholder="Room Type"
            value={newRoom.roomType}
            onChange={(e) => setNewRoom({ ...newRoom, roomType: e.target.value })}
          />
          <button onClick={addRoom}>Add</button>
        </div>
      </section>

      {/* Channels */}
      <section className="card">
        <header className="card-header">
          <h3>Channels & Rate Types</h3>
        </header>
        <div className="card-body">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Rate Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.id}>
                  <td>
                    <input
                      value={c.name ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setChannels((prev) =>
                          prev.map((x) => (x.id === c.id ? { ...x, name: v } : x))
                        );
                      }}
                      onBlur={(e) => updateChannel(c.id, "name", e.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      value={c.rateType ?? ""}
                      onChange={(e) => updateChannel(c.id, "rateType", e.target.value)}
                    >
                      <option value="">Select a rate type</option>
                      {rateTypes.map((rt) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button onClick={() => deleteChannel(c.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="mt-2">Add Channel</h4>
          <input
            placeholder="Channel Name"
            value={newChannel.name}
            onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })}
          />
          <select
            value={newChannel.rateType}
            onChange={(e) => setNewChannel({ ...newChannel, rateType: e.target.value })}
          >
            <option value="">Select a rate type</option>
            {rateTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.label}
              </option>
            ))}
          </select>
          <button onClick={addChannel}>Add</button>
        </div>
      </section>

      {/* Events */}
      <section className="card">
        <header className="card-header">
          <h3>Events</h3>
        </header>
        <div className="card-body">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>End</th>
                <th>Rate Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <input
                      value={ev.name ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEvents((prev) =>
                          prev.map((x) => (x.id === ev.id ? { ...x, name: v } : x))
                        );
                      }}
                      onBlur={(e) => updateEvent(ev.id, "name", e.target.value)}
                    />
                  </td>
                  <td>
                    <input
  type="date"
  value={(ev.startDate ?? "").slice(0, 10)}
  onChange={(e) => updateEvent(ev.id, "startDate", e.target.value)}
/>
<input
  type="date"
  value={(ev.endDate ?? "").slice(0, 10)}
  onChange={(e) => updateEvent(ev.id, "endDate", e.target.value)}
/>
                  </td>
                  <td>
                    <select
                      value={ev.rateType ?? ""}
                      onChange={(e) => updateEvent(ev.id, "rateType", e.target.value)}
                    >
                      <option value="">Select a rate type</option>
                      {rateTypes.map((rt) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button onClick={() => deleteEvent(ev.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h4 className="mt-2">Add Event</h4>
          <input
            placeholder="Event Name"
            value={newEvent.name}
            onChange={(e) => setNewEvent({ ...newEvent, name: e.target.value })}
          />
          <input
            type="date"
            value={newEvent.startDate}
            onChange={(e) => setNewEvent({ ...newEvent, startDate: e.target.value })}
          />
          <input
            type="date"
            value={newEvent.endDate}
            onChange={(e) => setNewEvent({ ...newEvent, endDate: e.target.value })}
          />
          <select
            value={newEvent.rateType}
            onChange={(e) => setNewEvent({ ...newEvent, rateType: e.target.value })}
          >
            <option value="">Select a rate type</option>
            {rateTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.label}
              </option>
            ))}
          </select>
          <button onClick={addEvent}>Add</button>
        </div>
      </section>

      {/* Rates (grouped by roomType) */}
<section className="card">
  <header className="card-header">
    <h3>Rates</h3>
  </header>
  <div className="card-body">
    <table className="table rates-table">
      <thead>
        <tr>
          <th>Room Type</th>
          <th colSpan="2">Direct</th>
          <th>OTA</th>
        </tr>
        <tr>
          <th></th>
          <th className="weekday-col">Weekday (Mon–Fri)</th>
          <th className="weekend-col">Weekend (Sat–Sun)</th>
          <th className="ota-col">Custom</th>
        </tr>
      </thead>
      <tbody>
        {[...new Set(rooms.map(r => r.roomType))].map((type) => {
          const directDoc =
            rates.find(r => r.roomType === type && r.channelId === "direct") ||
            { roomType: type, channelId: "direct", weekdayRate: "", weekendRate: "" };

          const otaDoc =
            rates.find(r => r.roomType === type && r.channelId === "ota") ||
            { roomType: type, channelId: "ota", price: "", rateType: "custom" };

          return (
            <tr key={type}>
              <td>{type}</td>
              <td className="weekday-col">
                <input
                  type="number"
                  value={directDoc.weekdayRate ?? ""}
                  onChange={(e) =>
                    updateRate(type, "direct", { weekdayRate: Number(e.target.value) })
                  }
                  onBlur={() => saveRate(type, "direct")}
                />
              </td>
              <td className="weekend-col">
                <input
                  type="number"
                  value={directDoc.weekendRate ?? ""}
                  onChange={(e) =>
                    updateRate(type, "direct", { weekendRate: Number(e.target.value) })
                  }
                  onBlur={() => saveRate(type, "direct")}
                />
              </td>
              <td className="ota-col">
                <input
                  type="number"
                  value={otaDoc.price ?? ""}
                  onChange={(e) =>
                    updateRate(type, "ota", { price: Number(e.target.value), rateType: "custom" })
                  }
                  onBlur={() => saveRate(type, "ota")}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
</section>
    </div>
  );
}