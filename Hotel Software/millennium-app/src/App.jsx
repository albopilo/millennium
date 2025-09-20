// src/App.jsx
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, getIdTokenResult } from "firebase/auth";
import { auth, db } from "./firebase";
import { doc, getDoc } from "firebase/firestore";

import AppLayout from "./AppLayout";
import Dashboard from "./pages/Dashboard";
import Reservations from "./pages/Reservations";
import ReservationDetail from "./pages/ReservationDetail";
import ReservationDetailA from "./pages/ReservationDetailA";
import ReservationDetailB from "./pages/ReservationDetailB";
import ReservationDetailC from "./pages/ReservationDetailC";
import CalendarPage from "./calendar/CalendarPage";
import Guests from "./pages/GuestPage";
import Events from "./pages/Events";
import AdminSettings from "./admin/AdminSettings";
import CleanupGuests from "./pages/CleanupGuests";
import GroupBooking from "./pages/GroupBooking";
import Login from "./pages/Login";
import FrontDeskCheckIn from "./pages/FrontDeskCheckIn";
import FrontDeskInHouse from "./pages/FrontDeskInHouse";
import GuestDetail from "./pages/GuestDetail";
import NightAudit from "./pages/NightAudit";
import AdminSettingsGeneral from "./admin/AdminSettingsGeneral";
import AdminPrintTemplate from "./admin/AdminPrintTemplate";

// New pages
import Housekeeping from "./pages/Housekeeping";
import Maintenance from "./pages/Maintenance";
import Billing from "./pages/Billing";
import RoomBlocks from "./pages/RoomBlocks";
import Reports from "./pages/Reports";

export default function App() {
  const [permissions, setPermissions] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);

        // Get token claims (may contain permissions pushed from backend)
        const token = await getIdTokenResult(user);
        const tokenPermissions = token?.claims?.permissions || [];

        try {
          // 🔹 Load user info from Firestore
          const userRef = doc(db, "users", user.uid);
          const userSnap = await getDoc(userRef);

          if (userSnap.exists()) {
            const uData = userSnap.data();
            setUserData(uData);

            if (uData.roleId) {
              try {
                // 🔹 Load role permissions
                const roleRef = doc(db, "roles", uData.roleId);
                const roleSnap = await getDoc(roleRef);

                if (roleSnap.exists()) {
                  const roleData = roleSnap.data();
                  setPermissions(
                    Array.isArray(roleData.permissions)
                      ? roleData.permissions
                      : tokenPermissions
                  );
                } else {
                  console.warn(
                    `Role document "${uData.roleId}" not found in roles collection.`
                  );
                  setPermissions(
                    Array.isArray(tokenPermissions) ? tokenPermissions : []
                  );
                }
              } catch (roleErr) {
                console.error("Failed to load role document:", roleErr);
                setPermissions(
                  Array.isArray(tokenPermissions) ? tokenPermissions : []
                );
              }
            } else {
              // No roleId on user record: use token permissions
              setPermissions(
                Array.isArray(tokenPermissions) ? tokenPermissions : []
              );
            }
          } else {
            // No user doc: clear userData and fallback to token permissions
            setUserData(null);
            setPermissions(
              Array.isArray(tokenPermissions) ? tokenPermissions : []
            );
          }
        } catch (err) {
          console.error("Failed to load user data:", err);
          setUserData(null);
          setPermissions(Array.isArray(tokenPermissions) ? tokenPermissions : []);
        }
      } else {
        setCurrentUser(null);
        setUserData(null);
        setPermissions([]);
      }
    });

    return () => unsub();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <AppLayout
              title="Dashboard"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Dashboard
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route path="/login" element={<Login />} />
        <Route
          path="/night-audit"
          element={
            <NightAudit currentUser={currentUser} permissions={permissions} />
          }
        />
        <Route path="/reservationdetailA" element={<ReservationDetailA />} />
        <Route path="/reservationdetailB" element={<ReservationDetailB />} />
        <Route path="/reservationdetailC" element={<ReservationDetailC />} />
        <Route
          path="/reservations"
          element={
            <AppLayout
              title="Reservations"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Reservations
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/group-booking"
          element={
            <AppLayout
              title="Group Booking"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <GroupBooking
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/reservations/:id"
          element={
            <AppLayout
              title="Reservation Detail"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <ReservationDetail
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/calendar"
          element={
            <AppLayout
              title="Calendar"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <CalendarPage
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/frontdesk-checkin"
          element={
            <AppLayout
              title="Check In"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <FrontDeskCheckIn
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/frontdesk-inhouse"
          element={
            <AppLayout
              title="In-House"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <FrontDeskInHouse
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/guests"
          element={
            <AppLayout
              title="Guests"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Guests
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route path="/guests/:id" element={<GuestDetail />} />
        <Route
          path="/events"
          element={
            <AppLayout
              title="Events"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Events
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/admin"
          element={
            <AppLayout
              title="Admin Settings"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <AdminSettings
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/admin/settings/general"
          element={
            <AppLayout
              title="General Settings"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <AdminSettingsGeneral permissions={permissions} permLoading={false} />
            </AppLayout>
          }
        />
        <Route
          path="/admin/settings/print-template"
          element={
            <AppLayout
              title="Print Templates"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <AdminPrintTemplate permissions={permissions} />
            </AppLayout>
          }
        />
        <Route
          path="/cleanup"
          element={
            <AppLayout
              title="Cleanup Guests"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <CleanupGuests
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        {/* New feature routes */}
        <Route
          path="/housekeeping"
          element={
            <AppLayout
              title="Housekeeping"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Housekeeping
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/maintenance"
          element={
            <AppLayout
              title="Maintenance"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Maintenance
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/billing/:reservationId"
          element={
            <AppLayout
              title="Billing"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Billing
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/room-blocks"
          element={
            <AppLayout
              title="Room Blocks"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <RoomBlocks
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
        <Route
          path="/reports"
          element={
            <AppLayout
              title="Reports"
              permissions={permissions}
              currentUser={currentUser}
              userData={userData}
            >
              <Reports
                permissions={permissions}
                currentUser={currentUser}
                userData={userData}
              />
            </AppLayout>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
