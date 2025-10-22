// src/admin/AdminPrintTemplate.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";
import "../styles/ReservationDetail.css";

/**
 * AdminPrintTemplate
 *
 * - Edit and save Check-In and Check-Out templates to Firestore doc: admin_print_templates/default
 * - Each template contains: header (HTML), body (HTML), footer (HTML) and styles.
 * - Live preview with sample replacement values. Preview renders template styles inline so they take precedence.
 * - Supports HTML placeholders ({{roomCharges}}, {{payments}}) and text placeholders.
 *
 * Security: we remove <script>...</script> and inline event handlers like onclick before saving/previewing.
 * (This is *not* a full sanitizer for public content, but it's conservative for admin usage.)
 */

const PLACEHOLDERS = [
  { key: "{{guestName}}", label: "Guest Name" },
  { key: "{{roomNumber}}", label: "Room Number" },
  { key: "{{checkInDate}}", label: "Check-In Date" },
  { key: "{{checkInTime}}", label: "Check-In DateTime" },
  { key: "{{checkOutDate}}", label: "Check-Out Date" },
  { key: "{{checkOutTime}}", label: "Check-Out DateTime" },
  { key: "{{guestPhone}}", label: "Guest Phone" },
  { key: "{{guestEmail}}", label: "Guest Email" },
  { key: "{{displayName}}", label: "Staff Display Name" },
  { key: "{{staffEmail}}", label: "Staff Email" },
  { key: "{{roomCharges}}", label: "Room Charges (table rows HTML)" },
  { key: "{{payments}}", label: "Payments (table rows HTML)" },
  { key: "{{totalCharge}}", label: "Total Charges" },
  { key: "{{totalPayment}}", label: "Total Payments" },
  { key: "{{balance}}", label: "Remaining Balance" },
  { key: "{{timestamp}}", label: "Now Timestamp" }
];

