import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { z } from "zod";
import {
  PHONE_VALIDATION_MESSAGE,
  requiredPhoneSchema,
  optionalPhoneSchema,
  sanitizePhoneInput,
} from "../src/lib/validation/phone.js";
import { joinRequestSchema } from "../src/modules/public/public.schemas.js";

test("required phone accepts exactly 11 digits and preserves a leading zero", () => {
  assert.equal(requiredPhoneSchema.parse("08031234567"), "08031234567");
});

test("required phone rejects 10 and 12 digits with the shared message", () => {
  for (const phone of ["0803123456", "080312345678"]) {
    const result = requiredPhoneSchema.safeParse(phone);
    assert.equal(result.success, false);
    assert.equal(result.error.issues[0].message, PHONE_VALIDATION_MESSAGE);
  }
});

test("required phone rejects letters and formatting characters", () => {
  for (const phone of ["0803ABC4567", "0803-123-4567"]) {
    assert.equal(requiredPhoneSchema.safeParse(phone).success, false);
  }
});

test("optional phone accepts blank but validates supplied values", () => {
  assert.equal(optionalPhoneSchema.parse(""), undefined);
  assert.equal(optionalPhoneSchema.parse("08031234567"), "08031234567");
  assert.equal(optionalPhoneSchema.safeParse("0803123456").success, false);
});

test("input sanitizer strips non-digits, caps length, and preserves leading zero", () => {
  assert.equal(sanitizePhoneInput("080312345678999"), "08031234567");
  assert.equal(sanitizePhoneInput("0803abc1234567"), "08031234567");
});

test("phone validation does not alter non-phone fields", () => {
  const schema = z.object({ phone: optionalPhoneSchema, accountNumber: z.string() });
  assert.equal(schema.parse({ phone: "", accountNumber: "ABC-123456789012" }).accountNumber, "ABC-123456789012");
});

test("direct join API payload cannot bypass required phone validation", () => {
  const payload = { firstName: "Ada", surname: "Okafor", phone: "080312345678999", stateId: crypto.randomUUID(), lgaId: crypto.randomUUID() };
  assert.equal(joinRequestSchema.safeParse(payload).success, false);
  const route = fs.readFileSync(new URL("../src/app/api/public/groups/[id]/join/route.js", import.meta.url), "utf8");
  assert.match(route, /parse\(joinRequestSchema,await r\.json\(\)\)/);
});
