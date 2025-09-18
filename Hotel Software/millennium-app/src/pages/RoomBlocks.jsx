import { useEffect, useState } from "react";
import { collection, addDoc, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export default function RoomBlocks({ permissions = [] }) {
  const [blocks, setBlocks] = useState([]);
  const [form, setForm] = useState({
    roomNumber: "",
    startDate: "",
    endDate: "",
    reason: ""
  });

  const can = (p) => permissions.includes(p) || permissions.includes("*");

  const load = async () => {
    const snap = await getDocs(collection(db, "roomBlocks"));
    setBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!can("*")) return;
    await addDoc(collection(db, "roomBlocks"), {
      ...form,
      startDate: new Date(form.startDate),
      endDate: new Date(form.endDate),
      createdAt: new Date()
    });
    setForm({ roomNumber: "", startDate: "", endDate: "", reason: "" });
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
          type="date"
          value={form.startDate}
          onChange={e => setForm({ ...form, startDate: e.target.value })}
        />
        <input
          type="date"
          value={form.endDate}
          onChange={e => setForm({ ...form, endDate: e.target.value })}
        />
        <input
          placeholder="Reason"
          value={form.reason}
          onChange={e => setForm({ ...form, reason: e.target.value })}
        />
        <button onClick={create}>Create Block</button>
      </div>

      <table className="table" style={{ marginTop: 16, width: "100%" }}>
        <thead>
          <tr><th>Room</th><th>Start</th><th>End</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {blocks.map(b => (
            <tr key={b.id}>
              <td>{b.roomNumber || "-"}</td>
              <td>{new Date(b.startDate.seconds ? b.startDate.seconds * 1000 : b.startDate).toLocaleDateString()}</td>
              <td>{new Date(b.endDate.seconds ? b.endDate.seconds * 1000 : b.endDate).toLocaleDateString()}</td>
              <td>{b.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}