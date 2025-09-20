// src/AppLayout.jsx
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import LogoutButton from "./components/LogoutButton";

// Lucide icons
import {
  Users,
  User,
  CalendarDays,
  ClipboardList,
  Home,
  BedDouble,
  Brush,
  Wrench,
  FileText,
  Blocks,
  Settings,
  Cog,
  Trash2,
  Layers,
} from "lucide-react";

export default function AppLayout({
  title,
  children,
  permissions = [],
  currentUser,
  userData,
}) {
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");
  const linkStyleBase = {
    color: "#cbd5e1",
    textDecoration: "none",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 8px",
    borderRadius: 6,
  };

  // Collapsible states
  const [frontDeskOpen, setFrontDeskOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("sidebarCollapsed");
    if (stored !== null) setSidebarCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  const canReservations = can("canViewReservations");
  const canHousekeeping = can("canViewHousekeeping");
  const showFrontDesk = canReservations || canHousekeeping;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: sidebarCollapsed ? "60px 1fr" : "240px 1fr",
        minHeight: "100vh",
      }}
    >
      <aside
        style={{
          background: "#0f172a",
          color: "#fff",
          padding: sidebarCollapsed ? "12px 6px" : "16px 12px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar: title + collapse button */}
        <div
          style={{
            fontWeight: 700,
            marginBottom: 8,
            display: "flex",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            alignItems: "center",
          }}
        >
          {!sidebarCollapsed && <div>Millennium Admin</div>}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              background: "transparent",
              border: "none",
              color: "#cbd5e1",
              cursor: "pointer",
              padding: 6,
            }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Layers size={18} />
          </button>
        </div>

        {/* Navigation: use column flex, no big gap between items */}
        <nav style={{ display: "flex", flexDirection: "column", gap: 0, flex: 1 }}>
          {can("canManageGuests") && (
            <Link to="/guests" style={linkStyleBase}>
              <User size={18} />
              {!sidebarCollapsed && <span>Guests</span>}
            </Link>
          )}

          {showFrontDesk && (
            <>
              <div
                onClick={() => setFrontDeskOpen(!frontDeskOpen)}
                style={{
                  ...linkStyleBase,
                  cursor: "pointer",
                  fontWeight: 600,
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                }}
                title="Front Desk"
              >
                <Home size={18} />
                {!sidebarCollapsed && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Front Desk</span>
                    <span style={{ fontSize: "0.8em" }}>{frontDeskOpen ? "▲" : "▼"}</span>
                  </div>
                )}
              </div>

              {!sidebarCollapsed && frontDeskOpen && (
                <div style={{ display: "flex", flexDirection: "column", paddingLeft: 8 }}>
                  {canReservations && (
                    <>
                      <Link to="/reservations" style={linkStyleBase}>
                        <ClipboardList size={18} />
                        <span>Add Reservation</span>
                      </Link>
                      <Link to="/calendar" style={linkStyleBase}>
                        <CalendarDays size={18} />
                        <span>Calendar</span>
                      </Link>
                      <Link to="/frontdesk-checkin" style={linkStyleBase}>
                        <BedDouble size={18} />
                        <span>Check In</span>
                      </Link>
                      <Link to="/frontdesk-inhouse" style={linkStyleBase}>
                        <BedDouble size={18} />
                        <span>In-House</span>
                      </Link>
                    </>
                  )}
                  {canHousekeeping && (
                    <Link to="/housekeeping" style={linkStyleBase}>
                      <Brush size={18} />
                      <span>Housekeeping</span>
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {can("canCreateReservations") && (
            <Link to="/group-booking" style={linkStyleBase}>
              <Users size={18} />
              {!sidebarCollapsed && <span>Group Booking</span>}
            </Link>
          )}

          {can("canManageEvents") && (
            <Link to="/events" style={linkStyleBase}>
              <CalendarDays size={18} />
              {!sidebarCollapsed && <span>Events</span>}
            </Link>
          )}

          {can("canViewMaintenance") && (
            <Link to="/maintenance" style={linkStyleBase}>
              <Wrench size={18} />
              {!sidebarCollapsed && <span>Maintenance</span>}
            </Link>
          )}

          {can("canViewBilling") && (
            <Link to="/reports" style={linkStyleBase}>
              <FileText size={18} />
              {!sidebarCollapsed && <span>Reports</span>}
            </Link>
          )}

          { (can("*") || can("canManageSettings")) && (
            <>
              <Link to="/room-blocks" style={linkStyleBase}>
                <Blocks size={18} />
                {!sidebarCollapsed && <span>Room Blocks</span>}
              </Link>

              <div
                onClick={() => setAdminOpen(!adminOpen)}
                style={{
                  ...linkStyleBase,
                  cursor: "pointer",
                  fontWeight: 600,
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                }}
                title="Admin Settings"
              >
                <Settings size={18} />
                {!sidebarCollapsed && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>Admin Settings</span>
                    <span style={{ fontSize: "0.8em" }}>{adminOpen ? "▲" : "▼"}</span>
                  </div>
                )}
              </div>

              {!sidebarCollapsed && adminOpen && (
                <div style={{ display: "flex", flexDirection: "column", paddingLeft: 8 }}>
                  <Link to="/admin/settings/general" style={linkStyleBase}>
                    <Cog size={18} />
                    <span>General Settings</span>
                  </Link>
                  <Link to="/admin/settings/print-template" style={linkStyleBase}>
                    <FileText size={18} />
                    <span>Print Templates</span>
                  </Link>
                </div>
              )}

              <Link to="/cleanup" style={linkStyleBase}>
                <Trash2 size={18} />
                {!sidebarCollapsed && <span>Cleanup Guests</span>}
              </Link>
            </>
          )}
        </nav>

        <div style={{ marginTop: 10 }}>
          <LogoutButton />
          {!sidebarCollapsed && currentUser && userData && (
            <div style={{ marginTop: 8, fontSize: "0.85rem", color: "#94a3b8", lineHeight: 1.4 }}>
              <div>{userData.displayName || currentUser.email}</div>
              <div style={{ fontStyle: "italic" }}>Role: {userData.roleId || "unknown"}</div>
            </div>
          )}
        </div>
      </aside>

      <main>
        <header style={{ background: "#fff", borderBottom: "1px solid #eee", padding: "12px 16px" }}>
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{title}</h1>
        </header>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
