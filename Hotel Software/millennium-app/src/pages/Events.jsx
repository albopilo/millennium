import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";

export default function Events({ permissions }) {
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({
    name: "",
    startDate: "",
    endDate: "",
    rateType: "weekend",
    customRates: {
      "Standard Double": "",
      "Deluxe Double": "",
      "Suite Double": "",
      "Suite VIP": ""
    }
  });
  const [editId, setEditId] = useState(null);

  const can = (perm) => permissions.includes(perm) || permissions.includes("*");

  const loadEvents = async () => {
    const snap = await getDocs(collection(db, "events"));
    setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadEvents();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!can("canManageEvents")) return;

    const payload = {
  name: form.name,
  startDate: form.startDate, // keep YYYY-MM-DD
  endDate: form.endDate,
  rateType: form.rateType
};

    if (form.rateType === "custom") {
      const rates = {};
      for (const [type, val] of Object.entries(form.customRates)) {
        rates[type] = Number(val) || 0;
      }
      payload.customRates = rates;
    }

    if (editId) {
      await updateDoc(doc(db, "events", editId), payload);
      setEditId(null);
    } else {
      await addDoc(collection(db, "events"), payload);
    }

    setForm({
      name: "",
      startDate: "",
      endDate: "",
      rateType: "weekend",
      customRates: {
        "Standard Double": "",
        "Deluxe Double": "",
        "Suite Double": "",
        "Suite VIP": ""
      }
    });
    loadEvents();
  };

  const handleEdit = (ev) => {
    setForm({
  name: ev.name,
  startDate: (ev.startDate ?? "").slice(0, 10),
  endDate: (ev.endDate ?? "").slice(0, 10),
  rateType: ev.rateType,
  customRates: ev.customRates || { "Standard Double": "", "Deluxe Double": "", "Suite Double": "", "Suite VIP": "" }
});
    setEditId(ev.id);
  };

  const handleDelete = async (id) => {
    if (!can("canManageEvents")) return;
    await deleteDoc(doc(db, "events", id));
    loadEvents();
  };

  return (
    <div>
      <h2>Manage Events</h2>

      {can("canManageEvents") && (
        <form onSubmit={handleSubmit}>
          <input
            placeholder="Event Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            required
          />
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => setForm({ ...form, endDate: e.target.value })}
            required
          />
          <select
            value={form.rateType}
            onChange={(e) => setForm({ ...form, rateType: e.target.value })}
          >
            <option value="weekend">Weekend Pricing</option>
            <option value="custom">Custom Pricing</option>
          </select>

          {form.rateType === "custom" && (
            <div style={{ marginTop: "10px" }}>
              <h4>Custom Rates</h4>
              {Object.keys(form.customRates).map((type) => (
                <div key={type}>
                  <label>{type}: </label>
                  <input
                    type="number"
                    value={form.customRates[type]}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        customRates: { ...form.customRates, [type]: e.target.value }
                      })
                    }
                    required
                  />
                </div>
              ))}
            </div>
          )}

          <button type="submit" style={{ marginTop: "10px" }}>
            {editId ? "Update" : "Add"} Event
          </button>
        </form>
      )}

      <table border="1" cellPadding="5" style={{ marginTop: "20px" }}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Start</th>
            <th>End</th>
            <th>Rate Type</th>
            {can("canManageEvents") && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {events.map(ev => (
            <tr key={ev.id}>
              <td>{ev.name}</td>
              <td>{new Date(ev.startDate).toLocaleDateString()}</td>
              <td>{new Date(ev.endDate).toLocaleDateString()}</td>
              <td>
                {ev.rateType}
                {ev.rateType === "custom" && ev.customRates && (
                  <div style={{ fontSize: "0.85em" }}>
                    {Object.entries(ev.customRates).map(([type, rate]) => (
                      <div key={type}>{type}: {rate}</div>
                    ))}
                  </div>
                )}
              </td>
              {can("canManageEvents") && (
                <td>
                  <button onClick={() => handleEdit(ev)}>Edit</button>
                  <button onClick={() => handleDelete(ev.id)}>Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}