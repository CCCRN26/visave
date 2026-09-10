import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const component = read("src/components/botpress-chat.js");
const layout = read("src/app/layout.js");
const config = read("next.config.mjs");

test("Botpress uses the two supervisor-supplied scripts without embedding secrets", () => {
  assert.match(component, /https:\/\/cdn\.botpress\.cloud\/webchat\/v5\.0\/inject\.js/);
  assert.match(component, /https:\/\/files\.bpcontent\.cloud\/2026\/09\/08\/09\/20260908092232-PSZYFODV\.js/);
  assert.doesNotMatch(component, /DATABASE_URL|password|secret|auth(?:entication)?Token|sessionId/i);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML|iframe/i);
});

test("root layout mounts one Botpress component for all routes", () => {
  assert.equal((layout.match(/<BotpressChat\s*\/>/g) || []).length, 1);
  assert.match(layout, /<body>\{children\}<BotpressChat\/><\/body>/);
  assert.match(component, /strategy="lazyOnload"/);
  assert.match(component, /onLoad=\{\(\) => setInjectReady\(true\)\}/);
});

test("CSP narrowly permits required Botpress runtime origins", () => {
  assert.match(config, /script-src[^\n]+https:\/\/cdn\.botpress\.cloud https:\/\/files\.bpcontent\.cloud/);
  assert.match(config, /connect-src 'self' https:\/\/webchat\.botpress\.cloud https:\/\/us\.i\.posthog\.com https:\/\/cdn\.jsdelivr\.net/);
  assert.match(config, /style-src[^\n]+https:\/\/fonts\.googleapis\.com/);
  assert.match(config, /font-src[^\n]+https:\/\/fonts\.gstatic\.com/);
  assert.match(config, /img-src[^\n]+https:\/\/files\.bpcontent\.cloud https:\/\/cdn\.jsdelivr\.net/);
  assert.doesNotMatch(config, /(?:script|connect|img|style|font|frame)-src[^\n]*\s\*/);
});

test("existing security directives and Next.js header controls remain intact", () => {
  assert.match(config, /frame-ancestors 'none'/);
  assert.match(config, /base-uri 'self'/);
  assert.match(config, /form-action 'self'/);
  assert.match(config, /poweredByHeader:\s*false/);
  for (const header of ["X-Content-Type-Options", "Referrer-Policy", "X-Frame-Options", "Permissions-Policy", "Strict-Transport-Security"]) assert.ok(config.includes(header));
});
