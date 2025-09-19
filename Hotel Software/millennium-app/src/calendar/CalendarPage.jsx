// src/pages/CalendarPage.jsx
import React, { useEffect, useMemo, useState } from "react";
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
  const [groups, setGroups] = useState([]); // groups visible to the timeline
  const [items, setItems] = useState([]); // items visible to the timeline
  const [allGroupMeta, setAllGroupMeta] = useState([]); // full rooms meta with roomType preserved
  const [collapsedTypes, setCollapsedTypes] = useState(() => new Set()); // room types collapsed
  const [visibleTimeStart, setVisibleTimeStart] = useState(moment().startOf("week").valueOf());
  const [visibleTimeEnd, setVisibleTimeEnd] = useState(moment().startOf("week").add(7, "days").valueOf());

  const navigate = useNavigate();

  // fetch rooms + reservations
  const fetchData = async () => {
    try {
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

      // sort by roomType then number
      roomsRaw.sort((a, b) => {
        const ta = (a.roomType || "").toLowerCase();
        const tb = (b.roomType || "").toLowerCase();
        if (ta < tb) return -1;
        if (ta > tb) return 1;
        const na = Number(String(a.roomNumber).replace(/[^\d-]/g, ""));
        const nb = Number(String(b.roomNumber).replace(/[^\d-]/g, ""));
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
      });

      setAllGroupMeta(roomsRaw);

      // prepare reservation items
      const resSnap = await getDocs(collection(db, "reservations"));
      const dataItems = resSnap.docs.flatMap((d) => {
        const r = d.data();
        if (!r || !r.checkInDate || !r.checkOutDate) return [];
        const status = (r.status || "").toLowerCase();
        if (status === "cancelled" || status === "deleted") return [];

        const toMoment = (v) => (v?.toDate ? moment(v.toDate()) : moment(v));
        let start = toMoment(r.checkInDate).startOf("day");
        let end = toMoment(r.checkOutDate).startOf("day"); // checkOutDay is exclusive in hotel logic

        if (!end.isAfter(start)) end = start.clone().add(1, "day");

        let bg = "#3788d8";
        if (status === "checked-in") bg = "green";
        else if (status === "booked") bg = "blue";
        else if (status === "checked-out") bg = "gray";

        return (r.roomNumbers || []).flatMap((roomNumber) => {
          const gid = String(roomNumber);
          const itemId = `${d.id}-${roomNumber}`;
          return {
            id: itemId,
            group: gid,
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

      setItems(dataItems);
    } catch (err) {
      console.error("CalendarPage.fetchData error:", err);
      setAllGroupMeta([]);
      setGroups([]);
      setItems([]);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // derive the visible groups from allGroupMeta & collapsedTypes
  const derivedGroups = useMemo(() => {
    if (!allGroupMeta || allGroupMeta.length === 0) return [];
    return allGroupMeta
      .filter((g) => !collapsedTypes.has((g.roomType || "").toString()))
      .map((g) => ({ id: g.id, title: g.title }));
  }, [allGroupMeta, collapsedTypes]);

  useEffect(() => {
    setGroups(derivedGroups);
  }, [derivedGroups]);

  // roomTypes list for toggles (unique in order)
  const roomTypes = useMemo(() => {
    const seen = new Set();
    const list = [];
    for (const r of allGroupMeta) {
      const t = (r.roomType || "Unspecified").toString();
      if (!seen.has(t)) {
        seen.add(t);
        list.push(t);
      }
    }
    return list;
  }, [allGroupMeta]);

  const toggleType = (t) => {
    setCollapsedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  // Today highlight
  const todayStart = moment().startOf("day").valueOf();

  // Navigation
  const handlePrevWeek = () => {
    setVisibleTimeStart(moment(visibleTimeStart).subtract(7, "days").valueOf());
    setVisibleTimeEnd(moment(visibleTimeEnd).subtract(7, "days").valueOf());
  };
  const handleNextWeek = () => {
    setVisibleTimeStart(moment(visibleTimeStart).add(7, "days").valueOf());
    setVisibleTimeEnd(moment(visibleTimeEnd).add(7, "days").valueOf());
  };
  const handleToday = () => {
    setVisibleTimeStart(moment().startOf("week").valueOf());
    setVisibleTimeEnd(moment().startOf("week").add(7, "days").valueOf());
  };

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 12 }}>
        <div>
          <button onClick={handlePrevWeek} style={{ marginRight: 8 }}>◀ Prev Week</button>
          <button onClick={handleToday} style={{ marginRight: 8 }}>Today</button>
          <button onClick={handleNextWeek}>Next Week ▶</button>
        </div>

        {/* Room type collapsibles */}
        <div style={{ marginLeft: 16, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ color: "#333" }}>Room types:</strong>
          {roomTypes.map((t) => {
            const collapsed = collapsedTypes.has(t);
            return (
              <button
                key={t}
                onClick={() => toggleType(t)}
                style={{
                  padding: "4px 8px",
                  borderRadius: 6,
                  background: collapsed ? "#f3f4f6" : "#e6f0ff",
                  border: "1px solid #ddd",
                  cursor: "pointer",
                }}
                title={collapsed ? `Expand ${t}` : `Collapse ${t}`}
              >
                {t} {collapsed ? "▸" : "▾"}
              </button>
            );
          })}
        </div>
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
        onItemClick={(itemId) => {
          const [resId] = String(itemId).split("-");
          if (resId) navigate(`/reservations/${resId}`);
        }}
        canMove={false}
        canResize={false}
        stackItems
        itemHeightRatio={0.75}
        lineHeight={40}
        sidebarWidth={180}
        minZoom={7 * 24 * 60 * 60 * 1000}
        maxZoom={7 * 24 * 60 * 60 * 1000}
        dragSnap={24 * 60 * 60 * 1000}
        timeSteps={{ day: 1 }}
      >
        <TimelineMarkers>
          <TodayMarker>
            {({ styles }) => <div style={{ ...styles, backgroundColor: "red", width: 2 }} />}
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
