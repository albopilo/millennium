// src/pages/CalendarPage.jsx
import React, { useEffect, useState } from "react";
import Timeline, { TimelineMarkers, TodayMarker, CustomMarker } from "react-calendar-timeline";
import moment from "moment";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";
import "react-calendar-timeline/dist/style.css";

export default function CalendarPage({ permissions }) {
  const [groups, setGroups] = useState([]); // Rooms
  const [items, setItems] = useState([]);   // Reservations
  const navigate = useNavigate();

  const fetchData = async () => {
    // Load rooms
    const roomSnap = await getDocs(collection(db, "rooms"));
    const rooms = roomSnap.docs.map(d => {
      const r = d.data();
      return {
        id: r.roomNumber,
        title: `${r.roomNumber} (${r.roomType})`
      };
    });

    // Load reservations
    const resSnap = await getDocs(collection(db, "reservations"));
    const dataItems = resSnap.docs.flatMap(d => {
      const r = d.data();
      if (!r.checkInDate || !r.checkOutDate) return [];
      if (r.status === "cancelled" || r.status === "deleted") return [];

      const start = r.checkInDate?.toDate
        ? moment(r.checkInDate.toDate())
        : moment(r.checkInDate);
      const end = r.checkOutDate?.toDate
        ? moment(r.checkOutDate.toDate())
        : moment(r.checkOutDate);

      let bg = "#3788d8";
      if (r.status === "checked-in") bg = "green";
      else if (r.status === "booked") bg = "blue";
      else if (r.status === "checked-out") bg = "gray";

      return (r.roomNumbers || []).map(roomNumber => ({
        id: `${d.id}-${roomNumber}`,
        group: roomNumber,
        title: `${r.guestName || "Unknown"} (${r.status || ""})`,
        start_time: start.valueOf(),
        end_time: end.valueOf(),
        itemProps: {
          style: {
            background: bg,
            color: "white",
            borderRadius: 4
          },
          onClick: () => {
            const [resId] = `${d.id}-${roomNumber}`.split("-");
            if (resId) navigate(`/reservations/${resId}`);
          }
        }
      }));
    });

    setGroups(rooms);
    setItems(dataItems);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Show current week as default window
  const defaultTimeStart = moment().startOf("week");
  const defaultTimeEnd = moment().endOf("week");

  // Today highlight: yellow background strip
  const todayStart = moment().startOf("day");
  const todayEnd = moment().endOf("day");

  return (
    <div style={{ padding: 8 }}>
      <Timeline
        groups={groups}
        items={items}
        defaultTimeStart={defaultTimeStart}
        defaultTimeEnd={defaultTimeEnd}
        canMove={false}
        canResize={false}
        stackItems
        itemHeightRatio={0.75}
        lineHeight={60}
        sidebarWidth={150}
      >
        <TimelineMarkers>
          {/* Vertical line for current time */}
          <TodayMarker>
            {({ styles }) => (
              <div
                style={{
                  ...styles,
                  backgroundColor: "red",
                  width: "2px"
                }}
              />
            )}
          </TodayMarker>

          {/* Yellow background for today */}
          <CustomMarker date={todayStart}>
            {({ styles }) => (
              <div
                style={{
                  ...styles,
                  left: 0,
                  width: "100%",
                  backgroundColor: "rgba(255, 229, 153, 0.3)",
                  zIndex: -1,
                  height: "100%",
                  pointerEvents: "none"
                }}
              />
            )}
          </CustomMarker>
        </TimelineMarkers>
      </Timeline>
    </div>
  );
}