const DEFAULT_TEMPLATES = {
  checkInTemplate: {
    header: `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <div style="font-size:20px; font-weight:700;">Millennium Inn</div>
          <div style="font-size:12px; color:#374151;">Jl. Setia Luhur No. 81, Medan — Sumatera Utara</div>
          <div style="font-size:12px; color:#374151;">Telp. 082217091699 | Email: fo.millennium1@gmail.com</div>
        </div>
        <div style="font-weight:700; font-size:16px; text-align:right;">Check-In Form</div>
      </div>
    `,
    body: `
      <div style="margin-top:8px;">
        <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
          <tbody>
            <tr>
              <td style="width:130px;">Guest Name</td><td>: <strong>{{guestName}}</strong></td>
              <td style="width:130px;">Room</td><td>: <strong>{{roomNumber}}</strong></td>
            </tr>
            <tr>
              <td>Check-In</td><td>: {{checkInTime}}</td>
              <td>Check-Out</td><td>: {{checkOutTime}}</td>
            </tr>
            <tr>
              <td>Phone</td><td>: {{guestPhone}}</td>
              <td>Email</td><td>: {{guestEmail}}</td>
            </tr>
            <tr>
              <td>Handled By</td><td>: {{displayName}}</td>
              <td>Staff Email</td><td>: {{staffEmail}}</td>
            </tr>
          </tbody>
        </table>

        <hr style="border:none; border-top:1px solid #e5e7eb; margin:8px 0;"/>

        <div style="font-weight:700; margin-bottom:6px;">Stay Summary</div>
        <table style="width:100%; border-collapse:collapse;" border="1" cellspacing="0" cellpadding="4">
          <thead style="background:#f3f4f6;">
            <tr>
              <th style="width:6%; text-align:center;">#</th>
              <th style="text-align:left;">Description</th>
              <th style="width:16%; text-align:right;">Rate</th>
              <th style="width:8%; text-align:center;">Qty</th>
              <th style="width:16%; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            {{roomCharges}}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="text-align:right; font-weight:700;">Total Charges</td>
              <td style="text-align:right; font-weight:700;">{{totalCharge}}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top:12px;">
          <div style="font-weight:700; margin-bottom:6px;">Payment / Deposit Information</div>
          <table style="width:100%; border-collapse:collapse;" border="1" cellspacing="0" cellpadding="4">
            <thead style="background:#fafafa;">
              <tr>
                <th style="width:40%;">Method</th>
                <th style="width:40%;">Reference / Notes</th>
                <th style="width:20%; text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{payments}}
            </tbody>
            <tfoot>
              <tr>
                <td colspan="2" style="text-align:right; font-weight:700;">Total Payment</td>
                <td style="text-align:right; font-weight:700;">{{totalPayment}}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="margin-top:14px; font-weight:700;">Remaining Balance: <span style="color:#dc2626;">{{balance}}</span></div>

        <div style="margin-top:16px; font-size:12px; color:#374151;">
          <strong>Guest Declaration:</strong>
          <p style="margin:6px 0 0 0;">
            I hereby agree to comply with hotel rules, settle all bills before check-out and acknowledge the hotel's policy regarding valuables.
          </p>
        </div>
      </div>
    `,
    footer: `
      <div style="display:flex; justify-content:space-between; margin-top:24px;">
        <div style="width:45%; text-align:center;">
          <div><strong>Guest Signature</strong></div>
          <div style="margin-top:48px;">( {{guestName}} )</div>
        </div>
        <div style="width:45%; text-align:center;">
          <div><strong>Front Desk Staff</strong></div>
          <div style="margin-top:48px;">( {{displayName}} )</div>
        </div>
      </div>
    `,
    styles: {
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      fontSize: 13,
      textAlign: "left",
      lineHeight: 1.45,
      color: "#111827"
    }
  },
  checkOutTemplate: {
    header: `
      <div style="display:flex; align-items:center; justify-content:space-between;">
        <div>
          <div style="font-size:20px; font-weight:700;">Millennium Inn</div>
          <div style="font-size:12px; color:#374151;">Jl. Setia Luhur No. 81, Medan — Sumatera Utara</div>
          <div style="font-size:12px; color:#374151;">Telp. 082217091699 | Email: fo.millennium1@gmail.com</div>
        </div>
        <div style="font-weight:700; font-size:16px; text-align:right; color:#0f172a;">Check-Out Form</div>
      </div>
    `,
    body: `
      <div style="margin-top:8px;">
        <table style="width:100%; border-collapse:collapse; margin-bottom:8px;">
          <tbody>
            <tr>
              <td style="width:130px;">Guest Name</td><td>: <strong>{{guestName}}</strong></td>
              <td style="width:130px;">Room</td><td>: <strong>{{roomNumber}}</strong></td>
            </tr>
            <tr>
              <td>Check-In</td><td>: {{checkInTime}}</td>
              <td>Check-Out</td><td>: {{checkOutTime}}</td>
            </tr>
            <tr>
              <td>Phone</td><td>: {{guestPhone}}</td>
              <td>Email</td><td>: {{guestEmail}}</td>
            </tr>
          </tbody>
        </table>

        <hr style="border:none; border-top:1px solid #e5e7eb; margin:8px 0;"/>

        <div style="font-weight:700; margin-bottom:6px;">Itemized Charges</div>
        <table style="width:100%; border-collapse:collapse;" border="1" cellspacing="0" cellpadding="4">
          <thead style="background:#f8fafc;">
            <tr>
              <th style="width:6%; text-align:center;">#</th>
              <th style="text-align:left;">Description</th>
              <th style="width:16%; text-align:right;">Rate</th>
              <th style="width:8%; text-align:center;">Qty</th>
              <th style="width:16%; text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            {{roomCharges}}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="text-align:right; font-weight:700;">Total Charges</td>
              <td style="text-align:right; font-weight:700;">{{totalCharge}}</td>
            </tr>
          </tfoot>
        </table>

        <div style="margin-top:12px;">
          <div style="font-weight:700; margin-bottom:6px;">Payments</div>
          <table style="width:100%; border-collapse:collapse;" border="1" cellspacing="0" cellpadding="4">
            <thead style="background:#fafafa;">
              <tr>
                <th style="width:60%;">Method / Notes</th>
                <th style="width:40%; text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              {{payments}}
            </tbody>
            <tfoot>
              <tr>
                <td style="text-align:right; font-weight:700;">Total Payment</td>
                <td style="text-align:right; font-weight:700;">{{totalPayment}}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div style="margin-top:16px; padding:10px; border:1px dashed #fecaca; background:#fff7f7;">
          <div style="font-weight:800; color:#b91c1c; font-size:16px;">Remaining Balance: {{balance}}</div>
        </div>

        <div style="margin-top:14px; font-size:12px; color:#374151;">
          <p style="margin:6px 0 0 0;">Thank you for staying with us. We hope to see you again.</p>
        </div>
      </div>
    `,
    footer: `
      <div style="display:flex; justify-content:space-between; margin-top:24px;">
        <div style="width:45%; text-align:center;">
          <div><strong>Guest Signature</strong></div>
          <div style="margin-top:48px;">( {{guestName}} )</div>
        </div>
        <div style="width:45%; text-align:center;">
          <div><strong>Front Desk Staff</strong></div>
          <div style="margin-top:48px;">( {{displayName}} )</div>
        </div>
      </div>
    `,
    styles: {
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      fontSize: 13,
      textAlign: "left",
      lineHeight: 1.45,
      color: "#0f172a"
    }
  }
};

