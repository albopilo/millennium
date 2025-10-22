// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css"; // reuse some styles, or create admin-specific css

export default function AdminPrintTemplate({ permissions = [] }) {
  const [activeTab, setActiveTab] = useState("checkIn");
  const [loading, setLoading] = useState(false);
  const [templateData, setTemplateData] = useState({
    checkInTemplate: { header: "MILLENNIUM INN", body: "<p>Welcome {{guestName}} to Millennium Inn.<br/>Your room number is {{roomNumber}}.</p>", footer: "<p>Signature: ______________________</p>" },
    checkOutTemplate: { header: "MILLENNIUM INN", body: "<p>Thank you {{guestName}} for staying with us. Balance: {{balance}}</p>", footer: "<p>Signature: ______________________</p>" }
  });

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (snap.exists() && mounted) {
          setTemplateData({
            checkInTemplate: snap.data().checkInTemplate || templateData.checkInTemplate,
            checkOutTemplate: snap.data().checkOutTemplate || templateData.checkOutTemplate
          });
        }
      } catch (err) {
        console.error("AdminPrintTemplate load error", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    try {
      setLoading(true);
      await setDoc(doc(db, "admin_print_templates", "default"), templateData, { merge: true });
      alert("Templates saved");
    } catch (err) {
      console.error("save template error", err);
      alert("Failed to save template");
    } finally {
      setLoading(false);
    }
  };

  const curTpl = activeTab === "checkIn" ? templateData.checkInTemplate : templateData.checkOutTemplate;
  return (
    <div className="reservation-detail-container card">
      <div className="card-header">
        <h3>Print Templates</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${activeTab === "checkIn" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkIn")}>Check-In</button>
          <button className={`btn ${activeTab === "checkOut" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkOut")}>Check-Out</button>
        </div>
      </div>

      <div className="card-body">
        <div style={{ marginBottom: 12 }}>
          <label>Header</label>
          <input value={curTpl.header} onChange={(e) => setTemplateData({ ...templateData, [activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate"]: { ...curTpl, header: e.target.value }})} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Body (HTML allowed). Use placeholders: {{guestName}}, {{roomNumber}}, {{checkInDate}}, {{checkOutDate}}, {{balance}}, {{staffName}}</label>
          <textarea rows={8} value={curTpl.body} onChange={(e) => setTemplateData({ ...templateData, [activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate"]: { ...curTpl, body: e.target.value }})} style={{ width: "100%" }} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Footer</label>
          <input value={curTpl.footer} onChange={(e) => setTemplateData({ ...templateData, [activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate"]: { ...curTpl, footer: e.target.value }})} />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={loading}>Save</button>
          <button className="btn btn-secondary" onClick={() => { /* reset or reload */ }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
