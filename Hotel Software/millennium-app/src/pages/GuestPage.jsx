import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc
} from "firebase/firestore";
import { db } from "../firebase"; // Millennium DB
import { loyaltyDb } from "../loyaltyFirebase"; // 13e-Loyalty DB
import "./Guests.css";
import { Link } from "react-router-dom";  // add at top

export default function GuestPage({ permissions }) {
  const [guests, setGuests] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    ktpNumber: "",
    company: "",
    notes: ""
  });
  const [editId, setEditId] = useState(null);

  const can = (perm) => permissions.includes(perm) || permissions.includes("*");

  const loadGuests = async () => {
    const snap = await getDocs(collection(db, "guests"));
    const sorted = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setGuests(sorted);
  };

  const syncLoyaltyMembers = async () => {
    try {
      const loyaltySnap = await getDocs(collection(loyaltyDb, "members"));
      const loyaltyMembers = loyaltySnap.docs.map(d => ({ id: d.id, ...d.data() }));

      const hotelSnap = await getDocs(collection(db, "guests"));
      const hotelGuests = hotelSnap.docs.map(d => ({ id: d.id, ...d.data() }));

      // Map by both email and phone to avoid duplicates
      const hotelGuestKeys = new Set(
        hotelGuests.map(g => (g.email || "").toLowerCase()).concat(
          hotelGuests.map(g => (g.phone || "").toLowerCase())
        )
      );

      for (const member of loyaltyMembers) {
        const emailKey = (member.email || "").toLowerCase();
        const phoneKey = (member.phone || "").toLowerCase();

        // Find existing guest by email or phone
        const existing = hotelGuests.find(
          g =>
            (g.email && g.email.toLowerCase() === emailKey) ||
            (g.phone && g.phone.toLowerCase() === phoneKey)
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
            tier: member.tier || "",
            benefits: member.benefits || [],
            ktpNumber: "" // loyalty members don't have KTP
          });
        } else if (existing.tier !== member.tier) {
          await updateDoc(doc(db, "guests", existing.id), {
            tier: member.tier || "",
            benefits: member.benefits || []
          });
        }
      }
    } catch (err) {
      console.error("Error syncing loyalty members:", err);
    }
  };

  useEffect(() => {
    (async () => {
      await syncLoyaltyMembers();
      await loadGuests();
    })();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!can("canManageGuests")) return;

    // Manual validation for required fields
    if (!form.name || !form.phone || !form.city || !form.ktpNumber || !form.address) {
      alert("Please fill in Full Name, Phone, City, KTP Number, and Address.");
      return;
    }

    const guestData = {
      ...form,
      createdAt: new Date().toISOString(),
      tier: "", // manual adds have no tier
      benefits: []
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
      notes: ""
    });
    loadGuests();
  };

  const handleEdit = (guest) => {
    setForm({
      name: guest.name,
      email: guest.email,
      phone: guest.phone,
      address: guest.address,
      city: guest.city || "",
      ktpNumber: guest.ktpNumber || "",
      company: guest.company,
      notes: guest.notes || ""
    });
    setEditId(guest.id);
  };

  const handleDelete = async (id) => {
    if (!can("canManageGuests")) return;
    if (!window.confirm("Delete this guest?")) return;
    await deleteDoc(doc(db, "guests", id));
    loadGuests();
  };

  const filteredGuests = guests.filter(g =>
    g.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="guests-container">
      <h2>Guests</h2>

      {/* Search bar */}
      <input
        type="text"
        placeholder="Search by name..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: "10px", padding: "5px", width: "250px" }}
      />

      {can("canManageGuests") && (
        <form onSubmit={handleSubmit} className="guest-form">
          <input placeholder="Full Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
          <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} required />
          <input placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} required />
          <input placeholder="KTP Number" value={form.ktpNumber} onChange={(e) => setForm({ ...form, ktpNumber: e.target.value })} required />
          <input placeholder="Company" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}></textarea>
          <button type="submit" className="btn-primary">{editId ? "Update Guest" : "Add Guest"}</button>
        </form>
      )}

      <table className="guests-table">
        <thead>
          <tr>
            <th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>City</th><th>KTP</th><th>Company</th><th>Tier</th><th>Benefits</th><th>Notes</th>
            {can("canManageGuests") && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {filteredGuests.map(g => (
            <tr key={g.id}>
              <td> <Link to={`/guests/${g.id}`} className="text-blue-600 underline"> {g.name} </Link> </td>
              <td>{g.email}</td>
              <td>{g.phone}</td>
              <td>{g.address}</td>
              <td>{g.city || "—"}</td>
              <td>{g.ktpNumber || "—"}</td>
              <td>{g.company}</td>
              <td>{g.tier || "—"}</td>
              <td>{g.benefits?.length ? g.benefits.join(", ") : "—"}</td>
              <td>{g.notes}</td>
              {can("canManageGuests") && (
                <td>
                  <button onClick={() => handleEdit(g)} className="btn-secondary">Edit</button>
                  <button onClick={() => handleDelete(g.id)} className="btn-danger">Delete</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}