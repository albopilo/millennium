import { Link } from "react-router-dom";
import { useState } from "react";
import LogoutButton from "./components/LogoutButton";

export default function AppLayout({
  title,
  children,
  permissions = [],
  currentUser,
  userData
}) {
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");
  const linkStyle = { color: "#cbd5e1", textDecoration: "none" };

  // Collapsible states
  const [frontDeskOpen, setFrontDeskOpen] = useState(true);
  const [adminOpen, setAdminOpen] = useState(true);

  // Fine-grained permissions
  const canReservations = can("canViewReservations");
  const canHousekeeping = can("canViewHousekeeping");

  // Show Front Desk group if user can see any of its items
  const showFrontDesk = canReservations || canHousekeeping;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "240px 1fr",
        minHeight: "100vh"
      }}
    >
      <aside style={{ background: "#0f172a", color: "#fff", padding: "16px" }}>
        <div style={{ fontWeight: 700, marginBottom: 16 }}>Millennium Admin</div>

        <nav style={{ display: "grid", gap: 8 }}>
          {can("canManageGuests") && (
            <Link to="/guests" style={linkStyle}>
              Guests
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
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 8
                }}
                title={frontDeskOpen ? "Collapse" : "Expand"}
              >
                Front Desk
                <span style={{ fontSize: "0.8em" }}>
                  {frontDeskOpen ? "▲" : "▼"}
                </span>
              </div>

              {frontDeskOpen && (
                <div style={{ display: "grid", gap: 6, paddingLeft: 12 }}>
                  {canReservations && (
                    <>
                      <Link to="/reservations" style={linkStyle}>
                        Add Reservation
                      </Link>
                      <Link to="/calendar" style={linkStyle}>
                        Calendar
                      </Link>
                      <Link to="/frontdesk-checkin" style={linkStyle}>
                        Check In
                      </Link>
                      <Link to="/frontdesk-inhouse" style={linkStyle}>
                        In-House
                      </Link>
                    </>
                  )}
                  {canHousekeeping && (
                    <Link to="/housekeeping" style={linkStyle}>
                      Housekeeping
                    </Link>
                  )}
                </div>
              )}
            </>
          )}

          {can("canCreateReservations") && (
            <Link to="/group-booking" style={linkStyle}>
              Group Booking
            </Link>
          )}

          {can("canManageEvents") && (
            <Link to="/events" style={linkStyle}>
              Events
            </Link>
          )}

          {can("canViewMaintenance") && (
            <Link to="/maintenance" style={linkStyle}>
              Maintenance
            </Link>
          )}

          {can("canViewBilling") && (
            <Link to="/reports" style={linkStyle}>
              Reports
            </Link>
          )}

          {can("*") && (
            <>
              <Link to="/room-blocks" style={linkStyle}>
                Room Blocks
              </Link>

              {/* Collapsible Admin Settings group */}
              <div
                onClick={() => setAdminOpen(!adminOpen)}
                style={{
                  ...linkStyle,
                  cursor: "pointer",
                  fontWeight: 600,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginTop: 8
                }}
                title={adminOpen ? "Collapse" : "Expand"}
              >
                Admin Settings
                <span style={{ fontSize: "0.8em" }}>
                  {adminOpen ? "▲" : "▼"}
                </span>
              </div>

              {adminOpen && (
                <div style={{ display: "grid", gap: 6, paddingLeft: 12 }}>
                  <Link to="/admin/settings/general" style={linkStyle}>
                    General Settings
                  </Link>
                  <Link to="/admin/settings/print-template" style={linkStyle}>
                    Print Templates
                  </Link>
                </div>
              )}

              <Link to="/cleanup" style={linkStyle}>
                Cleanup Guests
              </Link>
            </>
          )}

          {/* Logout and user info */}
          <div style={{ marginTop: "10px" }}>
            <LogoutButton />
            {currentUser && userData && (
              <div
                style={{
                  marginTop: "8px",
                  fontSize: "0.85rem",
                  color: "#94a3b8",
                  lineHeight: 1.4
                }}
              >
                <div>{userData.displayName || currentUser.email}</div>
                <div style={{ fontStyle: "italic" }}>
                  Role: {userData.roleId || "unknown"}
                </div>
              </div>
            )}
          </div>
        </nav>
      </aside>

      <main>
        <header
          style={{
            background: "#fff",
            borderBottom: "1px solid #eee",
            padding: "12px 16px"
          }}
        >
          <h1 style={{ margin: 0, fontSize: "1.25rem" }}>{title}</h1>
        </header>
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
