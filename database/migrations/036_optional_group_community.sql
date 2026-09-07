ALTER TABLE vsla_groups ADD COLUMN community_name TEXT;

UPDATE vsla_groups g
SET community_name=c.name
FROM communities c
WHERE g.community_id=c.id AND g.community_name IS NULL;

DO $$
DECLARE missing_state integer; missing_lga integer;
BEGIN
  SELECT count(*) INTO missing_state FROM vsla_groups WHERE state_id IS NULL;
  SELECT count(*) INTO missing_lga FROM vsla_groups WHERE lga_id IS NULL;
  IF missing_state > 0 OR missing_lga > 0 THEN
    RAISE EXCEPTION 'Cannot require group State/LGA: missing_state=%, missing_lga=%',missing_state,missing_lga;
  END IF;
END $$;

ALTER TABLE vsla_groups ALTER COLUMN state_id SET NOT NULL;
ALTER TABLE vsla_groups ALTER COLUMN lga_id SET NOT NULL;

