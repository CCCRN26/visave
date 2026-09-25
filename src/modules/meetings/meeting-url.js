const GOOGLE_MEET_CODE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/i;

export function normalizeGoogleMeetUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (
      url.protocol !== "https:" ||
      url.hostname !== "meet.google.com" ||
      url.port ||
      url.username ||
      url.password ||
      pathParts.length !== 1 ||
      !GOOGLE_MEET_CODE.test(pathParts[0])
    ) {
      return null;
    }

    url.pathname = `/${pathParts[0].toLowerCase()}`;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function isGoogleMeetUrl(value) {
  return normalizeGoogleMeetUrl(value) !== null;
}
