// src/pages/FolioTotals.jsx
import React, { useMemo } from "react";

export default function FolioTotals({
  postings = [],
  payments = [],
  isBooked = true,
  currency = "IDR",
  fmtMoney = (n) => (isNaN(n) ? "-" : Number(n).toLocaleString("id-ID")),
}) {
  const statusOf = (p) => ((p?.status || "") + "").toLowerCase();
  const acctOf = (p) => ((p?.accountCode || "") + "").toUpperCase();

  const visiblePostings = useMemo(() => postings.filter((p) => statusOf(p) !== "void"), [postings]);

  const lines = useMemo(() => {
    const targetStatus = isBooked ? "forecast" : "posted";
    return visiblePostings.filter((p) => statusOf(p) === targetStatus && acctOf(p) !== "PAY");
  }, [visiblePostings, isBooked]);

  const chargesTotal = useMemo(
    () => lines.reduce((s, p) => s + Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0), 0),
    [lines]
  );

  const paysTotal = useMemo(
    () => payments.filter((p) => statusOf(p) !== "void" && statusOf(p) !== "refunded").reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments]
  );

  const balance = chargesTotal - paysTotal;

  return (
    <div className="reservation-form folio" style={{ marginBottom: 12, width: "100%" }}>
      <h4 style={{ marginBottom: 8 }}>Folio</h4>

      <div className="folio-header">
        <div className="h-desc">Description</div>
        <div className="h-account">Account</div>
        <div className="h-status">Status</div>
        <div className="h-amount">Amount</div>
      </div>

      <div className="folio-lines">
        {lines.length === 0 ? (
          <div className="folio-empty">No charges yet.</div>
        ) : (
          lines.map((p) => (
            <div key={p.id} className="folio-line">
              <div className="f-desc">{p.description || "-"}</div>
              <div className="f-account">{acctOf(p)}</div>
              <div className="f-status">{p.status || "-"}</div>
              <div className="f-amount">
                {currency} {fmtMoney(Number(p.amount || 0) + Number(p.tax || 0) + Number(p.service || 0))}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="folio-totals">
        <div className="tot-row">
          <div className="t-label">Charges</div>
          <div className="t-value">{currency} {fmtMoney(chargesTotal)}</div>
        </div>
        <div className="tot-row">
          <div className="t-label">Payments</div>
          <div className="t-value">{currency} {fmtMoney(paysTotal)}</div>
        </div>
        <div className="tot-row grand">
          <div className="t-label">Balance</div>
          <div className="t-value">{currency} {fmtMoney(balance)}</div>
        </div>
      </div>
    </div>
  );
}
