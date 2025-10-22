// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useMemo, useState, useRef } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

/**
 * AdminPrintTemplate
 *
 * - Edits two separate templates: Check-In and Check-Out.
 * - Each template contains header, body (HTML), footer, and style options.
 * - Live preview with sample data and placeholder insertion helpers.
 * - Save/Load from Firestore collection doc: admin_print_templates/default
 *
 * Placeholders supported:
 *   {{guestName}}, {{roomNumber}}, {{checkInDate}}, {{checkOutDate}}, {{balance}}, {{staffName}}
 *
 * Notes:
 * - Body is edited via a textarea (HTML allowed). We intentionally allow HTML so staff
 *   can create simple printable markup. Preview uses dangerouslySetInnerHTML.
 * - We do minimal sanitization (strip <script> tags) before saving to Firestore and before preview.
 * - Uses setDoc(..., { merge: true }) to avoid clobbering unrelated fields.
 */

const DEFAULT_TEMPLATES = {
  checkInTemplate: {
    header: "<div style='font-weight:700; font-size:18px;'>MILLENNIUM INN</div>",
    body:
      "<p>Dear <strong>{{guestName}}</strong>,</p>" +
      "<p>Welcome to Millennium Inn. Your room number is <strong>{{roomNumber}}</strong>.</p>" +
      "<p>Arrival: {{checkInDate}}</p>" +
      "<p>Departure: {{checkOutDate}}</p>",
    footer: "<div style='font-size:12px;'>Signature: ______________________</div>",
    styles: {
      fontFamily: "Arial, sans-serif",
      fontSize: 12,
      textAlign: "left",
      lineHeight: 1.35
    }
  },
  checkOutTemplate: {
    header: "<div style='font-weight:700; font-size:18px;'>MILLENNIUM INN</div>",
    body:
      "<p>Dear <strong>{{guestName}}</strong>,</p>" +
      "<p>Thank you for staying with us.</p>" +
      "<p>Balance due: <strong>{{balance}}</strong></p>" +
      "<p>We hope to see you again.</p>",
    footer: "<div style='font-size:12px;'>Signature: ______________________</div>",
    styles: {
      fontFamily: "Arial, sans-serif",
      fontSize: 12,
      textAlign: "left",
      lineHeight: 1.35
    }
  }
};

const PLACEHOLDERS = [
  { key: "{{guestName}}", label: "Guest Name" },
  { key: "{{roomNumber}}", label: "Room Number" },
  { key: "{{checkInDate}}", label: "Check-In Date" },
  { key: "{{checkOutDate}}", label: "Check-Out Date" },
  { key: "{{balance}}", label: "Balance" },
  { key: "{{staffName}}", label: "Staff Name" }
];

function stripScriptTags(html) {
  // basic sanitization: remove <script>...</script>
  return html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
}

