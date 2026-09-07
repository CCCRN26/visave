import fs from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
if (!sourcePath) throw new Error("Usage: node scripts/generate-nigeria-geography.js <hierarchy.json>");

const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
const stateCodes = {
  Abia: "ABI", Adamawa: "ADA", "Akwa Ibom": "AKI", Anambra: "ANA", Bauchi: "BAU",
  Bayelsa: "BAY", Benue: "BEN", Borno: "BOR", "Cross River": "CRS", Delta: "DEL",
  Ebonyi: "EBO", Edo: "EDO", Ekiti: "EKI", Enugu: "ENU", "Federal Capital Territory": "FCT",
  Gombe: "GOM", Imo: "IMO", Jigawa: "JIG", Kaduna: "KAD", Kano: "KAN", Katsina: "KAT",
  Kebbi: "KEB", Kogi: "KOG", Kwara: "KWA", Lagos: "LAG", Nasarawa: "NAS", Niger: "NIG",
  Ogun: "OGU", Ondo: "OND", Osun: "OSU", Oyo: "OYO", Plateau: "PLA", Rivers: "RIV",
  Sokoto: "SOK", Taraba: "TAR", Yobe: "YOB", Zamfara: "ZAM",
};
const canonicalNames = new Map([
  ["Federal Capital Territory|Abuja Municipal", "Abuja Municipal Area Council"],
  ["Abia|Isiukwuato", "Isuikwuato"],
]);
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const states = source.data.map((state) => ({
  name: state.name.en,
  code: stateCodes[state.name.en],
  lgas: state.lga.map((lga) => ({
    name: canonicalNames.get(`${state.name.en}|${lga.name.en}`) || lga.name.en,
    code: lga.id,
  })),
}));

if (states.length !== 37) throw new Error(`Expected 37 State/FCT records, received ${states.length}`);
if (states.some((state) => !state.code)) throw new Error("Every State/FCT requires a stable code");
const lgaCount = states.reduce((total, state) => total + state.lgas.length, 0);
if (lgaCount !== 774) throw new Error(`Expected 774 LGAs/Area Councils, received ${lgaCount}`);
for (const state of states) {
  if (!state.lgas.length) throw new Error(`${state.name} has no LGAs`);
  if (new Set(state.lgas.map((lga) => lga.name)).size !== state.lgas.length) throw new Error(`${state.name} has duplicate LGA names`);
}

const canonicalPath = path.join(process.cwd(), "database", "data", "nigeria-geography.json");
fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
fs.writeFileSync(canonicalPath, `${JSON.stringify({ countryCode: "NG", states }, null, 2)}\n`);

