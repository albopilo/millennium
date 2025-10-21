import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";

// ===== Helper UI Components =====
const Card = ({ title, children }) => (
  <section className="bg-white rounded-2xl shadow-md mb-6 border border-gray-200">
    <header className="border-b px-4 py-2 flex justify-between items-center bg-gray-50 rounded-t-2xl">
      <h3 className="text-lg font-semibold text-gray-700">{title}</h3>
    </header>
    <div className="p-4">{children}</div>
  </section>
);

const Input = ({ label, value, onChange, type = "text", placeholder, className = "" }) => (
  <div className={`flex flex-col mb-2 ${className}`}>
    {label && <label className="text-sm text-gray-600 mb-1">{label}</label>}
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

const Button = ({ children, onClick, color = "blue", variant = "solid", className = "" }) => {
  const base =
    "px-3 py-2 text-sm rounded-md font-medium transition-all duration-150 " +
    (variant === "solid"
      ? `bg-${color}-600 text-white hover:bg-${color}-700`
      : `border border-${color}-600 text-${color}-700 hover:bg-${color}-50`);
  return (
    <button onClick={onClick} className={`${base} ${className}`}>
      {children}
    </button>
  );
};

// ===== Main Component =====
export default function AdminSettingsGeneral({ permissions = [], permLoading }) {
  const can = (perm) => Array.isArray(permissions) && (permissions.includes(perm) || permissions.includes("*"));

  // States
  const [depositPerRoom, setDepositPerRoom] = useState("");
  const [rooms, setRooms] = useState([]);
  const [channels, setChannels] = useState([]);
  const [events, setEvents] = useState([]);
  const [rateTypes, setRateTypes] = useState([]);
  const [rates, setRates] = useState([]);
  const [loading, setLoading] = useState(true);

  const [newRoom, setNewRoom] = useState({ roomNumber: "", roomType: "" });
  const [newChannel, setNewChannel] = useState({ name: "", rateType: "" });
  const [newEvent, setNewEvent] = useState({ name: "", startDate: "", endDate: "", rateType: "" });

  const PERM = {
    settings: "canManageSettings",
    rooms: "canManageRooms",
    channels: "canManageChannels",
    events: "canManageEvents",
    rates: "canManageRates",
  };

  const guard = (permName) => {
    if (permLoading || !(can(permName) || can("*"))) {
      alert("You do not have permission for this action.");
      return false;
    }
    return true;
  };

  // Fetch all data concurrently
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsSnap, roomsSnap, channelsSnap, eventsSnap, rateTypesSnap, ratesSnap] =
        await Promise.all([
          getDoc(doc(db, "settings", "general")),
          getDocs(collection(db, "rooms")),
          getDocs(collection(db, "channels")),
          getDocs(collection(db, "events")),
          getDocs(collection(db, "rateTypes")),
          getDocs(collection(db, "rates")),
        ]);

      if (settingsSnap.exists())
        setDepositPerRoom(String(settingsSnap.data().depositPerRoom || ""));
      setRooms(roomsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setChannels(channelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setEvents(eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRateTypes(rateTypesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setRates(ratesSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Data load failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!permLoading && can("*")) fetchData();
  }, [permLoading, permissions, fetchData]);

  if (permLoading) return <p>Loading permissions…</p>;
  if (!can("*")) return <p className="text-center text-gray-500">Access denied</p>;

  // ===== Actions =====
  const saveDeposit = async () => {
    if (!guard(PERM.settings)) return;
    const val = Number(depositPerRoom);
    if (!Number.isFinite(val) || val < 0) return alert("Invalid number.");
    await setDoc(doc(db, "settings", "general"), { depositPerRoom: val }, { merge: true });
    alert("Deposit updated.");
  };

  const addItem = async (collectionName, item, perm) => {
    if (!guard(perm)) return;
    await addDoc(collection(db, collectionName), item);
    await fetchData();
  };

  const updateItem = async (collectionName, id, data, perm) => {
    if (!guard(perm)) return;
    await updateDoc(doc(db, collectionName, id), data);
    await fetchData();
  };

  const deleteItem = async (collectionName, id, perm) => {
    if (!guard(perm)) return;
    if (!window.confirm("Are you sure?")) return;
    await deleteDoc(doc(db, collectionName, id));
    await fetchData();
  };

  const saveRate = async (roomType, channelId, rateObj) => {
    if (!guard(PERM.rates)) return;
    const ref = doc(db, "rates", `${roomType}__${channelId}`);
    await setDoc(ref, rateObj, { merge: true });
    fetchData();
  };

  if (loading) return <p className="text-gray-500 text-center">Loading data...</p>;

  // ===== UI =====
  return (
    <div className="max-w-6xl mx-auto p-6">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">⚙️ Admin Settings</h2>

      {/* Deposit */}
      <Card title="Deposit Per Room">
        <div className="flex items-center gap-3">
          <Input
            type="number"
            value={depositPerRoom}
            onChange={(e) => setDepositPerRoom(e.target.value)}
            placeholder="Enter amount"
          />
          <Button onClick={saveDeposit}>Save</Button>
        </div>
      </Card>

      {/* Rooms */}
      <Card title="Rooms">
        <table className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="p-2 text-left">Room #</th>
              <th className="p-2 text-left">Type</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} className="border-t">
                <td className="p-2">
                  <input
                    value={r.roomNumber}
                    onChange={(e) => updateItem("rooms", r.id, { roomNumber: e.target.value }, PERM.rooms)}
                    className="border-b border-gray-300 w-full focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="p-2">
                  <input
                    value={r.roomType}
                    onChange={(e) => updateItem("rooms", r.id, { roomType: e.target.value }, PERM.rooms)}
                    className="border-b border-gray-300 w-full focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="p-2 text-right">
                  <Button color="red" variant="outline" onClick={() => deleteItem("rooms", r.id, PERM.rooms)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex gap-3">
          <Input placeholder="Room #" value={newRoom.roomNumber} onChange={(e) => setNewRoom({ ...newRoom, roomNumber: e.target.value })} />
          <Input placeholder="Type" value={newRoom.roomType} onChange={(e) => setNewRoom({ ...newRoom, roomType: e.target.value })} />
          <Button onClick={() => addItem("rooms", newRoom, PERM.rooms)}>Add</Button>
        </div>
      </Card>

      {/* Channels */}
      <Card title="Channels & Rate Types">
        <table className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Rate Type</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2">
                  <input
                    value={c.name}
                    onChange={(e) => updateItem("channels", c.id, { name: e.target.value }, PERM.channels)}
                    className="border-b w-full focus:border-blue-500 focus:outline-none"
                  />
                </td>
                <td className="p-2">
                  <select
                    value={c.rateType || ""}
                    onChange={(e) => updateItem("channels", c.id, { rateType: e.target.value }, PERM.channels)}
                    className="border rounded-md px-2 py-1 w-full"
                  >
                    <option value="">Select</option>
                    {rateTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>{rt.label}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2 text-right">
                  <Button color="red" variant="outline" onClick={() => deleteItem("channels", c.id, PERM.channels)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex gap-3">
          <Input placeholder="Channel Name" value={newChannel.name} onChange={(e) => setNewChannel({ ...newChannel, name: e.target.value })} />
          <select
            className="border rounded-md px-2 py-1"
            value={newChannel.rateType}
            onChange={(e) => setNewChannel({ ...newChannel, rateType: e.target.value })}
          >
            <option value="">Select Rate Type</option>
            {rateTypes.map((rt) => (
              <option key={rt.id} value={rt.id}>{rt.label}</option>
            ))}
          </select>
          <Button onClick={() => addItem("channels", newChannel, PERM.channels)}>Add</Button>
        </div>
      </Card>

      {/* Events */}
      <Card title="Events">
        <table className="w-full border-collapse text-sm mb-3">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="p-2 text-left">Name</th>
              <th className="p-2 text-left">Start</th>
              <th className="p-2 text-left">End</th>
              <th className="p-2 text-left">Rate Type</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => (
              <tr key={ev.id} className="border-t">
                <td className="p-2">
                  <input
                    value={ev.name}
                    onChange={(e) => updateItem("events", ev.id, { name: e.target.value }, PERM.events)}
                    className="border-b w-full"
                  />
                </td>
                <td className="p-2"><input type="date" value={ev.startDate?.slice(0,10) || ""} onChange={(e)=>updateItem("events",ev.id,{startDate:e.target.value},PERM.events)} /></td>
                <td className="p-2"><input type="date" value={ev.endDate?.slice(0,10) || ""} onChange={(e)=>updateItem("events",ev.id,{endDate:e.target.value},PERM.events)} /></td>
                <td className="p-2">
                  <select
                    value={ev.rateType || ""}
                    onChange={(e) => updateItem("events", ev.id, { rateType: e.target.value }, PERM.events)}
                    className="border rounded-md px-2 py-1"
                  >
                    <option value="">Select</option>
                    {rateTypes.map((rt) => (
                      <option key={rt.id} value={rt.id}>{rt.label}</option>
                    ))}
                  </select>
                </td>
                <td className="p-2 text-right">
                  <Button color="red" variant="outline" onClick={() => deleteItem("events", ev.id, PERM.events)}>
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="grid grid-cols-5 gap-3">
          <Input placeholder="Event Name" value={newEvent.name} onChange={(e)=>setNewEvent({...newEvent,name:e.target.value})}/>
          <Input type="date" value={newEvent.startDate} onChange={(e)=>setNewEvent({...newEvent,startDate:e.target.value})}/>
          <Input type="date" value={newEvent.endDate} onChange={(e)=>setNewEvent({...newEvent,endDate:e.target.value})}/>
          <select className="border rounded-md px-2 py-1" value={newEvent.rateType} onChange={(e)=>setNewEvent({...newEvent,rateType:e.target.value})}>
            <option value="">Select Rate Type</option>
            {rateTypes.map((rt)=><option key={rt.id} value={rt.id}>{rt.label}</option>)}
          </select>
          <Button onClick={()=>addItem("events",newEvent,PERM.events)}>Add</Button>
        </div>
      </Card>

      {/* Rates */}
      <Card title="Rates">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-700">
              <th className="p-2 text-left">Room Type</th>
              <th className="p-2 text-center" colSpan={2}>Direct</th>
              <th className="p-2 text-center">OTA</th>
            </tr>
            <tr className="bg-gray-50 text-xs text-gray-600">
              <th></th><th>Weekday</th><th>Weekend</th><th>Price</th>
            </tr>
          </thead>
          <tbody>
            {[...new Set(rooms.map(r=>r.roomType))].map((type)=>{
              const direct = rates.find(r=>r.roomType===type && r.channelId==="direct")||{};
              const ota = rates.find(r=>r.roomType===type && r.channelId==="ota")||{};
              return (
                <tr key={type} className="border-t">
                  <td className="p-2 font-medium">{type}</td>
                  <td className="p-2 text-center"><input type="number" value={direct.weekdayRate||""} onBlur={(e)=>saveRate(type,"direct",{roomType:type,channelId:"direct",weekdayRate:Number(e.target.value),weekendRate:direct.weekendRate||0})} /></td>
                  <td className="p-2 text-center"><input type="number" value={direct.weekendRate||""} onBlur={(e)=>saveRate(type,"direct",{roomType:type,channelId:"direct",weekdayRate:direct.weekdayRate||0,weekendRate:Number(e.target.value)})} /></td>
                  <td className="p-2 text-center"><input type="number" value={ota.price||""} onBlur={(e)=>saveRate(type,"ota",{roomType:type,channelId:"ota",price:Number(e.target.value),rateType:"custom"})} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
