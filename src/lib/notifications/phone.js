/** Transport-only Nigerian number normalization. Stored member details are never changed. */
export function normalizeNigerianPhone(value) {
  if (typeof value !== "string") return null;
  const phone = value.trim();
  if (/^0[789]\d{9}$/.test(phone)) return `+234${phone.slice(1)}`;
  if (/^\+234[789]\d{9}$/.test(phone)) return phone;
  return null;
}