function stripScriptTags(html = "") {
  if (!html) return "";
  // basic sanitize: remove script tags and inline event handlers (onclick etc.)
  let out = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  out = out.replace(/\s(on\w+)\s*=\s*(".*?"|'.*?'|\S+)/gi, "");
  return out;
}

export default function AdminPrintTemplate() {
  const [activeTab, setActiveTab] = useState("checkIn"); // checkIn | checkOut
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [templateData, setTemplateData] = useState(DEFAULT_TEMPLATES);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const bodyRef = useRef(null);
  const fileRef = useRef(null);

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
          setLastSavedAt(new Date());
        } else {
          setTemplateData(DEFAULT_TEMPLATES);
          setDirty(true);
        }
      } catch (err) {
        console.error("AdminPrintTemplate load error:", err);
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
    setTemplateData(prev => {
      const next = { ...prev, [curKey]: { ...(prev[curKey] || {}), ...patch } };
      setDirty(true);
      return next;
    });
  }

  function updateCurStyle(patch) {
    updateCurTemplate({ styles: { ...(curTpl.styles || {}), ...patch } });
  }

  // insert placeholder at textarea cursor
  function insertPlaceholderAtCursor(placeholder) {
    const ta = bodyRef.current;
    if (!ta) {
      updateCurTemplate({ body: (curTpl.body || "") + placeholder });
      return;
    }
    const start = ta.selectionStart ?? 0;
    const end = ta.selectionEnd ?? 0;
    const val = ta.value || "";
    const next = val.slice(0, start) + placeholder + val.slice(end);
    updateCurTemplate({ body: next });
    // restore focus position
    setTimeout(() => {
      try { ta.focus(); ta.setSelectionRange(start + placeholder.length, start + placeholder.length); } catch (e) {}
    }, 0);
  }

  function restoreDefaultsForActive() {
    if (!window.confirm("Restore default content for this template? Unsaved changes will be lost.")) return;
    setTemplateData(prev => {
      const next = { ...prev, [curKey]: DEFAULT_TEMPLATES[curKey] };
      setDirty(true);
      return next;
    });
  }

  function validateTemplate(tpl) {
    const issues = [];
    if (!tpl.header || !String(tpl.header).trim()) issues.push("Header empty");
    if (!tpl.body || !String(tpl.body).trim()) issues.push("Body empty");
    if (!tpl.footer || !String(tpl.footer).trim()) issues.push("Footer empty");
    return issues;
  }

  async function saveTemplates() {
    try {
      setSaving(true);
      const tpl = templateData[curKey] || {};
      const issues = validateTemplate(tpl);
      if (issues.length > 0) {
        const ok = window.confirm("Template warnings:\n- " + issues.join("\n- ") + "\n\nSave anyway?");
        if (!ok) {
          setSaving(false);
          return;
        }
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
      console.error("saveTemplates error:", err);
      alert("Save failed: " + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  // export/import JSON helpers
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

  function onImportFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        const json = JSON.parse(String(ev.target.result));
        if (!json || (!json.checkInTemplate && !json.checkOutTemplate)) {
          alert("Invalid template JSON");
          return;
        }
        setTemplateData({
          checkInTemplate: { ...DEFAULT_TEMPLATES.checkInTemplate, ...(json.checkInTemplate || {}) },
          checkOutTemplate: { ...DEFAULT_TEMPLATES.checkOutTemplate, ...(json.checkOutTemplate || {}) }
        });
        setDirty(true);
        alert("Imported into editor — click Save to persist.");
      } catch (err) {
        alert("Failed to parse JSON file: " + (err.message || err));
      }
    };
    r.readAsText(f);
    e.target.value = "";
  }

  // sample preview data (used in live preview)
  const sampleData = useMemo(() => ({
    guestName: "Aa Susilo",
    roomNumber: "317 - Standard",
    checkInDate: new Date().toLocaleDateString(),
    checkInTime: new Date().toLocaleString(),
    checkOutDate: new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString(),
    checkOutTime: new Date(Date.now() + 24 * 3600 * 1000).toLocaleString(),
    guestPhone: "0812-3456-7890",
    guestEmail: "aa@example.com",
    displayName: "Edo",
    staffEmail: "edo@millenniuminn.com",
    // roomCharges and payments contain table rows HTML (for preview only)
    roomCharges: `
      <tr>
        <td style="text-align:center;">1</td>
        <td>Room 317 — Standard</td>
        <td style="text-align:right;">150,000</td>
        <td style="text-align:center;">1</td>
        <td style="text-align:right;">150,000</td>
      </tr>
      <tr>
        <td style="text-align:center;">2</td>
        <td>Breakfast</td>
        <td style="text-align:right;">50,000</td>
        <td style="text-align:center;">1</td>
        <td style="text-align:right;">50,000</td>
      </tr>
    `,
    payments: `
      <tr>
        <td>Credit Card - VISA</td><td style="text-align:right;">150,000</td>
      </tr>
    `,
    totalCharge: "IDR 200.000",
    totalPayment: "IDR 150.000",
    balance: "IDR 50.000",
    timestamp: new Date().toLocaleString()
  }), []);

  // replace placeholders in given html; allow some placeholders to contain HTML (roomCharges/payments)
  function renderWithPlaceholders(html, data = {}) {
    if (!html) return "";
    let out = String(html);

    // replace all keys with provided data
    Object.keys(data).forEach(k => {
      const token = `{{${k}}}`;
      const value = data[k] != null ? String(data[k]) : "";
      out = out.split(token).join(value);
    });

    // clear any remaining unknown placeholders to a visible dash
    out = out.replace(/{{\s*[\w]+\s*}}/g, "—");
    return out;
  }

  // assembled HTML preview (applies template style inline to ensure it's used)
  const previewHtml = useMemo(() => {
    const tpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];
    const s = tpl.styles || {};
    const wrapperStyle = [
      `font-family: ${s.fontFamily || "Arial, sans-serif"}`,
      `font-size: ${(s.fontSize || 12)}px`,
      `line-height: ${s.lineHeight || 1.4}`,
      `text-align: ${s.textAlign || "left"}`,
      `color: ${s.color || "#111"}`
    ].join("; ");

    const header = renderWithPlaceholders(tpl.header || "", sampleData);
    const body = renderWithPlaceholders(tpl.body || "", sampleData);
    const footer = renderWithPlaceholders(tpl.footer || "", sampleData);

    return `<div style="${wrapperStyle}">${header}<div style="margin-top:8px;">${body}</div>${footer}</div>`;
  }, [templateData, curKey, sampleData]);

  function openPreviewWindow(doPrint = false) {
    const tpl = templateData[curKey] || DEFAULT_TEMPLATES[curKey];
    const win = window.open("", "_blank", "toolbar=0,location=0,menubar=0");
    if (!win) {
      alert("Popup blocked. Allow popups to preview/print.");
      return;
    }
    const s = tpl.styles || {};
    const bodyHTML = previewHtml;
    const docHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Print Preview</title>
      <style>
        @page { margin: 18mm; }
        body { margin: 10mm; -webkit-print-color-adjust: exact; }
        table { font-size: ${s.fontSize || 12}px; border-collapse: collapse; }
      </style>
      </head><body>${bodyHTML}</body></html>`;
    win.document.write(docHtml);
    win.document.close();
    if (doPrint) {
      setTimeout(() => { try { win.focus(); win.print(); } catch (e) { console.warn(e); } }, 350);
    }
  }

  // component render
  return (
    <div className="reservation-detail-container card" style={{ maxWidth: 1200 }}>
      <div className="card-header" style={{ alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Print Templates (Admin)</h3>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${activeTab === "checkIn" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkIn")}>Check-In</button>
          <button className={`btn ${activeTab === "checkOut" ? "btn-primary" : ""}`} onClick={() => setActiveTab("checkOut")}>Check-Out</button>
        </div>
      </div>

      <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 18 }}>
        {/* Editor (left) */}
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
              >
                <option value="">Insert placeholder…</option>
                {PLACEHOLDERS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Font:
                <select value={curTpl.styles?.fontFamily || "'Helvetica Neue', Arial, sans-serif"} onChange={(e) => updateCurStyle({ fontFamily: e.target.value })}>
                  <option value="'Helvetica Neue', Arial, sans-serif">Helvetica</option>
                  <option value="Arial, sans-serif">Arial</option>
                  <option value="Georgia, serif">Georgia</option>
                  <option value="Times New Roman, Times, serif">Times</option>
                  <option value="Courier New, monospace">Courier</option>
                </select>
              </label>

              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                Size:
                <input type="number" min="8" max="36" value={curTpl.styles?.fontSize || 13} onChange={(e) => updateCurStyle({ fontSize: Number(e.target.value || 13) })} style={{ width: 72 }} />
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
              rows={14}
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
              <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={onImportFile} />
              <button className="btn" onClick={() => fileRef.current && fileRef.current.click()}>Import JSON</button>
            </div>
          </div>
        </div>

        {/* Preview (right) */}
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
