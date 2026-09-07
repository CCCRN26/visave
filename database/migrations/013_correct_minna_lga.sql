DO $$
DECLARE bad_id UUID; correct_id UUID;
BEGIN
  SELECT id INTO bad_id FROM lgas WHERE name='Minna' AND state_id=(SELECT id FROM states WHERE name='Niger' AND country_code='NG');
  SELECT id INTO correct_id FROM lgas WHERE name='Chanchaga' AND state_id=(SELECT id FROM states WHERE name='Niger' AND country_code='NG');
  IF bad_id IS NOT NULL AND correct_id IS NOT NULL THEN
    UPDATE communities SET lga_id=correct_id,updated_at=now() WHERE lga_id=bad_id;
    UPDATE facilitator_profiles SET lga_id=correct_id,updated_at=now() WHERE lga_id=bad_id;
    UPDATE vsla_groups SET lga_id=correct_id,updated_at=now() WHERE lga_id=bad_id;
    DELETE FROM lgas WHERE id=bad_id;
  END IF;
END $$;
