// src/pages/Housekeeping.jsx
import { useEffect, useState } from "react";
import {
  collection,
  getDocs,
  updateDoc,
  doc,
  query,
  where,
  addDoc
} from "firebase/firestore";
import { db } from "../firebase";
import { todayStr } from "../lib/dates";

export default function Housekeeping({ permissions = [], currentUser = null }) {
  const can = (p) => permissions.includes(p) || permissions.includes("*");
  const actor = currentUser?.id || currentUser?.email || "frontdesk";

  const [rooms, setRooms] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all"); // all | pending | in-progress | done

  const load = async () => {
    const rSnap = await getDocs(collection(db, "rooms"));
    setRooms(rSnap.docs.map(d => d.data()));

    const qTasks = query(
      collection(db, "hk_tasks"),
      where("date", "==", todayStr())
    );
    const tSnap = await getDocs(qTasks);
    setTasks(tSnap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => { load(); }, []);

  const markStart = async (task) => {
    if (!can("canManageHousekeeping")) return;
    await updateDoc(doc(db, "hk_tasks", task.id), {
      status: "in-progress",
      startedAt: new Date(),
      startedBy: actor
    });
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: "in-progress" } : t));
  };

  const markDone = async (task) => {
    if (!can("canManageHousekeeping")) return;
    await updateDoc(doc(db, "hk_tasks", task.id), {
      status: "done",
      completedAt: new Date(),
      completedBy: actor
    });
    await updateDoc(doc(db, "rooms", task.roomNumber), { status: "Vacant Clean" });
    setTasks(ts => ts.map(t => t.id === task.id ? { ...t, status: "done" } : t));
  };

  const ensureDailyTasks = async () => {
    if (!can("canManageHousekeeping")) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const todayISO = today.toISOString().split("T")[0];

    // Get all reservations to find rooms occupied yesterday
    const resSnap = await getDocs(collection(db, "reservations"));
    const reservations = resSnap.docs.map(d => d.data());

    const occupiedYesterdayRooms = new Set();
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      const checkIn = r.checkInDate?.toDate ? r.checkInDate.toDate() : new Date(r.checkInDate);
      const checkOut = r.checkOutDate?.toDate ? r.checkOutDate.toDate() : new Date(r.checkOutDate);
      if (checkIn < today && checkOut > yesterday) {
        (r.roomNumbers || [r.roomNumber]).forEach(num => { if (num) occupiedYesterdayRooms.add(num); });
      }
    }

    // Create/complete tasks for rooms (skip OOO)
    for (const rm of rooms.filter(r => r.status !== "OOO")) {
      const existing = tasks.find(t => t.roomNumber === rm.roomNumber);
      if (occupiedYesterdayRooms.has(rm.roomNumber)) {
        if (!existing) {
          await addDoc(collection(db, "hk_tasks"), {
            roomNumber: rm.roomNumber,
            date: todayISO,
            type: "clean",
            status: "pending",
            createdAt: new Date(),
            createdBy: actor
          });
        }
      } else {
        if (!existing) {
          await addDoc(collection(db, "hk_tasks"), {
            roomNumber: rm.roomNumber,
            date: todayISO,
            type: "clean",
            status: "done",
            createdAt: new Date(),
            createdBy: actor
          });
          await updateDoc(doc(db, "rooms", rm.roomNumber), { status: "Vacant Clean" });
        } else if (existing.status !== "done") {
          await updateDoc(doc(db, "hk_tasks", existing.id), { status: "done" });
          await updateDoc(doc(db, "rooms", rm.roomNumber), { status: "Vacant Clean" });
        }
      }
    }

    window.alert("Daily tasks ensured.");
    await load();
  };

  const visibleTasks = tasks.filter(t => {
    if (statusFilter === "all") return true;
    return t.status === statusFilter;
    });

  return (
    <div className="reservations-container">
      <h2>Housekeeping</h2>

      <div className="reservation-form" style={{ marginBottom: 12 }}>
        <label>Filter</label>
        <div className="form-actions" style={{ gap: 6 }}>
          <button className="btn-primary" onClick={() => setStatusFilter("all")}>All</button>
          <button onClick={() => setStatusFilter("pending")}>Pending</button>
          <button onClick={() => setStatusFilter("in-progress")}>In‑Progress</button>
          <button onClick={() => setStatusFilter("done")}>Done</button>
        </div>

        <div className="form-actions">
          <button
            className="btn-primary"
            onClick={ensureDailyTasks}
            disabled={!can("canManageHousekeeping")}
          >
            Generate Today’s Tasks
          </button>
        </div>
      </div>

      <table className="reservations-table">
        <thead>
          <tr>
            <th>Room</th>
            <th>Task</th>
            <th>Status</th>
            {can("canManageHousekeeping") && <th>Action</th>}
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map(t => (
            <tr key={t.id} className={t.status === "done" ? "row-even" : "row-odd"}>
              <td>{t.roomNumber}</td>
              <td>{t.type}</td>
              <td>{t.status}</td>
              {can("canManageHousekeeping") && (
                <td>
                  {t.status === "pending" && (
                    <button className="btn-primary" onClick={() => markStart(t)}>Start</button>
                  )}
                  {t.status !== "done" && (
                    <button className="btn-primary" style={{ marginLeft: 6 }} onClick={() => markDone(t)}>
                      Mark Done
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}