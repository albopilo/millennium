import { Link } from "react-router-dom";

export default function NavMenu({ permissions }) {
  const can = (perm) => permissions.includes(perm) || permissions.includes("*");

  return (
    <nav>
      <ul>
        {can("canManageGuests") && <li><Link to="/guests">Guests</Link></li>}
        {can("canViewReservations") && <li><Link to="/reservations">Reservations</Link></li>}
        {can("canManageEvents") && <li><Link to="/events">Manage Events</Link></li>}
        {can("*") && (
          <>
            <li><Link to="/admin">Admin Settings</Link></li>
            <li><Link to="/cleanup">Cleanup Guests</Link></li>
          </>
        )}
        <li style={{ marginTop: "10px" }}>
          <button onClick={() => window.location.reload()}>Logout</button>
        </li>
      </ul>
    </nav>
  );
}