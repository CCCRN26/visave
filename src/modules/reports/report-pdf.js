import PDFDocument from "pdfkit";
import fs from "node:fs";
import path from "node:path";
import { cents } from "./cycle-report.service";

const naira = (value) => `NGN ${Number(value || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (value, fallback = "Not available") => value === null || value === undefined || value === "" ? fallback : String(value);
const date = (value) => value ? String(value).slice(0, 10) : "Not available";

export function createPdf(report, title) {
  const doc = new PDFDocument({ size: "A4", margin: 42, bufferPages: true, info: { Title: `Visave ${title}`, Author: "Visave" } });
  const chunks = []; doc.on("data", (chunk) => chunks.push(chunk));
  const logo = path.join(process.cwd(), "public", "cccrn-logo.png");
  if (fs.existsSync(logo)) doc.image(logo, 42, 35, { fit: [48, 42] });
  doc.fillColor("#143d38").fontSize(18).text("Visave", 98, 39).fontSize(12).text(title, 98, 62);
  doc.fillColor("#333333").fontSize(8).text(`${report.metadata.groupName} · ${report.metadata.groupCode} · Cycle ${report.metadata.cycleNumber}`, 42, 91);
  doc.text(`Generated ${report.metadata.generatedAt} by ${report.metadata.generatedBy?.name || report.metadata.generatedBy?.email || "Authorized user"}`, 42, 103);
  doc.moveTo(42, 118).lineTo(553, 118).strokeColor("#c8d5d0").stroke(); doc.y = 132;
  return { doc, done: new Promise((resolve, reject) => { doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); }) };
}
export function section(doc, title) { if (doc.y > 710) doc.addPage(); doc.moveDown(.5).fillColor("#143d38").fontSize(12).text(title).fillColor("#333333").fontSize(8).moveDown(.35); }
export function keyValues(doc, pairs) { for (const [label, value, isMoney] of pairs) { if (doc.y > 740) doc.addPage(); doc.font("Helvetica-Bold").text(`${label}: `, { continued: true }).font("Helvetica").text(isMoney ? naira(value) : text(value)); } }
export function table(doc, headers, rows, widths) {
  const total = widths.reduce((a, b) => a + b, 0); const x = 42; const rowHeight = 17;
  const drawHeader = () => { if (doc.y > 730) doc.addPage(); const y = doc.y; doc.rect(x, y, total, rowHeight).fill("#143d38"); doc.fillColor("white").font("Helvetica-Bold").fontSize(7); let at = x + 3; headers.forEach((h, i) => { doc.text(h, at, y + 5, { width: widths[i] - 6, height: 8, ellipsis: true }); at += widths[i]; }); doc.fillColor("#333333").font("Helvetica"); doc.y = y + rowHeight; };
  drawHeader(); if (!rows.length) { doc.text("None recorded"); return; }
  rows.forEach((row, index) => { if (doc.y > 735) drawHeader(); const y = doc.y; if (index % 2) doc.rect(x, y, total, rowHeight).fill("#f3f7f5"); doc.fillColor("#333333").fontSize(7); let at = x + 3; row.forEach((value, i) => { doc.text(text(value, "—"), at, y + 5, { width: widths[i] - 6, height: 8, ellipsis: true }); at += widths[i]; }); doc.y = y + rowHeight; });
}
export function finishPdf(doc) { const pages = doc.bufferedPageRange(); for (let i = 0; i < pages.count; i += 1) { doc.switchToPage(i); doc.fillColor("#66756f").fontSize(7).text(`Visave · Page ${i + 1} of ${pages.count}`, 42, 800, { width: 511, align: "center" }); } doc.end(); }
export { naira, date, text };
