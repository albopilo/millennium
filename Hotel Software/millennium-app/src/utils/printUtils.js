// src/utils/printUtils.js
export function replacePlaceholders(html = "", data = {}) {
  if (!html) return "";
  return html.replace(/{{\s*([^}]+)\s*}}/g, (_, key) => {
    const k = key.trim();
    return data[k] !== undefined && data[k] !== null ? String(data[k]) : "";
  });
}