export default function AdminPrintTemplate({ permissions = [] }) {
  const [activeTab, setActiveTab] = useState("checkIn"); // "checkIn" | "checkOut"
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateData, setTemplateData] = useState(DEFAULT_TEMPLATES);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const bodyRef = useRef(null);

  // Load from Firestore
  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setLoading(true);
        const snap = await getDoc(doc(db, "admin_print_templates", "default"));
        if (!mounted) return;
        if (snap.exists()) {
          const remote = snap.data();
          // Merge with defaults to ensure styles exist
          setTemplateData({
            checkInTemplate: { ...DEFAULT_TEMPLATES.checkInTemplate, ...(remote.checkInTemplate || {}) },
            checkOutTemplate: { ...DEFAULT_TEMPLATES.checkOutTemplate, ...(remote.checkOutTemplate || {}) }
          });
        } else {
          // if none saved yet, seed defaults in local state
          setTemplateData(DEFAULT_TEMPLATES);
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
  }, []);

  const curKey = activeTab === "checkIn" ? "checkInTemplate" : "checkOutTemplate";
  const curTpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];

  // Helpers to update nested template parts and mark dirty
  function updateCurTemplate(patch) {
    setTemplateData((prev) => {
      const updated = {
        ...prev,
        [curKey]: { ...(prev[curKey] || {}), ...patch }
      };
      setDirty(true);
      return updated;
    });
  }

  function updateCurStyle(patch) {
    const styles = { ...(curTpl.styles || {}), ...patch };
    updateCurTemplate({ styles });
  }

  // Insert placeholder into body at cursor position (textarea)
  function insertPlaceholderAtCursor(placeholder) {
    const ta = bodyRef.current;
    if (!ta) {
      // fallback: append
      updateCurTemplate({ body: (curTpl.body || "") + placeholder });
      return;
    }
    const el = ta;
    const start = el.selectionStart || 0;
    const end = el.selectionEnd || 0;
    const val = el.value || "";
    const next = val.slice(0, start) + placeholder + val.slice(end);
    updateCurTemplate({ body: next });
    // after DOM update, restore cursor - setTimeout to wait for re-render
    setTimeout(() => {
      el.focus();
      const pos = start + placeholder.length;
      try { el.setSelectionRange(pos, pos); } catch (e) {}
    }, 0);
  }

  // Restore defaults for the active tab
  function restoreDefaults() {
    if (!window.confirm("Restore defaults for this template? Unsaved changes will be lost.")) return;
    setTemplateData((prev) => {
      const updated = { ...prev, [curKey]: DEFAULT_TEMPLATES[curKey] };
      setDirty(true);
      return updated;
    });
  }

  // Validate template before saving (ensure header/body/footer not empty)
  function validateTemplate(tpl) {
    const issues = [];
    if (!tpl.header || tpl.header.trim() === "") issues.push("Header is empty.");
    if (!tpl.body || tpl.body.trim() === "") issues.push("Body is empty.");
    if (!tpl.footer || tpl.footer.trim() === "") issues.push("Footer is empty.");
    // warn if no placeholders in check-out (not necessarily required)
    const hasPlaceholder = PLACEHOLDERS.some(p => (tpl.body || "").includes(p.key) || (tpl.header || "").includes(p.key) || (tpl.footer || "").includes(p.key));
    if (!hasPlaceholder) issues.push("No placeholders detected in this template — preview will show static content.");
    return issues;
  }

  // Save current state into Firestore
  async function saveTemplates() {
    try {
      setSaving(true);
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

      // Basic validation: show issues but allow saving if user continues
      const curIssues = validateTemplate(templateData[curKey]);
      if (curIssues.length > 0) {
        const proceed = window.confirm(`Template warnings:\n- ${curIssues.join("\n- ")}\n\nDo you want to continue saving?`);
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      await setDoc(doc(db, "admin_print_templates", "default"), payload, { merge: true });
      setDirty(false);
      setLastSavedAt(new Date());
      alert("Templates saved.");
    } catch (err) {
      console.error("save template error", err);
      alert("Failed to save template: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  // Preview render: replace placeholders with sample data
  const sampleData = {
    guestName: "Jane Doe",
    roomNumber: "101",
    checkInDate: new Date().toLocaleString(),
    checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString(),
    balance: "IDR 150.000",
    staffName: "Frontdesk"
  };
  function renderWithPlaceholders(html) {
    if (!html) return "";
    let out = html;
    out = out.split("{{guestName}}").join(sampleData.guestName);
    out = out.split("{{roomNumber}}").join(sampleData.roomNumber);
    out = out.split("{{checkInDate}}").join(sampleData.checkInDate);
    out = out.split("{{checkOutDate}}").join(sampleData.checkOutDate);
    out = out.split("{{balance}}").join(sampleData.balance);
    out = out.split("{{staffName}}").join(sampleData.staffName);
    return out;
  }

  const previewHtml = useMemo(() => {
    const tpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];
    const style = tpl.styles || {};
    const fontStyle = `font-family:${style.fontFamily || "Arial, sans-serif"}; font-size:${(style.fontSize || 12)}px; line-height:${style.lineHeight || 1.35}; text-align:${style.textAlign || "left"}; color:#111;`;
    const header = renderWithPlaceholders(tpl.header || "");
    const body = renderWithPlaceholders(tpl.body || "");
    const footer = renderWithPlaceholders(tpl.footer || "");
    return `<div style="${fontStyle}">
      <div class="print-header">${header}</div>
      <hr/>
      <div class="print-body" style="margin:12px 0;">${body}</div>
      <hr/>
      <div class="print-footer" style="margin-top:8px;">${footer}</div>
    </div>`;
  }, [templateData, curKey]);

  // small utility: set a specific part (header/body/footer) to new value
  function setPart(part, value) {
    // part: "header" | "body" | "footer"
    updateCurTemplate({ [part]: value });
  }

  return (
    <div className="reservation-detail-container card" style={{ maxWidth: 1100 }}>
      <div className="card-header" style={{ alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Print Templates</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className={`btn ${activeTab === "checkIn" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("checkIn")}
            aria-pressed={activeTab === "checkIn"}
          >
            Check-In
          </button>
          <button
            className={`btn ${activeTab === "checkOut" ? "btn-primary" : ""}`}
            onClick={() => setActiveTab("checkOut")}
            aria-pressed={activeTab === "checkOut"}
          >
            Check-Out
          </button>
        </div>
      </div>

      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 18 }}>
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <strong style={{ minWidth: 80 }}>{activeTab === "checkIn" ? "Check-In" : "Check-Out"} Template</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(curTpl || {}, null, 2)); alert("Template JSON copied to clipboard (for debugging)."); }}>Copy JSON</button>
              <button className="btn" onClick={restoreDefaults}>Restore Defaults</button>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {dirty && <span style={{ color: "#b45309", fontSize: 13 }}>Unsaved changes</span>}
              {lastSavedAt && <span style={{ color: "#475569", fontSize: 13 }}>Saved {lastSavedAt.toLocaleString()}</span>}
            </div>
          </div>

          <div style={{ marginBottom: 10 }}>
            <label style={{ display: "block", fontWeight: 600 }}>Header (HTML allowed)</label>
            <input
              value={curTpl.header || ""}
              onChange={(e) => setPart("header", e.target.value)}
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label style={{ display: "block", fontWeight: 600 }}>
              Body (HTML allowed)
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <select
                onChange={(e) => {
                  if (!e.target.value) return;
                  insertPlaceholderAtCursor(e.target.value);
                  e.target.value = "";
                }}
                defaultValue=""
              >
                <option value="">Insert placeholder…</option>
                {PLACEHOLDERS.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
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
                <input type="number" min="8" max="36" value={curTpl.styles?.fontSize || 12} onChange={(e) => updateCurStyle({ fontSize: Number(e.target.value || 12) })} style={{ width: 68 }} />
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
              value={curTpl.body || ""}
              onChange={(e) => setPart("body", e.target.value)}
              rows={10}
              style={{ width: "100%", padding: 8, boxSizing: "border-box", fontFamily: "monospace", fontSize: 13 }}
              placeholder="HTML body: use placeholders like {{guestName}} or {{balance}}"
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontWeight: 600 }}>Footer (HTML allowed)</label>
            <input
              value={curTpl.footer || ""}
              onChange={(e) => setPart("footer", e.target.value)}
              style={{ width: "100%", padding: 8, boxSizing: "border-box" }}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={saveTemplates} disabled={saving || loading}>{saving ? "Saving…" : "Save Templates"}</button>
            <button className="btn btn-secondary" onClick={() => { setTemplateData(templateData); alert("No-op: You can use Restore Defaults or manually modify."); }}>Cancel</button>
            <div style={{ marginLeft: "auto", alignSelf: "center" }}>
              <small style={{ color: "#64748b" }}>Firestore doc: admin_print_templates/default</small>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Preview */}
        <div style={{ borderLeft: "1px solid #eef2ff", paddingLeft: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <strong>Live Preview</strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => {
                // open print preview of previewHtml in new window
                const win = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
                if (!win) { alert("Popup blocked. Please allow popups to preview."); return; }
                win.document.write(`
                  <html><head><title>Print Preview</title>
                  <style>body{margin:20px;font-family: ${curTpl.styles?.fontFamily || "Arial, sans-serif"};color:#111}</style>
                  </head><body>${previewHtml}</body></html>
                `);
                win.document.close();
              }}>Open in new window</button>

              <button className="btn btn-outline" onClick={() => {
                // print preview (open a temporary window to print)
                const win = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
                if (!win) { alert("Popup blocked. Please allow popups to print."); return; }
                win.document.write(`<html><head><title>Print</title><style>body{margin:20px;font-family:${curTpl.styles?.fontFamily || "Arial, sans-serif"};color:#111}</style></head><body>${previewHtml}</body></html>`);
                win.document.close();
                // give it a moment to render then call print
                setTimeout(() => {
                  try { win.focus(); win.print(); win.close(); } catch (e) { console.warn(e); }
                }, 350);
              }}>Print Preview</button>
            </div>
          </div>

          <div style={{ border: "1px solid #e6eef6", borderRadius: 8, padding: 12, minHeight: 300, background: "#fff" }}>
            <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>

          <div style={{ marginTop: 12 }}>
            <strong>Available placeholders</strong>
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {PLACEHOLDERS.map(p => (
                <button key={p.key} className="btn" onClick={() => insertPlaceholderAtCursor(p.key)} title={`Insert ${p.label}`}>
                  {p.key}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, color: "#475569", fontSize: 13 }}>
              Sample values are used for preview (Guest: <strong>{sampleData.guestName}</strong>, Room: <strong>{sampleData.roomNumber}</strong>, Balance: <strong>{sampleData.balance}</strong>).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
