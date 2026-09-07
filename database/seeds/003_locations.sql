-- Full canonical Nigeria geography is installed idempotently by migration 035.
-- Keep the migration as the single SQL source instead of duplicating 774 rows here.
DO $$
DECLARE state_count integer; lga_count integer;
BEGIN
  SELECT count(*) INTO state_count FROM states WHERE country_code='NG' AND code IN
    ('ABI','ADA','AKI','ANA','BAU','BAY','BEN','BOR','CRS','DEL','EBO','EDO','EKI','ENU','FCT','GOM','IMO','JIG','KAD','KAN','KAT','KEB','KOG','KWA','LAG','NAS','NIG','OGU','OND','OSU','OYO','PLA','RIV','SOK','TAR','YOB','ZAM');
  SELECT count(*) INTO lga_count FROM lgas l JOIN states s ON s.id=l.state_id
    WHERE s.country_code='NG' AND l.code LIKE 'NG___%';
  IF state_count <> 37 OR lga_count <> 774 THEN
    RAISE EXCEPTION 'Canonical Nigeria geography is incomplete; run migration 035 first (states=%, lgas=%)',state_count,lga_count;
  END IF;
END $$;
