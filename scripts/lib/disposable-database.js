const ALLOWED_DATABASES = new Set([
  "cccrn_vsla_acceptance",
  "cccrn_vsla_upgrade_acceptance",
]);

export function requireDisposableDatabaseName(value) {
  const name = String(value || "").trim();
  if (!name) throw new Error("A disposable database name is required");
  if (!ALLOWED_DATABASES.has(name)) {
    throw new Error(`Refusing non-disposable database target: ${name}`);
  }
  return name;
}

export function databaseUrlFor(sourceUrl, databaseName) {
  const target = requireDisposableDatabaseName(databaseName);
  const url = new URL(sourceUrl);
  url.pathname = `/${target}`;
  return url;
}
