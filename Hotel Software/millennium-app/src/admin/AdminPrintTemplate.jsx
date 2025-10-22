// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

export default function AdminPrintTemplate({ permissions = [] }) {
  const [activeTab, setActiveTab] = useState("checkIn");
  const [loading, setLoading] = useState(false);
  const [templateData, setTemplateData] = useState({
    checkInTemplate: {
      header: "MILLENNIUM INN",
      body:
        "<p>Welcome {{guestName}} to Millennium Inn.<br/>Your room number is {{roomNumber}}.<br/>Check-in: {{checkInDate}}<br/>Check-out: {{checkOutDate}}</p>",
      footer: "<p>Signature: ______________________</p>",
    },
    checkOutTemplate: {
      header: "MILLENNIUM INN",
      body:
        "<p>Thank you {{guestName}} for staying with us.<br/>Room: {{roomNumber}}<br/>Balance: {{balance}}</p>",
      footer: "<p>Signature: ______________________</p>",
    },
  });

  // load existing templates from Firestore
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (snap.exists() && mounted) {
          const data = snap.data();
          setTemplateData({
            checkInTemplate: data.checkInTemplate || templateData.checkInTemplate,
            checkOutTemplate: data.checkOutTemplate || templateData.checkOutTemplate,
          });
        }
      } catch (err) {
        console.error("AdminPrintTemplate load error", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    try {
      setLoading(true);
      await setDoc(doc(db, "admin_print_templates", "default"), templateData, { merge: true });
      alert("Templates saved successfully");
    } catch (err) {
      console.error("save template error", err);
      alert("Failed to save template");
    } finally {
      setLoading(false);
    }
  };

  const curTpl =
    activeTab === "checkIn" ? templateData.checkInTemplate : templateData.checkOutTemplate;

  const handleFieldChange = (field, value) => {
    const key = activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate";
    setTemplateData({
      ...templateData,
      [key]: {
        ...templateData[key],
        [field]: value,
      },
    });
  };

  return (
    <div className="reservation-detail-container card">
      <div className="card-header">
        <h3>Print Templates</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn ${activeTab === "checkIn" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("checkIn")}
          >
            Check-In
          </button>
          <button
            className={`btn ${activeTab === "checkOut" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("checkOut")}
          >
            Check-Out
          </button>
        </div>
      </div>

      <div className="card-body">
        <div style={{ marginBottom: 12 }}>
          <label>Header</label>
          <input
            value={curTpl.header}
            onChange={(e) => handleFieldChange("header", e.target.value)}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>
            Body (HTML allowed). Use placeholders:<br />
            <code>
              {"{{guestName}}"}, {"{{roomNumber}}"}, {"{{checkInDate}}"},
              {"{{checkOutDate}}"}, {"{{balance}}"}, {"{{staffName}}"}
            </code>
          </label>
          <textarea
            rows={8}
            value={curTpl.body}
            onChange={(e) => handleFieldChange("body", e.target.value)}
            style={{ width: "100%", fontFamily: "monospace" }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label>Footer</label>
          <input
            value={curTpl.footer}
            onChange={(e) => handleFieldChange("footer", e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" onClick={save} disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </button>
          <button className="btn btn-secondary" onClick={() => window.location.reload()}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
