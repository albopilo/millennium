// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

export default function AdminPrintTemplate() {
  const [activeTab, setActiveTab] = useState("checkIn");
  const [checkInTemplate, setCheckInTemplate] = useState({
    header: "MILLENNIUM INN",
    body: "<p>Welcome {{guestName}} to Millennium Inn.<br/>Room: {{roomNumber}}</p>",
    footer: "<p>Signature: __________________</p>"
  });
  const [checkOutTemplate, setCheckOutTemplate] = useState({
    header: "MILLENNIUM INN",
    body: "<p>Thank you {{guestName}} for staying with us.<br/>Balance: {{balance}}</p>",
    footer: "<p>Signature: __________________</p>"
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (snap.exists()) {
          const data = snap.data();
          if (data.checkInTemplate) setCheckInTemplate(data.checkInTemplate);
          if (data.checkOutTemplate) setCheckOutTemplate(data.checkOutTemplate);
        }
      } catch (err) {
        console.warn("load templates", err);
      }
    }
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await setDoc(doc(db, "admin_print_templates", "default"), {
        checkInTemplate,
        checkOutTemplate
      }, { merge: true });
      alert("Saved templates");
    } catch (err) {
      console.error("save templates", err);
      alert("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const tpl = activeTab === "checkIn" ? checkInTemplate : checkOutTemplate;
  const setTpl = (k, v) => {
    if (activeTab === "checkIn") setCheckInTemplate({ ...checkInTemplate, [k]: v });
    else setCheckOutTemplate({ ...checkOutTemplate, [k]: v });
  };

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
          <input value={tpl.header} onChange={e => setTpl("header", e.target.value)} />
          <label style={{ marginTop: 8 }}>Body (HTML allowed)</label>
          <textarea rows={10} value={tpl.body} onChange={e => setTpl("body", e.target.value)} />
          <label style={{ marginTop: 8 }}>Footer</label>
          <input value={tpl.footer} onChange={e => setTpl("footer", e.target.value)} />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "💾 Save Templates"}</button>
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
              <li><code>{"{{guestName}}"}</code></li>
              <li><code>{"{{roomNumber}}"}</code></li>
              <li><code>{"{{checkInDate}}"}</code> / <code>{"{{checkOutDate}}"}</code></li>
              <li><code>{"{{balance}}"}</code></li>
              <li><code>{"{{staffName}}"}</code></li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
