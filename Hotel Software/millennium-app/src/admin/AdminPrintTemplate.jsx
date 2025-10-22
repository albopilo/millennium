// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

export default function AdminPrintTemplate({ permissions = [] }) {
  const [activeTab, setActiveTab] = useState("checkIn");
  const [current, setCurrent] = useState({
    header: "MILLENNIUM INN",
    body: "<p>Welcome {{guestName}} to Millennium Inn.<br/>Room: {{roomNumber}}</p>",
    footer: "<p>Signature: __________________</p>"
  });
  const [checkOut, setCheckOut] = useState({
    header: "MILLENNIUM INN",
    body: "<p>Thank you {{guestName}} for staying with us.<br/>Balance: {{balance}}</p>",
    footer: "<p>Signature: __________________</p>"
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const tdoc = await getDoc(doc(db, "admin_print_templates", "default"));
        if (tdoc.exists()) {
          const data = tdoc.data();
          if (data.checkInTemplate) setCurrent(data.checkInTemplate);
          if (data.checkOutTemplate) setCheckOut(data.checkOutTemplate);
        }
      } catch (err) {
        console.warn("Failed to load templates", err);
      }
    }
    load();
  }, []);

  const saveTemplates = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "admin_print_templates", "default"), {
        checkInTemplate: current,
        checkOutTemplate: checkOut
      }, { merge: true });
      alert("Templates saved");
    } catch (err) {
      console.error(err);
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (tab, key, val) => {
    if (tab === "checkIn") setCurrent({ ...current, [key]: val });
    else setCheckOut({ ...checkOut, [key]: val });
  };

  const tpl = activeTab === "checkIn" ? current : checkOut;

  return (
    <div className="reservation-detail-container card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>Admin Print Templates</h3>
        <div>
          <button className={`btn ${activeTab === "checkIn" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("checkIn")}>Check-In</button>
          <button className={`btn ${activeTab === "checkOut" ? "btn-primary" : "btn-secondary"}`} onClick={() => setActiveTab("checkOut")}>Check-Out</button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        <div style={{ flex: 1 }}>
          <label>Header</label>
          <input value={tpl.header} onChange={(e) => handleChange(activeTab, "header", e.target.value)} />
          <label style={{ marginTop: 8 }}>Body (HTML allowed)</label>
          <textarea rows={10} value={tpl.body} onChange={(e) => handleChange(activeTab, "body", e.target.value)} />
          <label style={{ marginTop: 8 }}>Footer</label>
          <input value={tpl.footer} onChange={(e) => handleChange(activeTab, "footer", e.target.value)} />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={saveTemplates} disabled={saving}>
              {saving ? "Saving…" : "💾 Save Templates"}
            </button>
          </div>
        </div>

        <div style={{ width: 350 }}>
          <h4>Preview</h4>
          <div className="preview-box" style={{ padding: 10, borderRadius: 8, background: "#fff", border: "1px solid #e6eef9" }}
            dangerouslySetInnerHTML={{
              __html: `
                <div style='text-align:center; font-weight:bold; font-size:18px;'>${tpl.header}</div>
                <hr/>
                <div style='margin:12px 0; font-size:14px;'>${tpl.body}</div>
                <hr/>
                <div style='text-align:center; font-size:12px;'>${tpl.footer}</div>
              `
            }}
          />
          <div style={{ marginTop: 12 }}>
            <h5>Placeholders</h5>
            <ul>
              <li><code>{{guestName}}</code></li>
              <li><code>{{roomNumber}}</code></li>
              <li><code>{{checkInDate}}</code> / <code>{{checkOutDate}}</code></li>
              <li><code>{{balance}}</code></li>
              <li><code>{{staffName}}</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
