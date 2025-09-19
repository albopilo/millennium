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
  const [groups, setGroups] = useState([]); // Rooms (groups for timeline)
  const [items, setItems] = useState([]); // Reservations (items for timeline)
  const [visibleTimeStart, setVisibleTimeStart] = useState(
    moment().startOf("week").valueOf()
  );
  const [visibleTimeEnd, setVisibleTimeEnd] = useState(
    moment().startOf("week").add(7, "days").valueOf()
  );

  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      // Load rooms and keep roomType for sorting
      const roomSnap = await getDocs(collection(db, "rooms"));
      const roomsRaw = roomSnap.docs.map((d) => {
        const r = d.data() || {};
        return {
          id: String(r.roomNumber),
          roomNumber: r.roomNumber,
          roomType: (r.roomType || "").toString(),
          title: `${r.roomNumber} (${r.roomType || ""})`,
        };
      });

      // Sort by roomType (asc, case-insensitive) then by numeric roomNumber if possible
      roomsRaw.sort((a, b) => {
        const ta = (a.roomType || "").toLowerCase();
        const tb = (b.roomType || "").toLowerCase();
        if (ta < tb) return -1;
        if (ta > tb) return 1;

        // try numeric compare on roomNumber; fallback to localeCompare
        const na = Number(String(a.roomNumber).replace(/[^\d-]/g, ""));
        const nb = Number(String(b.roomNumber).replace(/[^\d-]/g, ""));
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
          return na - nb;
        }
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
      });

      const groupsPrepared = roomsRaw.map((r) => ({ id: r.id, title: r.title }));
      const groupIds = new Set(groupsPrepared.map((g) => g.id));

      // Load reservations
      const resSnap = await getDocs(collection(db, "reservations"));
      const dataItems = resSnap.docs.flatMap((d) => {
        const r = d.data();
        if (!r || !r.checkInDate || !r.checkOutDate) return [];
        const status = (r.status || "").toLowerCase();
        if (status === "cancelled" || status === "deleted") return [];

        const toMoment = (v) => (v?.toDate ? moment(v.toDate()) : moment(v));

        let start = toMoment(r.checkInDate).startOf("day");
        let end = toMoment(r.checkOutDate).startOf("day");
        if (!end.isAfter(start)) {
          end = start.clone().add(1, "day");
        }

        let bg = "#3788d8";
        if (status === "checked-in") bg = "green";
        else if (status === "booked") bg = "blue";
        else if (status === "checked-out") bg = "gray";

        return (r.roomNumbers || []).flatMap((roomNumber) => {
          const groupId = String(roomNumber);
          if (!groupIds.has(groupId)) return [];

          const itemId = `${d.id}-${roomNumber}`;
          return {
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
                fontSize: 12,
                paddingLeft: 6,
                paddingRight: 6,
              },
            },
          };
        });
      });

      setGroups(groupsPrepared);
      setItems(dataItems);
    } catch (err) {
      console.error("CalendarPage.fetchData error:", err);
      setGroups([]);
      setItems([]);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        // make items clickable (central handler)
        onItemClick={(itemId, e, time) => {
          const [resId] = String(itemId).split("-");
          if (resId) navigate(`/reservations/${resId}`);
        }}
        canMove={false}
        canResize={false}
        stackItems
        // Compact rows
        itemHeightRatio={0.75}
        lineHeight={40}
        sidebarWidth={180}
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
