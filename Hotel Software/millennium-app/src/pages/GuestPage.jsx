// src/pages/GuestPage.jsx
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebase";
import { loyaltyDb } from "../loyaltyFirebase";
import "./Guests.css";
import { Link } from "react-router-dom";

export default function GuestPage({ permissions = [] }) {
  const [guests, setGuests] = useState([]);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    ktpNumber: "",
    company: "",
    notes: "",
  });

  const can = (perm) => permissions.includes(perm) || permissions.includes("*");

  // 🟢 Load guests
  const loadGuests = async () => {
    const snap = await getDocs(collection(db, "guests"));
    const sorted = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    setGuests(sorted);
  };

  // 🔄 Sync with loyalty
  const syncLoyaltyMembers = async () => {
    try {
      const loyaltySnap = await getDocs(collection(loyaltyDb, "members"));
      const loyaltyMembers = loyaltySnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      const hotelSnap = await getDocs(collection(db, "guests"));
      const hotelGuests = hotelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      for (const member of loyaltyMembers) {
        const existing = hotelGuests.find(
          (g) =>
            g.email?.toLowerCase() === (member.email || "").toLowerCase() ||
            g.phone?.toLowerCase() === (member.phone || "").toLowerCase()
        );

        if (!existing) {
          await addDoc(collection(db, "guests"), {
            name: member.name || "",
            email: member.email || "",
            phone: member.phone || "",
            address: member.address || "",
            city: member.city || "",
            company: member.company || "",
            notes: member.notes || "",
            createdAt: new Date().toISOString(),
            tier: member.tier || "Classic",
            benefits: member.benefits || [],
            ktpNumber: "",
          });
        } else if (existing.tier !== member.tier) {
          await updateDoc(doc(db, "guests", existing.id), {
            tier: member.tier || "Classic",
            benefits: member.benefits || [],
          });
        }
      }
    } catch (err) {
      console.error("Error syncing loyalty members:", err);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await syncLoyaltyMembers();
      await loadGuests();
      setLoading(false);
    })();
  }, []);

  // 🧾 Submit handler
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!can("canManageGuests")) return;

    const { name, phone, city, ktpNumber, address } = form;
    if (!name || !phone || !city || !ktpNumber || !address) {
      alert("Please fill in Name, Phone, City, KTP Number, and Address.");
      return;
    }

    const guestData = {
      ...form,
      createdAt: new Date().toISOString(),
      tier: "Classic", // 🔹 Auto-assign Classic
      benefits: [],
    };

    if (editId) {
      await updateDoc(doc(db, "guests", editId), guestData);
      setEditId(null);
    } else {
      await addDoc(collection(db, "guests"), guestData);
    }

    setForm({
      name: "",
      email: "",
      phone: "",
      address: "",
      city: "",
      ktpNumber: "",
      company: "",
      notes: "",
    });

    await loadGuests();
  };

  // ✏️ Edit
  const handleEdit = (guest) => {
    setForm({
      name: guest.name || "",
      email: guest.email || "",
      phone: guest.phone || "",
      address: guest.address || "",
      city: guest.city || "",
      ktpNumber: guest.ktpNumber || "",
      company: guest.company || "",
      notes: guest.notes || "",
    });
    setEditId(guest.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // 🗑️ Delete
  const handleDelete = async (id) => {
    if (!can("canManageGuests")) return;
    if (!window.confirm("Delete this guest?")) return;
    await deleteDoc(doc(db, "guests", id));
    await loadGuests();
  };

  const filteredGuests = guests.filter((g) =>
    g.name?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="guests-container">
      <h2>Guest Management</h2>

      {/* 🔍 Search bar */}
      <div style={{ marginBottom: 20 }}>
        <input
          type="text"
          placeholder="🔍 Search guest by name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "8px 12px",
            width: "280px",
            borderRadius: 6,
            border: "1px solid #ccc",
          }}
        />
      </div>

      {can("canManageGuests") && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 20,
            marginBottom: 25,
            boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
          }}
        >
          <h3 style={{ marginBottom: 15 }}>
            {editId ? "Edit Guest" : "Add New Guest"}
          </h3>
          <form onSubmit={handleSubmit} className="guest-form">
            <div>
              <label>Full Name *</label>
              <input
                placeholder="e.g., John Doe"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label>Email</label>
              <input
                type="email"
                placeholder="example@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label>Phone *</label>
              <input
                placeholder="08123456789"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div>
              <label>Address *</label>
              <input
                placeholder="Street name, number, etc."
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div>
              <label>City *</label>
              <input
                placeholder="Jakarta"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <label>KTP Number *</label>
              <input
                placeholder="Identity Number"
                value={form.ktpNumber}
                onChange={(e) =>
                  setForm({ ...form, ktpNumber: e.target.value })
                }
              />
            </div>
            <div>
              <label>Company</label>
              <input
                placeholder="Optional"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
              />
            </div>
            <div style={{ gridColumn: "1 / span 2" }}>
              <label>Notes</label>
              <textarea
                placeholder="Special requests, remarks..."
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>
            <button type="submit" className="btn-primary">
              {editId ? "Update Guest" : "Add Guest"}
            </button>
          </form>
        </div>
      )}

      {/* 🧾 Guest list */}
      {loading ? (
        <p>Loading guests...</p>
      ) : (
        <table className="guests-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Address</th>
              <th>City</th>
              <th>KTP</th>
              <th>Company</th>
              <th>Tier</th>
              <th>Benefits</th>
              <th>Notes</th>
              {can("canManageGuests") && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredGuests.map((g) => (
              <tr key={g.id}>
                <td>
                  <Link
                    to={`/guests/${g.id}`}
                    className="text-blue-600 underline"
                  >
                    {g.name}
                  </Link>
                </td>
                <td>{g.email || "—"}</td>
                <td>{g.phone || "—"}</td>
                <td>{g.address || "—"}</td>
                <td>{g.city || "—"}</td>
                <td>{g.ktpNumber || "—"}</td>
                <td>{g.company || "—"}</td>
                <td>{g.tier || "Classic"}</td>
                <td>{g.benefits?.length ? g.benefits.join(", ") : "—"}</td>
                <td>{g.notes || "—"}</td>
                {can("canManageGuests") && (
                  <td>
                    <button
                      onClick={() => handleEdit(g)}
                      className="btn-secondary"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(g.id)}
                      className="btn-danger"
                    >
                      Delete
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
