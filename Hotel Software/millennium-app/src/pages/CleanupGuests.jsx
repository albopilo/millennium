import { collection, getDocs, doc, writeBatch } from "firebase/firestore";
import { db } from "../firebase";

export default function CleanupGuests() {
  const handleCleanup = async () => {
    const snap = await getDocs(collection(db, "guests"));
    const guests = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const seen = new Set();
    const duplicates = [];

    for (const g of guests) {
      const key = (g.email || g.phone || "").trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) {
        duplicates.push(g.id);
      } else {
        seen.add(key);
      }
    }

    if (!duplicates.length) {
      alert("No duplicates found");
      return;
    }

    const batch = writeBatch(db);
    duplicates.forEach(id => {
      batch.delete(doc(db, "guests", id));
    });
    await batch.commit();

    alert(`Deleted ${duplicates.length} duplicate guests`);
  };

  return (
    <div style={{ padding: 16 }}>
      <h2>Cleanup Guests</h2>
      <button onClick={handleCleanup}>Remove Duplicate Guests</button>
    </div>
  );
}