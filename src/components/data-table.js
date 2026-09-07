import { renderCellValue } from "@/lib/utils/render-cell";
export { renderCellValue } from "@/lib/utils/render-cell";

export default function DataTable({ columns, rows, empty = "No records found" }) {
  return <div className="panel table-wrap">{rows.length ? <table><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={row.id || index}>{columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : renderCellValue(row[column.key])}</td>)}</tr>)}</tbody></table> : <div style={{ padding: 40, textAlign: "center" }} className="muted">{empty}</div>}</div>;
}
