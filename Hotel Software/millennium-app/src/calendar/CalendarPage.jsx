import FullCalendar from "@fullcalendar/react";
import resourceTimelinePlugin from "@fullcalendar/resource-timeline";
import interactionPlugin from "@fullcalendar/interaction";
import { useEffect, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";

export default function CalendarPage({ permissions }) {
  const [rooms, setRooms] = useState([]);
  const [events, setEvents] = useState([]);
  const navigate = useNavigate();

  // Highlight today
  const getTodayHighlight = () => {
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];
    return [{
      start: todayStr,
      end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1),
      display: "background",
      backgroundColor: "#ffe599"
    }];
  };

  const fetchData = async () => {
    // Load rooms
    const roomSnap = await getDocs(collection(db, "rooms"));
    setRooms(
      roomSnap.docs.map(d => ({
        id: d.data().roomNumber,
        title: `${d.data().roomNumber} (${d.data().roomType})`
      }))
    );

    // Load reservations
    const resSnap = await getDocs(collection(db, "reservations"));
    const eventData = resSnap.docs.flatMap(d => {
      const r = d.data();

      // ✅ Skip cancelled or deleted reservations
      if (!r.checkInDate || !r.checkOutDate) return [];
      if (r.status === "cancelled" || r.status === "deleted") return [];

      const start = r.checkInDate?.toDate
        ? r.checkInDate.toDate()
        : new Date(r.checkInDate);
      const end = r.checkOutDate?.toDate
        ? r.checkOutDate.toDate()
        : new Date(r.checkOutDate);

      let bg = "#3788d8";
      if (r.status === "checked-in") bg = "green";
      else if (r.status === "booked") bg = "blue";
      else if (r.status === "checked-out") bg = "gray";

      return (r.roomNumbers || []).map(roomNumber => ({
        id: `${d.id}-${roomNumber}`,
        resourceId: roomNumber,
        title: `${r.guestName || "Unknown"} (${r.status || ""})`,
        start,
        end,
        backgroundColor: bg,
        textColor: "white"
      }));
    });

    // Merge reservation events + today's highlight
    setEvents([...eventData, ...getTodayHighlight()]);
  };

  useEffect(() => {
    fetchData();

    // ✅ Auto-update highlight at midnight
    const now = new Date();
    const msUntilMidnight =
      new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now;

    const midnightTimer = setTimeout(() => {
      setEvents(prevEvents => {
        const nonHighlight = prevEvents.filter(e => e.display !== "background");
        return [...nonHighlight, ...getTodayHighlight()];
      });

      setInterval(() => {
        setEvents(prevEvents => {
          const nonHighlight = prevEvents.filter(e => e.display !== "background");
          return [...nonHighlight, ...getTodayHighlight()];
        });
      }, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);

    return () => clearTimeout(midnightTimer);
  }, []);

  return (
    <FullCalendar
      plugins={[resourceTimelinePlugin, interactionPlugin]}
      initialView="resourceTimelineWeek"
      initialDate={new Date().toISOString().split("T")[0]}
      slotDuration={{ days: 1 }}
      slotLabelFormat={[{ weekday: "short", month: "short", day: "numeric" }]}
      slotMinWidth={100}
      resources={rooms}
      events={events}
      height="auto"
      eventClick={(info) => {
        const [resId] = info.event.id.split("-");
        if (resId) navigate(`/reservations/${resId}`);
      }}
    />
  );
}
