const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const DATE_FORMATTER = new Intl.DateTimeFormat("en-NG", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-NG", {
  timeZone: "Africa/Lagos",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hourCycle: "h12",
});

function validParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateOnlyParts(value) {
  if (typeof value === "string") {
    const match = value.match(DATE_ONLY_PATTERN);
    if (!match) return null;
    const parts = match.slice(1).map(Number);
    return validParts(...parts) ? parts : null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return [value.getFullYear(), value.getMonth() + 1, value.getDate()];
  }
  return null;
}

export function formatDate(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const parts = dateOnlyParts(value);
  if (!parts) return fallback;
  return DATE_FORMATTER.format(new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])));
}

export function formatDateTime(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return DATE_TIME_FORMATTER.format(date);
}

export function formatDateForInput(value, fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  const parts = dateOnlyParts(value);
  if (!parts) return fallback;
  return parts.map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0")).join("-");
}
