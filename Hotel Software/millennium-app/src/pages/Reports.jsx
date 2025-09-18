import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";

export default function Reports({ permissions = [] }) {
  const [occupancy, setOccupancy] = useState({ today: 0, rooms: 0, occupied: 0 });
  const [channelRevenue, setChannelRevenue] = useState([]);

  useEffect(() => {
    (async () => {
      const roomSnap = await getDocs(collection(db, "rooms"));
      const rooms = roomSnap.docs.map(d => d.data());
      const totalRooms = rooms.length;

      const resSnap = await getDocs(collection(db, "reservations"));
      const reservations = resSnap.docs.map(d => d.data());

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(today.getDate() + 1);

      const occupied = reservations
        .filter(r => {
          const start = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
          const end = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
          return r.status !== "cancelled" && start < tomorrow && end > today;
        })
        .reduce((count, r) => count + (r.roomNumbers?.length || 1), 0);

      setOccupancy({
        today: Math.round((occupied / Math.max(totalRooms, 1)) * 100),
        rooms: totalRooms,
        occupied
      });

      const byChannel = {};
      for (const r of reservations) {
        if (r.status === "cancelled") continue;
        byChannel[r.channel || "unknown"] =
          (byChannel[r.channel || "unknown"] || 0) + Number(r.rate || 0);
      }
      setChannelRevenue(
        Object.entries(byChannel).map(([k, v]) => ({ channel: k, revenue: v }))
      );
    })();
  }, []);

  return (
    <div style={{ padding: 16, display: "grid", gap: 16 }}>
      <div className="card" style={{ padding: 12 }}>
        <h3>Occupancy Today</h3>
        <div>
          <strong>{occupancy.today}%</strong> occupied ({occupancy.occupied}/{occupancy.rooms} rooms)
        </div>
      </div>
      <div className="card" style={{ padding: 12 }}>
        <h3>Revenue by Channel</h3>
        <table className="table" style={{ width: "100%" }}>
          <thead>
            <tr><th>Channel</th><th>Revenue</th></tr>
          </thead>
          <tbody>
            {channelRevenue.map((c) => (
              <tr key={c.channel}>
                <td>{c.channel}</td>
                <td>{c.revenue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}