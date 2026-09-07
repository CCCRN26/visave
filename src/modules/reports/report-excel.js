import ExcelJS from "exceljs";

export const CURRENCY_FORMAT = '₦#,##0.00;[Red]-₦#,##0.00';
export const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF143D38" } };
export const SECTION_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9F1ED" } };
export const currency = (value) => value === null || value === undefined ? "Not available" : Number(value);
export const display = (value, fallback = "Not available") => value === null || value === undefined || value === "" ? fallback : value;

export function createReportWorkbook(generatedAt) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Visave";
  workbook.created = new Date(generatedAt);
  workbook.modified = new Date(generatedAt);
  workbook.properties.date1904 = false;
  return workbook;
}

export function addHeading(sheet, lines, width) {
  const lastColumn = Math.max(2, width);
  lines.forEach((line, index) => {
    const rowNumber = index + 1;
    sheet.mergeCells(rowNumber, 1, rowNumber, lastColumn);
    sheet.getCell(rowNumber, 1).value = line;
  });
  sheet.getCell(1, 1).font = { bold: true, size: 16, color: { argb: "FF143D38" } };
  sheet.getRow(3).font = { italic: true, color: { argb: "FF5E6F69" } };
}

export function writeTable(sheet, columns, data, options = {}) {
  const headerRow = options.headerRow || 5;
  const header = sheet.getRow(headerRow);
  columns.forEach((column, index) => {
    header.getCell(index + 1).value = column.header;
    sheet.getColumn(index + 1).width = column.width || 16;
  });
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  data.forEach((item) => {
    const row = sheet.addRow(columns.map((column) => column.value ? column.value(item) : item[column.key]));
    row.alignment = { vertical: "top", wrapText: true };
    columns.forEach((column, index) => {
      if (column.currency && typeof row.getCell(index + 1).value === "number") row.getCell(index + 1).numFmt = CURRENCY_FORMAT;
      if (column.percent && typeof row.getCell(index + 1).value === "number") row.getCell(index + 1).numFmt = "0.00%";
    });
  });
  if (options.totalRow) {
    const total = sheet.addRow(columns.map((column) => options.totalRow[column.key] ?? ""));
    total.font = { bold: true };
    total.fill = SECTION_FILL;
    columns.forEach((column, index) => {
      if (column.currency && typeof total.getCell(index + 1).value === "number") total.getCell(index + 1).numFmt = CURRENCY_FORMAT;
    });
  }
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: columns.length } };
  return sheet;
}

export function writeKeyValueSections(sheet, sections, startRow = 5) {
  sheet.getColumn(1).width = 38;
  sheet.getColumn(2).width = 34;
  let rowNumber = startRow;
  for (const section of sections) {
    const sectionRow = sheet.getRow(rowNumber++);
    sheet.mergeCells(sectionRow.number, 1, sectionRow.number, 2);
    sectionRow.getCell(1).value = section.title;
    sectionRow.font = { bold: true, color: { argb: "FF143D38" } };
    sectionRow.fill = SECTION_FILL;
    for (const item of section.rows) {
      const row = sheet.getRow(rowNumber++);
      row.getCell(1).value = item[0];
      row.getCell(2).value = item[2] === "currency" ? currency(item[1]) : display(item[1]);
      row.getCell(1).font = { bold: true };
      row.alignment = { vertical: "top", wrapText: true };
      if (item[2] === "currency" && typeof row.getCell(2).value === "number") row.getCell(2).numFmt = CURRENCY_FORMAT;
      if (item[2] === "percent" && typeof item[1] === "number") {
        row.getCell(2).value = item[1] / 100;
        row.getCell(2).numFmt = "0.00%";
      }
    }
    rowNumber += 1;
  }
  return sheet;
}

export function safeFilenamePart(value) {
  return String(value).trim().replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
}
