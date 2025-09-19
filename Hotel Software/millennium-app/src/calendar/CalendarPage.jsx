// src/pages/CalendarPage.jsx
import React, { useEffect, useState } from "react";
import Timeline, {
  TimelineMarkers,
  TodayMarker,
  CustomMarker,
} from "react-calendar-timeline";
import moment from "moment";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../firebase";
import { useNavigate } from "react-router-dom";
import "react-calendar-timeline/dist/style.css";

export default function CalendarPage({ permissions }) {
  const [groups, setGroups] = useState([]); // Rooms
  const [items, setItems] = useState([]); // Reservations
  const [visibleTimeStart, setVisibleTimeStart] = useState(
    moment().startOf("week").valueOf()
  );
  const [visibleTimeEnd, setVisibleTimeEnd] = useState(
    moment().startOf("week").add(7, "days").valueOf()
  );

  const navigate = useNavigate();

  const fetchData = async () => {
    // Load rooms
    const roomSnap = await getDocs(collection(db, "rooms"));
    const rooms = roomSnap.docs.map((d) => {
      const r = d.data();
      return {
        id: String(r.roomNumber),
        title: `${r.roomNumber} (${r.roomType})`,
      };
    });
    const groupIds = new Set(rooms.map((g) => g.id));

    // Load reservations
    const resSnap = await getDocs(collection(db, "reservations"));
    const dataItems = resSnap.docs.flatMap((d) => {
      const r = d.data();
      if (!r.checkInDate || !r.checkOutDate) return [];
      if (r.status === "cancelled" || r.status === "deleted") return [];

      const toMoment = (v) => (v?.toDate ? moment(v.toDate()) : moment(v));

      let start = toMoment(r.checkInDate).startOf("day");
      let end = toMoment(r.checkOutDate).startOf("day");

      if (!end.isAfter(start)) {
        end = start.clone().add(1, "day");
      }

      let bg = "#3788d8";
      if (r.status === "checked-in") bg = "green";
      else if (r.status === "booked") bg = "blue";
      else if (r.status === "checked-out") bg = "gray";

      return (r.roomNumbers || []).flatMap((roomNumber) => {
        const groupId = String(roomNumber);
        if (!groupIds.has(groupId)) return [];

        const itemId = `${d.id}-${roomNumber}`;

        return [
          {
            id: itemId,
            group: groupId,
            title: `${r.guestName || "Unknown"} (${r.status || ""})`,
            start_time: start.valueOf(),
            end_time: end.valueOf(),
            itemProps: {
              style: {
                background: bg,
                color: "white",
                borderRadius: 4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
              onClick: () => {
                const [resId] = itemId.split("-");
                if (resId) navigate(`/reservations/${resId}`);
              },
            },
          },
        ];
      });
    });

    setGroups(rooms);
    setItems(dataItems);
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Today highlight
  const todayStart = moment().startOf("day").valueOf();

  // Navigation handlers
  const handlePrevWeek = () => {
    const newStart = moment(visibleTimeStart).subtract(7, "days").valueOf();
    const newEnd = moment(visibleTimeEnd).subtract(7, "days").valueOf();
    setVisibleTimeStart(newStart);
    setVisibleTimeEnd(newEnd);
  };

  const handleNextWeek = () => {
    const newStart = moment(visibleTimeStart).add(7, "days").valueOf();
    const newEnd = moment(visibleTimeEnd).add(7, "days").valueOf();
    setVisibleTimeStart(newStart);
    setVisibleTimeEnd(newEnd);
  };

  const handleToday = () => {
    const newStart = moment().startOf("week").valueOf();
    const newEnd = moment().startOf("week").add(7, "days").valueOf();
    setVisibleTimeStart(newStart);
    setVisibleTimeEnd(newEnd);
  };

  useEffect(() => {
  // Always reset to current week when page is mounted
  const newStart = moment().startOf("week").valueOf();
  const newEnd = moment().startOf("week").add(7, "days").valueOf();
  setVisibleTimeStart(newStart);
  setVisibleTimeEnd(newEnd);
}, []); 

  return (
    <div style={{ padding: 8 }}>
      {/* Navigation buttons */}
      <div style={{ marginBottom: 8 }}>
        <button onClick={handlePrevWeek} style={{ marginRight: 8 }}>
          ◀ Prev Week
        </button>
        <button onClick={handleToday} style={{ marginRight: 8 }}>
          Today
        </button>
        <button onClick={handleNextWeek}>Next Week ▶</button>
      </div>

      <Timeline
        groups={groups}
        items={items}
        visibleTimeStart={visibleTimeStart}
        visibleTimeEnd={visibleTimeEnd}
        onTimeChange={(start, end) => {
          setVisibleTimeStart(start);
          setVisibleTimeEnd(end);
        }}
        canMove={false}
        canResize={false}
        stackItems
        itemHeightRatio={0.75}
        lineHeight={60}
        sidebarWidth={150}
        minZoom={7 * 24 * 60 * 60 * 1000} // 7 days
        maxZoom={7 * 24 * 60 * 60 * 1000} // 7 days
        dragSnap={24 * 60 * 60 * 1000}
        timeSteps={{ day: 1 }}
      >
        <TimelineMarkers>
          <TodayMarker>
            {({ styles }) => (
              <div
                style={{
                  ...styles,
                  backgroundColor: "red",
                  width: "2px",
                }}
              />
            )}
          </TodayMarker>

          <CustomMarker date={todayStart}>
            {({ styles }) => (
              <div
                style={{
                  ...styles,
                  backgroundColor: "rgba(255, 229, 153, 0.3)",
                  zIndex: -1,
                  height: "100%",
                  pointerEvents: "none",
                }}
              />
            )}
          </CustomMarker>
        </TimelineMarkers>
      </Timeline>
    </div>
  );
}
