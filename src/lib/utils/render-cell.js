import { formatDate } from "./date.js";

export function renderCellValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return formatDate(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") return value;
  return "—";
}
