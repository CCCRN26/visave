import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { openMeetingSchema } from "../src/modules/meetings/meeting.schemas.js";
import { isGoogleMeetUrl, normalizeGoogleMeetUrl } from "../src/modules/meetings/meeting-url.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const meetingDate = "2026-09-25";
const validMeetUrl = "https://meet.google.com/abc-defg-hij";

test("legacy and explicit physical meetings remain physical without a Meet URL", () => {
  assert.deepEqual(openMeetingSchema.parse({ meetingDate }), {
    meetingDate,
    meetingMode: "PHYSICAL",
    virtualMeetingUrl: null,
  });
  assert.deepEqual(
    openMeetingSchema.parse({
      meetingDate,
      meetingMode: "PHYSICAL",
      virtualMeetingUrl: "https://example.com/stale",
    }),
    { meetingDate, meetingMode: "PHYSICAL", virtualMeetingUrl: null },
  );

  const migration = read("../database/migrations/050_virtual_meeting_metadata.sql");
  assert.match(migration, /meeting_mode VARCHAR\(8\) NOT NULL DEFAULT 'PHYSICAL'/);
  assert.match(migration, /meeting_mode IN \('PHYSICAL', 'VIRTUAL', 'HYBRID'\)/);
});

test("virtual and hybrid meetings accept and normalize valid Google Meet links", () => {
  for (const meetingMode of ["VIRTUAL", "HYBRID"]) {
    const parsed = openMeetingSchema.parse({
      meetingDate,
      meetingMode,
      virtualMeetingUrl: `  ${validMeetUrl}?authuser=0#fragment  `,
    });
    assert.equal(parsed.meetingMode, meetingMode);
    assert.equal(parsed.virtualMeetingUrl, `${validMeetUrl}?authuser=0`);
  }
  assert.equal(normalizeGoogleMeetUrl(validMeetUrl), validMeetUrl);
});

test("virtual and hybrid meetings require a valid HTTPS meet.google.com meeting code", () => {
  for (const meetingMode of ["VIRTUAL", "HYBRID"]) {
    assert.equal(openMeetingSchema.safeParse({ meetingDate, meetingMode }).success, false);
  }

  for (const virtualMeetingUrl of [
    "https://example.com/test",
    "http://meet.google.com/abc-defg-hij",
    "https://meet.google.com/",
    "https://meet.google.com.evil.example/abc-defg-hij",
    "javascript:alert(1)",
    "not a URL",
  ]) {
    assert.equal(
      openMeetingSchema.safeParse({ meetingDate, meetingMode: "VIRTUAL", virtualMeetingUrl }).success,
      false,
      virtualMeetingUrl,
    );
    assert.equal(isGoogleMeetUrl(virtualMeetingUrl), false, virtualMeetingUrl);
  }
});

test("existing group authorization guards both meeting creation and Meet link reads", () => {
  const collectionRoute = read("../src/app/api/v1/groups/[id]/meetings/route.js");
  const detailRoute = read("../src/app/api/v1/groups/[id]/meetings/[meetingId]/route.js");
  const detailPage = read("../src/app/(protected)/groups/[id]/meetings/[meetingId]/page.js");

  assert.match(collectionRoute, /GROUP_ACTION\.MEETING_OPERATE/);
  assert.match(detailRoute, /GROUP_ACTION\.MEETING_VIEW/);
  assert.match(detailPage, /GROUP_ACTION\.MEETING_VIEW/);
  assert.match(detailPage, /target="_blank" rel="noopener noreferrer"/);
  assert.match(detailPage, /isGoogleMeetUrl\(data\.meeting\.virtual_meeting_url\)/);
});

test("meeting mode remains communication metadata and the existing lifecycle stays intact", () => {
  const service = read("../src/modules/meetings/meeting.service.js");
  assert.match(service, /meeting_mode,virtual_meeting_url,status/);
  assert.match(service, /'OPEN'/);
  assert.match(service, /INSERT INTO meeting_attendance/);
  assert.match(service, /status='CLOSED'/);
  assert.match(service, /virtual_meeting_url:m\.virtual_meeting_url\?'\[REDACTED\]'/);
  assert.doesNotMatch(service, /fetch\(|googleapis|Google Calendar|OAuth/i);
  assert.doesNotMatch(service, /if\s*\(data\.meetingMode/);
});
