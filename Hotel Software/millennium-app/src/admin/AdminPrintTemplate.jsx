import React, { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import {
  doc,
  getDoc,
  setDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import { db, auth } from "../firebase";
import "../styles/ReservationDetail.css";

/**
 * AdminPrintTemplate
 * - Manage check-in / check-out printable templates
 * - Uses version history in settings/printTemplates/versions
 * - Includes live preview, validation, and cleaner UI
 */

export default function AdminPrintTemplate({ permissions = [] }) {
  const canManage =
    permissions.includes("*") || permissions.includes("canManageSettings");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [active, setActive] = useState("checkIn");
  const [templates, setTemplates] = useState({
    checkInTemplate: {
      header: "MILLENNIUM INN",
      body: `<p>Welcome {{guestName}} to {{companyName}}.<br/>Room: {{roomNumber}}</p>`,
      footer: `<p>{{companyAddress}} • VAT: {{companyVatNumber}}</p>`,
    },
    checkOutTemplate: {
      header: "MILLENNIUM INN - Bill",
      body: `<p>Bill for {{guestName}} <br/> Total: {{balance}}</p>`,
      footer: `<div>{{signatureLine}}</div>`,
    },
  });
  const [showTokens, setShowTokens] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // ------------------------------------
  // Load templates
  // ------------------------------------
  useEffect(() => {
    if (!canManage) return;
    (async () => {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "settings", "printTemplates"));
        if (snap.exists()) {
          const data = snap.data();
          setTemplates((t) => ({
            ...t,
            ...data,
          }));
        }
      } catch (err) {
        console.error("Error loading templates:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [canManage]);

  if (!canManage)
    return <div className="muted p-4">Access denied. No edit rights.</div>;
  if (loading) return <div className="muted p-4">Loading templates…</div>;

  const currentKey =
    active === "checkIn" ? "checkInTemplate" : "checkOutTemplate";
  const current = templates[currentKey];

  // ------------------------------------
  // Save handler with versioning
  // ------------------------------------
  const handleSave = async () => {
    if (!current.header.trim() || !current.body.trim()) {
      alert("Header and body cannot be empty.");
      return;
    }

    setSaving(true);
    try {
      const user = auth?.currentUser;
      const savedBy =
        user?.displayName || user?.email || "system-admin";

      // Save main template
      await setDoc(doc(db, "settings", "printTemplates"), templates, {
        merge: true,
      });

      // Save version copy
      await addDoc(
        collection(db, "settings", "printTemplates", "versions"),
        {
          templates,
          savedAt: serverTimestamp(),
          savedBy,
        }
      );

      setLastSaved(new Date().toLocaleString());
      alert("Templates saved successfully.");
    } catch (err) {
      console.error("Save failed", err);
      alert("Failed to save templates. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  // ------------------------------------
  // Reset handler
  // ------------------------------------
  const defaultTemplates = {
    checkInTemplate: {
      header: "MILLENNIUM INN",
      body: `<p>Welcome {{guestName}} to {{companyName}}.<br/>Room: {{roomNumber}}</p>`,
      footer: `<p>{{companyAddress}} • VAT: {{companyVatNumber}}</p>`,
    },
    checkOutTemplate: {
      header: "MILLENNIUM INN - Bill",
      body: `<p>Bill for {{guestName}} <br/> Total: {{balance}}</p>`,
      footer: `<div>{{signatureLine}}</div>`,
    },
  };

  const resetTemplate = (key) =>
    setTemplates((t) => ({
      ...t,
      [key]: defaultTemplates[key],
    }));

  // ------------------------------------
  // Sanitized preview content
  // ------------------------------------
  const previewHtml = DOMPurify.sanitize(
    `<div style="text-align:center; font-weight:700">${current.header}</div>
     <hr/>
     ${current.body}
     <hr/>
     ${current.footer}`
  );

  return (
    <div className="card panel" style={{ maxWidth: 960, margin: "0 auto" }}>
      <div className="panel-header flex-between">
        <h3>Print Templates</h3>
        <div className="btn-group">
          <button
            className={`btn ${
              active === "checkIn" ? "btn-primary" : "btn-outline"
            }`}
            onClick={() => setActive("checkIn")}
          >
            Check-In
          </button>
          <button
            className={`btn ${
              active === "checkOut" ? "btn-primary" : "btn-outline"
            }`}
            onClick={() => setActive("checkOut")}
          >
            Check-Out
          </button>
        </div>
      </div>

      <div className="panel-body grid-2col gap-16">
        {/* Edit form */}
        <div>
          <label>Header</label>
          <input
            className="input"
            value={current.header}
            onChange={(e) =>
              setTemplates({
                ...templates,
                [currentKey]: { ...current, header: e.target.value },
              })
            }
          />

          <label style={{ marginTop: 8 }}>Body (HTML allowed)</label>
          <textarea
            rows={10}
            className="textarea"
            value={current.body}
            onChange={(e) =>
              setTemplates({
                ...templates,
                [currentKey]: { ...current, body: e.target.value },
              })
            }
          />

          <label style={{ marginTop: 8 }}>Footer</label>
          <input
            className="input"
            value={current.footer}
            onChange={(e) =>
              setTemplates({
                ...templates,
                [currentKey]: { ...current, footer: e.target.value },
              })
            }
          />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              marginTop: 12,
            }}
          >
            <button
              className="btn btn-secondary"
              onClick={() => resetTemplate(currentKey)}
            >
              Reset
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {lastSaved && (
            <div className="muted mt-2 text-right">
              ✓ Last saved: {lastSaved}
            </div>
          )}
        </div>

        {/* Live preview */}
        <div className="card soft p-3" style={{ background: "#fafafa" }}>
          <h4 className="mb-2">Live Preview</h4>
          <div
            className="preview-body"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <button
          className="btn btn-link"
          onClick={() => setShowTokens((v) => !v)}
        >
          {showTokens ? "Hide available tokens" : "Show available tokens"}
        </button>

        {showTokens && (
          <div className="card soft p-3">
            <strong>Available tokens:</strong>
            <div className="muted">
              Use placeholders like{" "}
              <code>{"{{guestName}}"}</code>,{" "}
              <code>{"{{roomNumber}}"}</code>,{" "}
              <code>{"{{balance}}"}</code>,{" "}
              <code>{"{{guestAddress}}"}</code>,{" "}
              <code>{"{{guestPhone}}"}</code>,{" "}
              <code>{"{{companyName}}"}</code>,{" "}
              <code>{"{{companyAddress}}"}</code>,{" "}
              <code>{"{{companyVatNumber}}"}</code>,{" "}
              <code>{"{{signatureLine}}"}</code>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
