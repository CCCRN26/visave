import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync(new URL('../.env',import.meta.url),'utf8').split(/\r?\n/)) {
  const match=line.match(/^([^#][^=]*)=(.*)$/);
  if (match&&!process.env[match[1].trim()]) process.env[match[1].trim()]=match[2].trim().replace(/^"|"$/g,'');
}

const page=fs.readFileSync(new URL('../src/app/(protected)/groups/[id]/page.js',import.meta.url),'utf8');
const queryMatch=page.match(/const \[community\] = await query\(`([^`]+)`/);

test('Group Detail community query parses and applies free-text, legacy, and null fallback',async()=>{
  assert.ok(queryMatch,'Group Detail community SQL was not found');
  const sql=queryMatch[1];
  assert.match(sql,/COALESCE\(NULLIF\(TRIM\(g\.community_name\), ''\), c\.name\) AS community_display_name/);

  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE communities(id uuid PRIMARY KEY,name text) ON COMMIT DROP');
    await client.query('CREATE TEMP TABLE vsla_groups(id uuid PRIMARY KEY,community_name text,community_id uuid) ON COMMIT DROP');
    await client.query(`INSERT INTO communities(id,name) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Legacy Community')`);
    await client.query(`INSERT INTO vsla_groups(id,community_name,community_id) VALUES
      ('11111111-1111-4111-8111-111111111111','Nkaliki Village',NULL),
      ('22222222-2222-4222-8222-222222222222',NULL,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      ('33333333-3333-4333-8333-333333333333',NULL,NULL)`);

    const values=[];
    for (const id of [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]) values.push((await client.query(sql,[id])).rows[0]?.community_display_name??null);

    assert.deepEqual(values,['Nkaliki Village','Legacy Community',null]);
  } finally {
    await client.query('ROLLBACK').catch(()=>{});
    await client.end();
  }
});
