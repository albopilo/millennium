// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

/**
 * AdminPrintTemplate
 *
 * - Edit two separate templates: Check-In and Check-Out.
 * - Each template has: header (HTML), body (HTML), footer (HTML) and style options (font family, size, align, lineHeight).
 * - Live preview with sample data and placeholder insertion.
 * - Persist to Firestore doc: admin_print_templates/default (uses setDoc(..., { merge: true }))
 * - Basic sanitization: strip <script> tags before save and preview.
 *
 * Supported placeholders:
 *   {{guestName}}, {{roomNumber}}, {{checkInDate}}, {{checkOutDate}}, {{balance}}, {{staffName}}
 *
 * UX features:
 *  - Restore defaults per-template
 *  - Insert placeholder at cursor
 *  - Export/import JSON of templates
 *  - Open preview in new window (printable)
 *  - Visual dirty indicator and lastSaved timestamp
 */

const PLACEHOLDERS = [
  { key: "{{guestName}}", label: "Guest Name" },
  { key: "{{roomNumber}}", label: "Room Number" },
  { key: "{{checkInDate}}", label: "Check-In Date" },
  { key: "{{checkOutDate}}", label: "Check-Out Date" },
  { key: "{{balance}}", label: "Balance" },
  { key: "{{staffName}}", label: "Staff Name" }
];

// sensible default templates (not a copy of user's example)
const DEFAULT_TEMPLATES = {
  checkInTemplate: {
    header: `<div style="font-weight:700; font-size:18px;">HOTEL NAME</div>
<div style="font-size:12px;">Jl. Example No. 1 — City — Country</div>`,
    body: `<p><strong>Guest:</strong> {{guestName}}</p>
<p><strong>Room:</strong> {{roomNumber}}</p>
<p><strong>Check-in:</strong> {{checkInDate}}</p>
<p><strong>Check-out:</strong> {{checkOutDate}}</p>
<hr/>
<p>Please sign below to acknowledge arrival and any deposits.</p>`,
    footer: `<div style="font-size:12px;">Staff: {{staffName}}</div>`,
    styles: {
      fontFamily: "Arial, sans-serif",
      fontSize: 12,
      textAlign: "left",
      lineHeight: 1.4,
      color: "#111"
    }
  },
  checkOutTemplate: {
    header: `<div style="font-weight:700; font-size:18px;">HOTEL NAME</div>
<div style="font-size:12px;">Address — City — Country</div>`,
    body: `<p><strong>Guest:</strong> {{guestName}}</p>
<p><strong>Room:</strong> {{roomNumber}}</p>
<p><strong>Check-in:</strong> {{checkInDate}} — <strong>Check-out:</strong> {{checkOutDate}}</p>
<hr/>
<p><strong>Balance Due:</strong> {{balance}}</p>
<p>Thank you for staying with us.</p>`,
    footer: `<div style="font-size:12px;">Processed by: {{staffName}}</div>`,
    styles: {
      fontFamily: "Arial, sans-serif",
      fontSize: 12,
      textAlign: "left",
      lineHeight: 1.4,
      color: "#111"
    }
  }
};

