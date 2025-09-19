// src/pages/admin/adminprinttemplate.jsx
import { useEffect, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase";

export default function AdminPrintTemplate({ permissions }) {
  const [templateConfig, setTemplateConfig] = useState({
    header: "MILLENNIUM INN",
    footer: "Thank you for staying with us!",
    showPaymentBreakdown: true,
    paymentTypes: ["Cash", "QRIS", "OTA", "Debit", "Credit"],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canManage = permissions?.includes("*") || permissions?.includes("canManageSettings");

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, "settings", "printTemplates"));
        if (snap.exists()) {
          setTemplateConfig((prev) => ({ ...prev, ...snap.data() }));
        }
      } catch (err) {
        console.error("Failed to load printTemplates:", err);
      } finally {
        setLoading(false);
      }
    }
    if (canManage) load();
  }, [canManage]);

  const saveTemplate = async () => {
    if (!canManage) return;
    setSaving(true);
    try {
      await setDoc(doc(db, "settings", "printTemplates"), templateConfig, { merge: true });
      alert("Print template updated");
    } catch (err) {
      console.error("Save failed:", err);
      alert("Failed to save template");
    } finally {
      setSaving(false);
    }
  };

  if (!canManage) return <>Access denied</>;
  if (loading) return <>Loading…</>;

  return (
    <div className="container">
        <h2>Print Template Settings</h2>

        <section className="card">
          <header className="card-header">
            <h3>General</h3>
          </header>
          <div className="card-body">
            <label>Header Text</label>
            <input
              type="text"
              value={templateConfig.header}
              onChange={(e) => setTemplateConfig({ ...templateConfig, header: e.target.value })}
            />

            <label style={{ marginTop: 12 }}>Footer Text</label>
            <input
              type="text"
              value={templateConfig.footer}
              onChange={(e) => setTemplateConfig({ ...templateConfig, footer: e.target.value })}
            />
          </div>
        </section>

        <section className="card">
          <header className="card-header">
            <h3>Payment Breakdown</h3>
          </header>
          <div className="card-body">
            <label>
              <input
                type="checkbox"
                checked={templateConfig.showPaymentBreakdown}
                onChange={(e) =>
                  setTemplateConfig({ ...templateConfig, showPaymentBreakdown: e.target.checked })
                }
              />{" "}
              Show totals by payment type
            </label>

            {templateConfig.showPaymentBreakdown && (
              <div style={{ marginTop: 12 }}>
                {templateConfig.paymentTypes.map((type, idx) => (
                 <div key={idx} style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
                    <input
                      type="text"
                      style={{ flex: 1 }}
                      value={type}
                      onChange={(e) => {
                        const updated = [...templateConfig.paymentTypes];
                        updated[idx] = e.target.value;
                        setTemplateConfig({ ...templateConfig, paymentTypes: updated });
                      }}
                    />
                    <button
                      style={{ marginLeft: 8, color: "red" }}
                      onClick={() => {
                        if (window.confirm(`Remove payment type "${type}"?`)) {
                          const updated = templateConfig.paymentTypes.filter((_, i) => i !== idx);
                          setTemplateConfig({ ...templateConfig, paymentTypes: updated });
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  style={{ marginTop: 8 }}
                  onClick={() =>
                    setTemplateConfig({
                      ...templateConfig,
                      paymentTypes: [...templateConfig.paymentTypes, "NewType"],
                    })
                  }
                >
                  Add Payment Type
                </button>
              </div>
            )}
          </div>
        </section>

        <button className="btn-primary" style={{ marginTop: 16 }} disabled={saving} onClick={saveTemplate}>
          {saving ? "Saving…" : "Save Template"}
        </button>
      </div>
  );
}
