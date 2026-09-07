import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { cycleSchema } from '../src/modules/onboarding/onboarding.schemas.js';

test('cycle setup accepts optional blank browser form fields', () => {
  const result = cycleSchema.safeParse({ constitutionId: crypto.randomUUID(), cycleNumber: '1', startDate: '2026-08-24', expectedEndDate: '2027-08-23', expectedShareoutDate: '', meetingDayOfWeek: '', status: 'READY' });
  assert.equal(result.success, true);
  assert.equal(result.data.expectedShareoutDate, undefined);
  assert.equal(result.data.meetingDayOfWeek, undefined);
});

test('cycle setup still rejects invalid date order', () => {
  assert.equal(cycleSchema.safeParse({ constitutionId: crypto.randomUUID(), cycleNumber: 1, startDate: '2026-08-24', expectedEndDate: '2026-08-23' }).success, false);
});

test('Agent setup permission migration grants only constitution approval', () => {
  const sql = fs.readFileSync(new URL('../database/migrations/031_agent_program_assisted_setup_permissions.sql', import.meta.url), 'utf8');
  assert.match(sql, /constitution\.approve/);
  assert.doesNotMatch(sql, /financial\.|loan\.|shareout\./);
});

test('Agent setup service enforces assignment, active status, scope, and mode', () => {
  const source = fs.readFileSync(new URL('../src/modules/group-access/group-access.service.js', import.meta.url), 'utf8');
  for (const guard of ['is_assigned_facilitator', 'is_active_facilitator', 'has_facilitator_scope', "operation_mode!=='PROGRAM_ASSISTED'"]) assert.match(source, new RegExp(guard));
});
