import { useEffect, useState, useCallback } from "react";
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDoc,
  setDoc
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "../firebase";

 import { Routes, Route, Link, Navigate } from "react-router-dom";
 import AdminSettingsGeneral from "./AdminSettingsGeneral";
 import AdminPrintTemplate from "./AdminPrintTemplate";

 export default function AdminSettings({ permissions = [], permLoading }) {
   if (permLoading) return <p>Loading permissions…</p>;
   if (!(permissions.includes("*"))) return <p>Access denied</p>;

   return (
     <div className="container">
       <h2 className="mt-0 mb-2">Admin Settings</h2>

       {/* Sidebar / Navigation */}
       <nav style={{ marginBottom: 16 }}>
         <Link to="general" style={{ marginRight: 12 }}>General</Link>
         <Link to="print-templates">Print Templates</Link>
       </nav>

       {/* Nested routes */}
       <Routes>
         <Route path="general" element={<AdminSettingsGeneral permissions={permissions} />} />
         <Route path="print-templates" element={<AdminPrintTemplate permissions={permissions} />} />
         <Route path="*" element={<Navigate to="general" replace />} />
       </Routes>
     </div>
   );
 }