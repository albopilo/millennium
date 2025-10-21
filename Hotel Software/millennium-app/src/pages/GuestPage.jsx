// src/pages/GuestPage.jsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import { loyaltyDb } from "../loyaltyFirebase";
import { Link } from "react-router-dom";
import "./Guests.css";

/**
 * GuestPage
 *
 * - Lists guests (read permission: canViewGuestProfiles or '*')
 * - Add / edit / delete guests (write permission: canManageGuests or '*')
 * - Syncs loyalty members from loyaltyDb into guests collection (merge/update)
 * - Manual adds get tier: "classic" and empty benefits array
 * - Search input with debounce
 */
export default function GuestPage({ permissions = [] }) {
  // Permission helpers
  const canView = Array.isArray(permissions) && (permissions.includes("canViewGuestProfiles") || permissions.includes("*"));
  const canManage = Array.isArray(permissions) && (permissions.includes("canManageGuests") || permissions.includes("*"));

  // Local state
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Search + debounce
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef(null);

  // Form state
  const initialForm = {
    name: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    ktpNumber: "",
    company: "",
    notes: "",
    tier: "", // for existing guests (but manual adds will be 'classic' by default)
  };
  const [form, setForm] = useState(initialForm);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);

  // Load guests from Firestore
  const loadGuests = useCallback(async () => {
    if (!canView) return; // do not try to read if no perm
    setLoading(true);
    setError(null);
    try {
      const snap = await getDocs(collection(db, "guests"));
      const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      setGuests(arr);
    } catch (err) {
      console.error("Failed to load guests:", err);
      setError("Failed to load guests. Check console for details.");
    } finally {
      setLoading(false);
    }
  }, [canView]);

  // Sync loyalty members (non-blocking; safe)
  const syncLoyaltyMembers = useCallback(async () => {
    // If there is no loyalty DB configured, skip
    if (!loyaltyDb) return;
    setSyncing(true);
    setError(null);

    try {
      const loyaltySnap = await getDocs(collection(loyaltyDb, "members"));
      const loyaltyMembers = loyaltySnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const hotelSnap = await getDocs(collection(db, "guests"));
      const hotelGuests = hotelSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Build quick lookup maps by normalized email and phone
      const byEmail = new Map();
      const byPhone = new Map();
      for (const g of hotelGuests) {
        if (g.email) byEmail.set(String(g.email).toLowerCase(), g);
        if (g.phone) byPhone.set(String(g.phone).toLowerCase(), g);
      }

      for (const member of loyaltyMembers) {
        const emailKey = (member.email || "").toLowerCase();
        const phoneKey = (member.phone || "").toLowerCase();

        const existing = byEmail.get(emailKey) || byPhone.get(phoneKey) || null;

        if (!existing) {
          // Create a new guest document for this loyalty member
          await addDoc(collection(db, "guests"), {
            name: member.name || "",
            email: member.email || "",
            phone: member.phone || "",
            address: member.address || "",
            city: member.city || "",
            company: member.company || "",
            notes: member.notes || "",
            createdAt: new Date().toISOString(),
            tier: member.tier || "classic",
            benefits: member.benefits || [],
            ktpNumber: "", // loyalty members typically won't have KTP
          });
        } else {
          // Update tier/benefits only if changed
          const wantsTier = member.tier || "";
          const wantsBenefits = member.benefits || [];
          const changed =
            (existing.tier || "") !== wantsTier ||
            JSON.stringify(existing.benefits || []) !== JSON.stringify(wantsBenefits);
          if (changed) {
            await updateDoc(doc(db, "guests", existing.id), {
              tier: wantsTier,
              benefits: wantsBenefits,
            });
          }
        }
      }
    } catch (err) {
      console.error("Error syncing loyalty members:", err);
      // do not throw — sync should be helpful but not fatal
      setError("Loyalty sync failed (check console).");
    } finally {
      setSyncing(false);
      loadGuests(); // refresh after sync
    }
  }, [loadGuests]);

  // On mount: sync loyalty then load guests
  useEffect(() => {
    (async () => {
      try {
        if (canView) {
          // attempt sync, but don't block UI much
          await syncLoyaltyMembers();
          await loadGuests();
        }
      } catch (err) {
        console.error(err);
      }
    })();
  }, [canView, loadGuests, syncLoyaltyMembers]);

  // Debounce search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(searchQuery.trim().toLowerCase()), 220);
    return () => clearTimeout(searchTimer.current);
  }, [searchQuery]);

  // Filtered list
  const filteredGuests = guests.filter((g) => {
    if (!debouncedSearch) return true;
    return (g.name || "").toLowerCase().includes(debouncedSearch) ||
      (g.email || "").toLowerCase().includes(debouncedSearch) ||
      (g.phone || "").toLowerCase().includes(debouncedSearch);
  });

  // Form helpers
  const startAdd = () => {
    setEditId(null);
    setForm({ ...initialForm });
  };

  const startEdit = (guest) => {
    setEditId(guest.id);
    setForm({
      name: guest.name || "",
      email: guest.email || "",
      phone: guest.phone || "",
      address: guest.address || "",
      city: guest.city || "",
      ktpNumber: guest.ktpNumber || "",
      company: guest.company || "",
      notes: guest.notes || "",
      tier: guest.tier || "",
      benefits: guest.benefits || [],
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const cancelEdit = () => {
    setEditId(null);
    setForm({ ...initialForm });
  };

  // Validate simple required fields
  const validateGuestForm = () => {
    if (!form.name.trim()) return "Full name is required.";
    if (!form.phone.trim()) return "Phone is required.";
    if (!form.address.trim()) return "Address is required.";
    if (!form.city.trim()) return "City is required.";
    if (!form.ktpNumber?.trim()) return "KTP Number is required.";
    return null;
  };

  // Submit handler
  const handleSubmit = async (ev) => {
    ev.preventDefault();
    setError(null);

    if (!canManage) {
      setError("You do not have permission to manage guests.");
      return;
    }

    const validationError = validateGuestForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    try {
      // Prepare payload. For manual adds, we set tier: "classic" by requirement.
      const payload = {
        name: form.name.trim(),
        email: form.email?.trim() || "",
        phone: form.phone.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        ktpNumber: form.ktpNumber.trim(),
        company: form.company?.trim() || "",
        notes: form.notes || "",
        createdAt: new Date().toISOString(),
        benefits: form.benefits || [],
      };

      if (editId) {
        // preserve existing tier if not edited
        if (form.tier !== undefined) payload.tier = form.tier || "";
        await updateDoc(doc(db, "guests", editId), payload);
      } else {
        // Manual add always gets "classic"
        payload.tier = "classic";
        await addDoc(collection(db, "guests"), payload);
      }

      // Refresh list and reset
      await loadGuests();
      setForm({ ...initialForm });
      setEditId(null);
    } catch (err) {
      console.error("Save guest failed:", err);
      setError("Save failed. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  // Delete handler
  const handleDelete = async (id) => {
    if (!canManage) {
      setError("You do not have permission to delete guests.");
      return;
    }
    if (!window.confirm("Delete this guest? This action cannot be undone.")) return;
    try {
      await deleteDoc(doc(db, "guests", id));
      await loadGuests();
    } catch (err) {
      console.error("Delete failed:", err);
      setError("Delete failed. Check console for details.");
    }
  };

  // Render
  if (!canView) {
    return <div className="guests-container"><p className="muted">Access denied. You don't have permission to view guest profiles.</p></div>;
  }

  return (
    <div className="guests-container" style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Guests</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {syncing ? <small>Syncing loyalty…</small> : <button className="btn-ghost" onClick={syncLoyaltyMembers}>Sync Loyalty</button>}
          <button className="btn-outline" onClick={startAdd}>New Guest</button>
        </div>
      </header>

      {/* Add/Edit form */}
      {canManage && (
        <form onSubmit={handleSubmit} className="guest-form card" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              <label className="label">Full name *</label>
              <input className="input" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label className="label">Phone *</label>
              <input className="input" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 260px" }}>
              <label className="label">Email</label>
              <input className="input" type="email" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label className="label">KTP Number *</label>
              <input className="input" value={form.ktpNumber} onChange={(e) => setForm((s) => ({ ...s, ktpNumber: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 320px" }}>
              <label className="label">Address *</label>
              <input className="input" value={form.address} onChange={(e) => setForm((s) => ({ ...s, address: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 160px" }}>
              <label className="label">City *</label>
              <input className="input" value={form.city} onChange={(e) => setForm((s) => ({ ...s, city: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 220px" }}>
              <label className="label">Company</label>
              <input className="input" value={form.company} onChange={(e) => setForm((s) => ({ ...s, company: e.target.value }))} />
            </div>

            <div style={{ flex: "1 1 100%" }}>
              <label className="label">Notes</label>
              <textarea className="input" rows={3} value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "flex-end" }}>
            {editId && <button type="button" className="btn-ghost" onClick={cancelEdit}>Cancel</button>}
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? "Saving…" : (editId ? "Update Guest" : "Add Guest")}</button>
          </div>

          {error && <div style={{ color: "crimson", marginTop: 8 }}>{error}</div>}
        </form>
      )}

      {/* Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        <input
          className="input"
          placeholder="Search guests by name, email or phone…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ flex: "1 1 420px" }}
        />
        <div style={{ color: "#6b7280", fontSize: 13 }}>{filteredGuests.length} result{filteredGuests.length !== 1 ? "s" : ""}</div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: "auto" }}>
        {loading ? (
          <div style={{ padding: 20 }}>Loading guests…</div>
        ) : (
          <table className="guests-table" style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
            <thead style={{ background: "#f9fafb", color: "#374151" }}>
              <tr>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Name</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Email</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Phone</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>City</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>KTP</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Company</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Tier</th>
                <th style={{ textAlign: "left", padding: "10px 12px" }}>Benefits</th>
                {canManage && <th style={{ textAlign: "right", padding: "10px 12px" }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filteredGuests.map((g) => (
                <tr key={g.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                  <td style={{ padding: "10px 12px" }}>
                    <Link to={`/guests/${g.id}`} className="link">{g.name || "—"}</Link>
                  </td>
                  <td style={{ padding: "10px 12px" }}>{g.email || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{g.phone || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{g.city || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{g.ktpNumber || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{g.company || "—"}</td>
                  <td style={{ padding: "10px 12px" }}>{g.tier || "classic"}</td>
                  <td style={{ padding: "10px 12px" }}>{(g.benefits && g.benefits.length) ? g.benefits.join(", ") : "—"}</td>
                  {canManage && (
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      <button className="btn-secondary" onClick={() => startEdit(g)} style={{ marginRight: 8 }}>Edit</button>
                      <button className="btn-danger" onClick={() => handleDelete(g.id)}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {filteredGuests.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 9 : 8} style={{ padding: 20, color: "#6b7280" }}>
                    No guests match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
