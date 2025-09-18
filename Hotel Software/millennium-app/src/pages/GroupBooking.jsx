import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { createGroupWithReservations } from "../lib/groups";

export default function GroupBooking({ permissions = [] }) {
  const [rooms, setRooms] = useState([]);
  const [form, setForm] = useState({
    groupName: "",
    organiser: "",
    contact: "",
    checkInDate: "",
    checkOutDate: "",
    roomNumbers: [],
    channel: "direct",
    depositPerRoom: 0
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const can = (p) => permissions.includes(p) || permissions.includes("*");

  useEffect(() => {
    (async () => {
      const snap = await getDocs(collection(db, "rooms"));
      setRooms(snap.docs.map(d => d.data()));
    })();
  }, []);

  const handleSubmit = async () => {
    setMessage("");
    if (!can("canCreateReservations")) {
      setMessage("You do not have permission to create group bookings.");
      return;
    }
    if (
      !form.groupName ||
      !form.organiser ||
      !form.checkInDate ||
      !form.checkOutDate ||
      !form.roomNumbers.length
    ) {
      setMessage("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    try {
      const groupId = await createGroupWithReservations({
        name: form.groupName,
        organiser: form.organiser,
        contact: form.contact,
        arrivalDate: form.checkInDate,
        departureDate: form.checkOutDate,
        roomNumbers: form.roomNumbers,
        channel: form.channel,
        depositPerRoom: Number(form.depositPerRoom || 0)
      });
      setMessage(`✅ Group created successfully (ID: ${groupId})`);
      setForm({
        ...form,
        groupName: "",
        organiser: "",
        contact: "",
        checkInDate: "",
        checkOutDate: "",
        roomNumbers: [],
        depositPerRoom: 0
      });
    } catch (err) {
      setMessage(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: 16, display: "grid", gap: 12, maxWidth: 600 }}>
      {message && (
        <div
          style={{
            whiteSpace: "pre-line",
            color: message.startsWith("✅") ? "green" : "red"
          }}
        >
          {message}
        </div>
      )}

      <input
        placeholder="Group Name"
        value={form.groupName}
        onChange={(e) => setForm({ ...form, groupName: e.target.value })}
      />
      <input
        placeholder="Organiser Name"
        value={form.organiser}
        onChange={(e) => setForm({ ...form, organiser: e.target.value })}
      />
      <input
        placeholder="Contact Info"
        value={form.contact}
        onChange={(e) => setForm({ ...form, contact: e.target.value })}
      />

      <label>Check-In Date:</label>
      <input
        type="date"
        value={form.checkInDate}
        onChange={(e) => setForm({ ...form, checkInDate: e.target.value })}
      />

      <label>Check-Out Date:</label>
      <input
        type="date"
        value={form.checkOutDate}
        onChange={(e) => setForm({ ...form, checkOutDate: e.target.value })}
      />

      <label>Rooms:</label>
      <select
        multiple
        style={{ width: "100%", minHeight: "150px" }}
        value={form.roomNumbers}
        onChange={(e) =>
          setForm({
            ...form,
            roomNumbers: Array.from(e.target.selectedOptions, opt => opt.value)
          })
        }
      >
        {rooms.map(r => (
          <option key={r.roomNumber} value={r.roomNumber}>
            {r.roomNumber} ({r.roomType})
          </option>
        ))}
      </select>

      <label>Channel:</label>
      <select
        value={form.channel}
        onChange={(e) => setForm({ ...form, channel: e.target.value })}
      >
        <option value="direct">Direct</option>
        <option value="ota">OTA</option>
      </select>

      <label>Deposit Per Room:</label>
      <input
        type="number"
        value={form.depositPerRoom}
        onChange={(e) => setForm({ ...form, depositPerRoom: e.target.value })}
      />

      <button onClick={handleSubmit} disabled={loading}>
        {loading ? "Creating..." : "Create Group Booking"}
      </button>
    </div>
  );
}