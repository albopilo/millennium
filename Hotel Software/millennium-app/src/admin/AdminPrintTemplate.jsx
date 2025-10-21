// src/admin/adminprinttemplate.jsx
import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "./adminprinttemplate.css";

export default function AdminPrintTemplate({ permissions }) {
  const [activeTab, setActiveTab] = useState("checkIn");
  const [templateData, setTemplateData] = useState({
    checkInTemplate: {
      header: "MILLENNIUM INN",
      body: "<p>Welcome {{guestName}} to Millennium Inn.<br/>Your room number is {{roomNumber}}.</p>",
      footer: "<p>Signature: ______________________</p>",
    },
    checkOutTemplate: {
      header: "MILLENNIUM INN",
      body: "<p>Thank you {{guestName}} for staying with us.<br/>Your total balance is {{balance}}.</p>",
      footer: "<p>Signature: ______________________</p>",
    },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage =
    permissions?.includes("*") || permissions?.includes("canManageSettings");

  // 🔹 Load templates
  useEffect(() => {
    async function loadTemplates() {
      try {
        const snap = await getDoc(doc(db, "settings", "printTemplates"));
        if (snap.exists()) {
          setTemplateData((prev) => ({ ...prev, ...snap.data() }));
        }
      } catch (err) {
        console.error("Error loading templates:", err);
      } finally {
        setLoading(false);
      }
    }
    if (canManage) loadTemplates();
  }, [canManage]);

  // 🔹 Save templates
  const saveTemplates = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "printTemplates"), templateData, {
        merge: true,
      });
      alert("Print templates saved successfully!");
    } catch (err) {
      console.error("Failed to save templates:", err);
      alert("Failed to save templates.");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return <div>Access denied</div>;
  if (loading) return <div>Loading templates…</div>;

  const current = activeTab === "checkIn"
    ? templateData.checkInTemplate
    : templateData.checkOutTemplate;

  const handleChange = (field, value) => {
    const key =
      activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate";
    setTemplateData({
      ...templateData,
      [key]: { ...templateData[key], [field]: value },
    });
  };

  return (
    <div className="print-template-container">
      <h2>Print Template Settings</h2>

      <div className="template-tabs">
        <button
          className={activeTab === "checkIn" ? "active" : ""}
          onClick={() => setActiveTab("checkIn")}
        >
          Check-In Form
        </button>
        <button
          className={activeTab === "checkOut" ? "active" : ""}
          onClick={() => setActiveTab("checkOut")}
        >
          Check-Out Form
        </button>
      </div>

      <div className="template-editor">
        <label>Header</label>
        <input
          type="text"
          value={current.header}
          onChange={(e) => handleChange("header", e.target.value)}
        />

        <label>Body (HTML supported)</label>
        <textarea
          rows={10}
          value={current.body}
          onChange={(e) => handleChange("body", e.target.value)}
        />

        <label>Footer</label>
        <input
          type="text"
          value={current.footer}
          onChange={(e) => handleChange("footer", e.target.value)}
        />
      </div>

      <div className="template-preview">
        <h3>Live Preview</h3>
        <div
          className="preview-box"
          dangerouslySetInnerHTML={{
            __html: `
              <div style='text-align:center; font-weight:bold; font-size:18px;'>${current.header}</div>
              <hr/>
              <div style='margin: 12px 0; font-size:14px;'>${current.body}</div>
              <hr/>
              <div style='text-align:center; font-size:12px;'>${current.footer}</div>
            `,
          }}
        ></div>
      </div>

      <button
        className="btn-primary"
        style={{ marginTop: "16px" }}
        onClick={saveTemplates}
        disabled={saving}
      >
        {saving ? "Saving…" : "Save Templates"}
      </button>

      <div className="placeholder-help">
        <h4>Available Placeholders:</h4>
        <ul>
          <li><code>{{guestName}}</code> → Guest’s name</li>
          <li><code>{{roomNumber}}</code> → Room number</li>
          <li><code>{{checkInDate}}</code> / <code>{{checkOutDate}}</code></li>
          <li><code>{{balance}}</code> → Total balance</li>
          <li><code>{{staffName}}</code> → Printed by staff</li>
        </ul>
      </div>
    </div>
  );
}
