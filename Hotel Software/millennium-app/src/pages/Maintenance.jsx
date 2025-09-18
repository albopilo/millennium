import { useEffect, useState } from "react";
import { collection, addDoc, getDocs, updateDoc, doc } from "firebase/firestore";
import { db } from "../firebase";

export default function Maintenance({ permissions = [] }) {
  const [tickets, setTickets] = useState([]);
  const [form, setForm] = useState({
    roomNumber: "",
    title: "",
    description: "",
    priority: "medium"
  });

  const can = (p) => permissions.includes(p) || permissions.includes("*");

  const load = async () => {
    const snap = await getDocs(collection(db, "maintenanceTickets"));
    setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!can("canManageMaintenance")) return;
    await addDoc(collection(db, "maintenanceTickets"), {
      ...form,
      status: "open",
      createdAt: new Date()
    });
    setForm({ roomNumber: "", title: "", description: "", priority: "medium" });
    load();
  };

  const close = async (id) => {
    if (!can("canManageMaintenance")) return;
    await updateDoc(doc(db, "maintenanceTickets", id), {
      status: "closed",
      closedAt: new Date()
    });
    load();
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "grid", gap: 8, maxWidth: 480 }}>
        <input
          placeholder="Room Number"
          value={form.roomNumber}
          onChange={e => setForm({ ...form, roomNumber: e.target.value })}
        />
        <input
          placeholder="Title"
          value={form.title}
          onChange={e => setForm({ ...form, title: e.target.value })}
        />
        <textarea
          placeholder="Description"
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
        <select
          value={form.priority}
          onChange={e => setForm({ ...form, priority: e.target.value })}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button onClick={create} disabled={!can("canManageMaintenance")}>
          Create Ticket
        </button>
      </div>

      <table className="table" style={{ marginTop: 16, width: "100%" }}>
        <thead>
          <tr>
            <th>Room</th>
            <th>Title</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map(t => (
            <tr key={t.id}>
              <td>{t.roomNumber || "-"}</td>
              <td>{t.title}</td>
              <td>{t.priority}</td>
              <td>{t.status}</td>
              <td>
                {t.status !== "closed" && can("canManageMaintenance") && (
                  <button onClick={() => close(t.id)}>Close</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}