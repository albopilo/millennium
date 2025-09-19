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
  const linkStyle = {
    color: "#cbd5e1",
    textDecoration: "none",
    whiteSpace: "nowrap",
    display: "flex",
    alignItems: "center",
    gap: "8px",
  };

  // Collapsible states
  const [frontDeskOpen, setFrontDeskOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Load collapse state from localStorage
  useEffect(() => {
    const stored = localStorage.getItem("sidebarCollapsed");
    if (stored !== null) {
      setSidebarCollapsed(stored === "true");
    }
  }, []);

  // Save collapse state to localStorage
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
      {/* Sidebar */}
      <aside
        style={{
          background: "#0f172a",
          color: "#fff",
          padding: "16px 8px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar: title + collapse button */}
        <div
          style={{
            fontWeight: 700,
            marginBottom: 16,
            display: "flex",
            justifyContent: sidebarCollapsed ? "center" : "space-between",
            alignItems: "center",
          }}
        >
          {!sidebarCollapsed && "Millennium Admin"}
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            style={{
              background: "transparent",
              border: "none",
              color: "#cbd5e1",
              cursor: "pointer",
              fontSize: "1rem",
              marginLeft: sidebarCollapsed ? 0 : 8,
            }}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <Layers size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav style={{ display: "grid", gap: 8, flex: 1 }}>
          {can("canManageGuests") && (
            <Link to="/guests" style={linkStyle}>
              <User size={18} />
              {!sidebarCollapsed && "Guests"}
            </Link>
          )}

          {showFrontDesk && (
            <>
              <div
                onClick={() => setFrontDeskOpen(!frontDeskOpen)}
                style={{
                  ...linkStyle,
                  cursor: "pointer",
                  fontWeight: 600,
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                }}
                title="Front Desk"
              >
                <Home size={18} />
                {!sidebarCollapsed && (
                  <>
                    <span>Front Desk</span>
                    <span style={{ fontSize: "0.8em" }}>
                      {frontDeskOpen ? "▲" : "▼"}
                    </span>
                  </>
                )}
              </div>

              {!sidebarCollapsed && frontDeskOpen && (
                <div style={{ display: "grid", gap: 6, paddingLeft: 24 }}>
                  {canReservations && (
                    <>
                      <Link to="/reservations" style={linkStyle}>
                        <ClipboardList size={18} />
                        Add Reservation
                      </Link>
                      <Link to="/calendar" style={linkStyle}>
                        <CalendarDays size={18} />
                        Calendar
                      </Link>
                      <Link to="/frontdesk-checkin" style={linkStyle}>
                        <BedDouble size={18} />
                        Check In
                      </Link>
                      <Link to="/frontdesk-inhouse" style={linkStyle}>
                        <BedDouble size={18} />
                        In-House
                      </Link>
                    </>
                  )}
                  {canHousekeeping && (
                    <Link to="/housekeeping" style={linkStyle}>
                      <Brush size={18} />
                      Housekeeping
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {can("canCreateReservations") && (
            <Link to="/group-booking" style={linkStyle}>
              <Users size={18} />
              {!sidebarCollapsed && "Group Booking"}
            </Link>
          )}

          {can("canManageEvents") && (
            <Link to="/events" style={linkStyle}>
              <CalendarDays size={18} />
              {!sidebarCollapsed && "Events"}
            </Link>
          )}

          {can("canViewMaintenance") && (
            <Link to="/maintenance" style={linkStyle}>
              <Wrench size={18} />
              {!sidebarCollapsed && "Maintenance"}
            </Link>
          )}

          {can("canViewBilling") && (
            <Link to="/reports" style={linkStyle}>
              <FileText size={18} />
              {!sidebarCollapsed && "Reports"}
            </Link>
          )}

          {can("*") && (
            <>
              <Link to="/room-blocks" style={linkStyle}>
                <Blocks size={18} />
                {!sidebarCollapsed && "Room Blocks"}
              </Link>

              {/* Collapsible Admin Settings group */}
              <div
                onClick={() => setAdminOpen(!adminOpen)}
                style={{
                  ...linkStyle,
                  cursor: "pointer",
                  fontWeight: 600,
                  justifyContent: sidebarCollapsed ? "center" : "space-between",
                }}
                title="Admin Settings"
              >
                <Settings size={18} />
                {!sidebarCollapsed && (
                  <>
                    <span>Admin Settings</span>
                    <span style={{ fontSize: "0.8em" }}>
                      {adminOpen ? "▲" : "▼"}
                    </span>
                  </>
                )}
              </div>

              {!sidebarCollapsed && adminOpen && (
                <div style={{ display: "grid", gap: 6, paddingLeft: 24 }}>
                  <Link to="/admin/settings/general" style={linkStyle}>
                    <Cog size={18} />
                    General Settings
                  </Link>
                  <Link to="/admin/settings/print-template" style={linkStyle}>
                    <FileText size={18} />
                    Print Templates
                  </Link>
                </div>
              )}

              <Link to="/cleanup" style={linkStyle}>
                <Trash2 size={18} />
                {!sidebarCollapsed && "Cleanup Guests"}
              </Link>
            </>
          )}
        </nav>

        {/* Logout and user info */}
        <div style={{ marginTop: "10px" }}>
          <LogoutButton />
          {!sidebarCollapsed && currentUser && userData && (
            <div
              style={{
                marginTop: "8px",
                fontSize: "0.85rem",
                color: "#94a3b8",
                lineHeight: 1.4,
              }}
            >
              <div>{userData.displayName || currentUser.email}</div>
              <div style={{ fontStyle: "italic" }}>
                Role: {userData.roleId || "unknown"}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main>
        <header
          style={{
            background: "#fff",
            borderBottom: "1px solid #eee",
            padding: "12px 16px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{title}</h1>
        </header>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