function stripScriptTags(html = "") {
  if (!html) return "";
  // remove <script ...>...</script> and on*="" attributes which can execute JS in some contexts
  let out = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  // remove inline event handlers (very conservative)
  out = out.replace(/\son\w+=(?:"[^"]*"|'[^']*'|\S+)/gi, "");
  return out;
}

export default function AdminPrintTemplate() {
  const [activeTab, setActiveTab] = useState("checkIn"); // "checkIn" | "checkOut"
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateData, setTemplateData] = useState(DEFAULT_TEMPLATES);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const bodyRef = useRef(null); // textarea ref for inserting placeholders
  const fileInputRef = useRef(null);

  // load templates from Firestore on mount
  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (!mounted) return;
        if (snap.exists()) {
          const remote = snap.data() || {};
          setTemplateData({
            checkInTemplate: { ...DEFAULT_TEMPLATES.checkInTemplate, ...(remote.checkInTemplate || {}) },
            checkOutTemplate: { ...DEFAULT_TEMPLATES.checkOutTemplate, ...(remote.checkOutTemplate || {}) }
          });
          setDirty(false);
          setLastSavedAt(new Date()); // we don't know exact time, but indicate loaded
        } else {
          setTemplateData(DEFAULT_TEMPLATES);
          setDirty(true);
        }
      } catch (err) {
        console.error("Failed to load print templates:", err);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  const curKey = activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate";
  const curTpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];

  function updateCurTemplate(patch) {
    setTemplateData((prev) => {
      const next = { ...prev, [curKey]: { ...(prev[curKey] || {}), ...patch } };
      setDirty(true);
      return next;
    });
  }

  function updateCurStyle(patch) {
    const styles = { ...(curTpl.styles || {}), ...patch };
    updateCurTemplate({ styles });
  }

  function insertPlaceholderAtCursor(placeholder) {
    const ta = bodyRef.current;
    if (!ta) {
      // fallback: append to body
      updateCurTemplate({ body: (curTpl.body || "") + placeholder });
      return;
    }
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const val = ta.value || "";
    const next = val.slice(0, start) + placeholder + val.slice(end);
    updateCurTemplate({ body: next });
    // restore focus and cursor after render
    setTimeout(() => {
      try {
        ta.focus();
        const pos = start + placeholder.length;
        ta.setSelectionRange(pos, pos);
      } catch (e) {}
    }, 0);
  }

  function restoreDefaultsForActive() {
    if (!window.confirm("Restore default content for this template? This will overwrite current unsaved changes.")) return;
    setTemplateData((prev) => {
      const next = { ...prev, [curKey]: DEFAULT_TEMPLATES[curKey] };
      setDirty(true);
      return next;
    });
  }

  function validateTemplate(tpl) {
    const issues = [];
    if (!tpl.header || tpl.header.trim() === "") issues.push("Header is empty");
    if (!tpl.body || tpl.body.trim() === "") issues.push("Body is empty");
    if (!tpl.footer || tpl.footer.trim() === "") issues.push("Footer is empty");
    // optional: warn if no placeholders included
    const placeholdersFound = PLACEHOLDERS.some(p => (tpl.header + tpl.body + tpl.footer).includes(p.key));
    if (!placeholdersFound) issues.push("No placeholders found — preview will be static");
    return issues;
  }

  async function saveTemplates() {
    try {
      setSaving(true);
      // basic validation
      const tpl = templateData[curKey] || {};
      const issues = validateTemplate(tpl);
      if (issues.length > 0) {
        const cont = window.confirm(`Template warnings:\n- ${issues.join("\n- ")}\n\nSave anyway?`);
        if (!cont) return;
      }

      const payload = {
        checkInTemplate: {
          header: stripScriptTags(templateData.checkInTemplate.header || ""),
          body: stripScriptTags(templateData.checkInTemplate.body || ""),
          footer: stripScriptTags(templateData.checkInTemplate.footer || ""),
          styles: templateData.checkInTemplate.styles || DEFAULT_TEMPLATES.checkInTemplate.styles
        },
        checkOutTemplate: {
          header: stripScriptTags(templateData.checkOutTemplate.header || ""),
          body: stripScriptTags(templateData.checkOutTemplate.body || ""),
          footer: stripScriptTags(templateData.checkOutTemplate.footer || ""),
          styles: templateData.checkOutTemplate.styles || DEFAULT_TEMPLATES.checkOutTemplate.styles
        }
      };

      await setDoc(doc(db, "admin_print_templates", "default"), payload, { merge: true });
      setDirty(false);
      setLastSavedAt(new Date());
      alert("Templates saved.");
    } catch (err) {
      console.error("Failed to save templates:", err);
      alert("Save failed: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  // export current templates as JSON file
  function exportJson() {
    const payload = JSON.stringify(templateData, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "admin_print_templates.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  // import templates from a JSON file
  function onImportFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const obj = JSON.parse(String(ev.target.result));
        if (obj && (obj.checkInTemplate || obj.checkOutTemplate)) {
          setTemplateData({
            checkInTemplate: { ...DEFAULT_TEMPLATES.checkInTemplate, ...(obj.checkInTemplate || {}) },
            checkOutTemplate: { ...DEFAULT_TEMPLATES.checkOutTemplate, ...(obj.checkOutTemplate || {}) }
          });
          setDirty(true);
          alert("Imported templates into editor. Don't forget to Save to persist to Firestore.");
        } else {
          alert("Invalid template JSON format.");
        }
      } catch (err) {
        alert("Failed to parse JSON file: " + (err.message || err));
      }
    };
    reader.readAsText(f);
    // reset input
    e.target.value = "";
  }

  // sample data used for preview replacement
  const sampleData = useMemo(() => ({
    guestName: "Sample Guest",
    roomNumber: "107 - Standard",
    checkInDate: new Date().toLocaleString(),
    checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(),
    balance: "IDR 150.000",
    staffName: "Edo"
  }), []);

  function renderWithPlaceholders(html) {
    if (!html) return "";
    let out = String(html);
    // minimal replacement
    Object.entries(sampleData).forEach(([k, v]) => {
      out = out.split(`{{${k}}}`).join(String(v));
    });
    return out;
  }

  const previewHtml = useMemo(() => {
    const tpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];
    const s = tpl.styles || {};
const header = renderWithPlaceholders(tpl.header || "");
const body = renderWithPlaceholders(tpl.body || "");
const footer = renderWithPlaceholders(tpl.footer || "");

return `
  <div class="print-template">
    ${header}
    ${body}
    ${footer}
  </div>
`;
  }, [templateData, curKey, sampleData]);

  // open preview in a new window and (optionally) print
  function openPreviewWindow(doPrint = false) {
    const tpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];
    const win = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
    if (!win) {
      alert("Popup blocked. Allow popups to preview/print.");
      return;
    }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Print Preview</title>
      <style>body{margin:20px;font-family:${tpl.styles?.fontFamily || "Arial, sans-serif"};color:${tpl.styles?.color || "#111"};}</style>
      </head><body>${previewHtml}</body></html>`;
    win.document.write(html);
    win.document.close();
    if (doPrint) {
      setTimeout(() => {
        try { win.focus(); win.print(); } catch (e) { console.warn(e); }
      }, 350);
    }
  }

  return (
    <div className="reservation-detail-container card" style={{ maxWidth: 1200 }}>
      <div className="card-header">
        <h3 style={{ margin: 0 }}>Print Templates (Admin)</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${activeTab === "checkIn" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkIn")}>Check-In</button>
          <button className={`btn ${activeTab === "checkOut" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkOut")}>Check-Out</button>
        </div>
      </div>

      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 18 }}>
        {/* Left column: Editor */}
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <strong>{activeTab === "checkIn" ? "Check-In Template" : "Check-Out Template"}</strong>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {dirty && <span style={{ color: "#b45309" }}>Unsaved changes</span>}
              {lastSavedAt && <span style={{ color: "#475569" }}>Last saved: {lastSavedAt.toLocaleString()}</span>}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontWeight: 600 }}>Header (HTML allowed)</label>
            <input
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
              value={curTpl.header || ""}
              onChange={(e) => updateCurTemplate({ header: e.target.value })}
            />
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontWeight: 600 }}>Body (HTML allowed)</label>

            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
              <select
                defaultValue=""
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  insertPlaceholderAtCursor(val);
                  e.target.value = "";
                }}
                aria-label="Insert placeholder"
              >
                <option value="">Insert placeholder…</option>
                {PLACEHOLDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Font:
                <select value={curTpl.styles?.fontFamily || "Arial, sans-serif"} onChange={(e) => updateCurStyle({ fontFamily: e.target.value })}>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="Helvetica, Arial, sans-serif">Helvetica</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="Times New Roman, Times, serif">Times</option>
                  <option value="Courier New, monospace">Courier</option>
                </select>
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Size:
                <input type="number" min="8" max="36" value={curTpl.styles?.fontSize || 12} onChange={(e) => updateCurStyle({ fontSize: Number(e.target.value || 12) })} style={{ width: 72 }} />
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Align:
                <select value={curTpl.styles?.textAlign || "left"} onChange={(e) => updateCurStyle({ textAlign: e.target.value })}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>

            <textarea
              ref={bodyRef}
              rows={12}
              style={{ width: "100%", padding: 8, boxSizing: "border-box", fontFamily: "monospace", fontSize: 13 }}
              value={curTpl.body || ""}
              onChange={(e) => updateCurTemplate({ body: e.target.value })}
              placeholder="Write HTML for the body here. Use placeholders like {{guestName}}"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontWeight: 600 }}>Footer (HTML allowed)</label>
            <input
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
              value={curTpl.footer || ""}
              onChange={(e) => updateCurTemplate({ footer: e.target.value })}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={saveTemplates} disabled={saving || loading}>{saving ? "Saving…" : "Save to Firestore"}</button>
            <button className="btn" onClick={restoreDefaultsForActive}>Restore Defaults</button>
            <button className="btn" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(curTpl || {}, null, 2)); alert("Current template JSON copied to clipboard"); }}>Copy JSON</button>

            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn" onClick={exportJson}>Export JSON</button>
              <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onImportFile} />
              <button className="btn" onClick={() => fileInputRef.current && fileInputRef.current.click()}>Import JSON</button>
            </div>
          </div>
        </div>

        {/* Right column: Preview */}
        <div style={{ borderLeft: "1px solid #eef2ff", paddingLeft: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Live Preview</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => openPreviewWindow(false)}>Open</button>
              <button className="btn btn-outline" onClick={() => openPreviewWindow(true)}>Print</button>
            </div>
          </div>

          <div style={{ border: "1px solid #e6eef6", borderRadius: 8, padding: 12, minHeight: 300, background: "#fff" }}>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <strong>Placeholders</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {PLACEHOLDERS.map(p => (
                <button key={p.key} className="btn" onClick={() => insertPlaceholderAtCursor(p.key)} title={`Insert ${p.label}`}>
                  {p.key}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
              Preview uses sample values: Guest <strong>{sampleData.guestName}</strong>, Room <strong>{sampleData.roomNumber}</strong>, Balance <strong>{sampleData.balance}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