const stateValues = states.map((state) => `  (${quote(state.name)},${quote(state.code)},'NG')`).join(",\n");
const lgaValues = states.flatMap((state) => state.lgas.map((lga) => `  (${quote(state.name)},${quote(lga.name)},${quote(lga.code)})`)).join(",\n");
const migration = `-- Generated from database/data/nigeria-geography.json by scripts/generate-nigeria-geography.js.
-- Canonical source: Open Admin Data Nigeria (CC-BY-4.0), normalized for application naming.

DO $$
DECLARE
  invalid_groups_state_lga integer;
  invalid_groups_lga_community integer;
  invalid_facilitators_state_lga integer;
  invalid_join_requests_state_lga integer := 0;
  invalid_join_requests_lga_community integer := 0;
BEGIN
  SELECT count(*) INTO invalid_groups_state_lga FROM vsla_groups g JOIN lgas l ON l.id=g.lga_id WHERE g.state_id IS DISTINCT FROM l.state_id;
  SELECT count(*) INTO invalid_groups_lga_community FROM vsla_groups g JOIN communities c ON c.id=g.community_id WHERE g.lga_id IS DISTINCT FROM c.lga_id;
  SELECT count(*) INTO invalid_facilitators_state_lga FROM facilitator_profiles fp JOIN lgas l ON l.id=fp.lga_id WHERE fp.state_id IS DISTINCT FROM l.state_id;
  IF to_regclass('vsla_join_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM vsla_join_requests jr JOIN lgas l ON l.id=jr.lga_id WHERE jr.state_id IS DISTINCT FROM l.state_id' INTO invalid_join_requests_state_lga;
    EXECUTE 'SELECT count(*) FROM vsla_join_requests jr JOIN communities c ON c.id=jr.community_id WHERE jr.lga_id IS DISTINCT FROM c.lga_id' INTO invalid_join_requests_lga_community;
  END IF;
  RAISE NOTICE 'Geography preflight counts: states=%, lgas=%, communities=%, groups=%',
    (SELECT count(*) FROM states WHERE country_code='NG'),
    (SELECT count(*) FROM lgas l JOIN states s ON s.id=l.state_id WHERE s.country_code='NG'),
    (SELECT count(*) FROM communities), (SELECT count(*) FROM vsla_groups);
  IF invalid_groups_state_lga + invalid_groups_lga_community + invalid_facilitators_state_lga + invalid_join_requests_state_lga + invalid_join_requests_lga_community > 0 THEN
    RAISE EXCEPTION 'Invalid geography relationships: group_state_lga=%, group_lga_community=%, facilitator_state_lga=%, join_state_lga=%, join_lga_community=%', invalid_groups_state_lga, invalid_groups_lga_community, invalid_facilitators_state_lga, invalid_join_requests_state_lga, invalid_join_requests_lga_community;
  END IF;
END $$;

INSERT INTO states(name,code,country_code) VALUES
${stateValues}
ON CONFLICT(country_code,name) DO UPDATE SET code=EXCLUDED.code,updated_at=now();

WITH canonical(state_name,lga_name,lga_code) AS (VALUES
${lgaValues}
)
INSERT INTO lgas(state_id,name,code)
SELECT s.id,c.lga_name,c.lga_code FROM canonical c JOIN states s ON s.country_code='NG' AND s.name=c.state_name
ON CONFLICT(state_id,name) DO UPDATE SET code=EXCLUDED.code,updated_at=now();

DO $$
DECLARE canonical_states integer; canonical_lgas integer;
BEGIN
  SELECT count(*) INTO canonical_states FROM states WHERE country_code='NG' AND code IN (${states.map((state) => quote(state.code)).join(",")});
  SELECT count(*) INTO canonical_lgas FROM lgas l JOIN states s ON s.id=l.state_id WHERE s.country_code='NG' AND l.code LIKE 'NG___%';
  IF canonical_states <> 37 OR canonical_lgas <> 774 THEN
    RAISE EXCEPTION 'Canonical Nigeria geography validation failed: states=%, lgas=%',canonical_states,canonical_lgas;
  END IF;
END $$;

ALTER TABLE lgas ADD CONSTRAINT lgas_id_state_unique UNIQUE(id,state_id);
ALTER TABLE communities ADD CONSTRAINT communities_id_lga_unique UNIQUE(id,lga_id);
ALTER TABLE vsla_groups ADD CONSTRAINT groups_lga_state_fk FOREIGN KEY(lga_id,state_id) REFERENCES lgas(id,state_id);
ALTER TABLE vsla_groups ADD CONSTRAINT groups_community_lga_fk FOREIGN KEY(community_id,lga_id) REFERENCES communities(id,lga_id);
ALTER TABLE facilitator_profiles ADD CONSTRAINT facilitator_lga_state_fk FOREIGN KEY(lga_id,state_id) REFERENCES lgas(id,state_id);
ALTER TABLE vsla_join_requests ADD CONSTRAINT join_requests_lga_state_fk FOREIGN KEY(lga_id,state_id) REFERENCES lgas(id,state_id);
ALTER TABLE vsla_join_requests ADD CONSTRAINT join_requests_community_lga_fk FOREIGN KEY(community_id,lga_id) REFERENCES communities(id,lga_id);
`;
fs.writeFileSync(path.join(process.cwd(), "database", "migrations", "035_nigeria_geography.sql"), migration);
console.log(JSON.stringify({ states: states.length, lgas: lgaCount, canonicalPath }, null, 2));
