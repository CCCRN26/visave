import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { listMembers, findMember } from '../../src/modules/onboarding/onboarding.repository.js';
import { memberCycleHistory, memberCurrentCycleSummary } from '../../src/modules/onboarding/member-profile.repository.js';
import { listCycleParticipants } from '../../src/modules/cycle-participation/cycle-participation.repository.js';

export async function checkMembers(db, { groupA, c1, c2, c3, ids, organizationId, userId }) {
  const before = await listMembers(db, groupA);
  assert.equal(before.total, 5); // Multiple memberships alone never multiplied this query.
  for (const cycleId of [c1, c2]) {
    await db.query(`INSERT INTO group_officer_assignments
      (organization_id,group_id,cycle_id,member_id,position_code,status,created_by)
      VALUES($1,$2,$3,$4,'CHAIRPERSON','ACTIVE',$5)`,
    [organizationId, groupA, cycleId, ids.Amina, userId]);
  }
  const oldRows = (await db.query(`SELECT m.id FROM group_members m
    LEFT JOIN group_officer_assignments o ON o.member_id=m.id AND o.status='ACTIVE'
    WHERE m.group_id=$1`, [groupA])).rows;
  assert.equal(oldRows.length, 6);
  assert.equal(oldRows.filter(m => m.id === ids.Amina).length, 2);
  const result = await listMembers(db, groupA);
  assert.equal(result.total, 5);
  assert.equal(result.items.length, 5);
  assert.equal(new Set(result.items.map(m => m.id)).size, 5);
  const participants = await listCycleParticipants(db, groupA, c2);
  assert.equal(participants.length, 4);
  assert.equal(result.items.filter(m => m.id === ids.Grace).length, 1);
  assert.ok(!participants.some(m => m.member_id === ids.Grace));
  const paged = await listMembers(db, groupA, { pageSize: 2, page: 1 });
  const paged2 = await listMembers(db, groupA, { pageSize: 2, page: 2 });
  assert.equal(paged.total, 5);
  assert.equal(new Set([...paged.items, ...paged2.items].map(m => m.id)).size, 4);
  assert.equal((await listMembers(db, groupA, { search: 'Amina' })).total, 1);
  let rootRows;
  const capture = { query: async (...args) => { const r = await db.query(...args); rootRows = r.rows; return r; } };
  assert.equal((await findMember(capture, groupA, ids.Amina)).id, ids.Amina);
  assert.equal(rootRows.length, 1);
  await db.query(`INSERT INTO cycle_memberships(organization_id,group_id,cycle_id,member_id,participation_start_date,created_by)
    VALUES($1,$2,$3,$4,'2027-01-01',$5)`, [organizationId, groupA, c3, ids.Grace, userId]);
  assert.equal((await listMembers(db, groupA)).items.filter(m => m.id === ids.Grace).length, 1);
  assert.deepEqual((await memberCycleHistory(db, groupA, ids.Grace)).map(c => c.participates), [true, false, true]);
  assert.deepEqual(await memberCurrentCycleSummary(db, groupA, ids.Amina),
    { shares: 0, savings: '0.00', social: '0.00', fines: '0.00', loans: 0 });

  // Temporary financial tables isolate read semantics from posting workflows, which have separate acceptance suites.
  await db.query('BEGIN');
  try {
    for (const table of ['savings_transactions', 'social_fund_transactions', 'fine_transactions']) {
      await db.query(`CREATE TEMP TABLE ${table} (group_id uuid,member_id uuid,cycle_id uuid,transaction_kind text,shares int,amount numeric) ON COMMIT DROP`);
    }
    await db.query('CREATE TEMP TABLE loans (group_id uuid,member_id uuid,cycle_id uuid,voided_at timestamptz) ON COMMIT DROP');
    for (const [cycleId, amount] of [[c1, 9000], [c2, 100]]) {
      for (const [table, kind] of [['savings_transactions', 'PURCHASE'], ['social_fund_transactions', 'CONTRIBUTION'], ['fine_transactions', 'FINE']]) {
        await db.query(`INSERT INTO ${table} VALUES($1,$2,$3,$4,1,$5)`, [groupA, ids.Amina, cycleId, kind, amount]);
      }
      await db.query('INSERT INTO loans VALUES($1,$2,$3,NULL)', [groupA, ids.Amina, cycleId]);
    }
    assert.deepEqual(await memberCurrentCycleSummary(db, groupA, ids.Amina),
      { shares: 1, savings: '100.00', social: '100.00', fines: '100.00', loans: 1 });
    await db.query('DELETE FROM savings_transactions WHERE cycle_id=$1', [c2]);
    assert.deepEqual(await memberCurrentCycleSummary(db, groupA, ids.Amina),
      { shares: 0, savings: '0.00', social: '100.00', fines: '100.00', loans: 1 });
    await db.query("UPDATE vsla_cycles SET status='CLOSED' WHERE id=$1", [c2]);
    assert.deepEqual(await memberCurrentCycleSummary(db, groupA, ids.Amina),
      { shares: 0, savings: '0.00', social: '0.00', fines: '0.00', loans: 0 });
  } finally { await db.query('ROLLBACK'); }

  // Execute the actual table component and inspect its React row keys and rendered output.
  const { transform, loadBindings } = await import('next/dist/build/swc/index.js'); await loadBindings();
  const source = await readFile('src/components/data-table.js', 'utf8');
  const { code } = await transform(source, {
    filename: 'data-table.js', jsc: { parser: { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'classic' } }, target: 'es2022' }, module: { type: 'commonjs' },
  });
  const React = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const cell = await import('../../src/lib/utils/render-cell.js');
  const exports = {};
  new Function('exports', 'require', 'React', code)(exports, () => cell, React);
  const tree = exports.default({ rows: result.items, columns: [{ key: 'first_name', label: 'Name' }] });
  const rowElements = tree.props.children.props.children[1].props.children;
  assert.deepEqual(rowElements.map(row => row.key), result.items.map(m => m.id));
  assert.equal(new Set(rowElements.map(row => row.key)).size, 5);
  const html = renderToStaticMarkup(tree);
  assert.equal((html.match(/Amina/g) || []).length, 1);
  assert.equal((html.match(/Grace/g) || []).length, 1);
  return { oldRows: 6, fixedRows: 5, participants: 4, skipped: 'Grace once', returning: 'Grace once', profileRoots: 1, financialTotals: 'PASS', reactKeys: 'PASS' };
}
