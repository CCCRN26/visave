SELECT
  (SELECT count(*) FROM states WHERE country_code='NG') AS states_fct,
  (SELECT count(*) FROM lgas l JOIN states s ON s.id=l.state_id WHERE s.country_code='NG') AS lgas,
  (SELECT count(*) FROM communities) AS communities,
  (SELECT count(*) FROM vsla_groups) AS groups;

SELECT id,name,code,'UNEXPECTED_STATE' AS diagnostic
FROM states WHERE country_code='NG' AND code NOT IN
  ('ABI','ADA','AKI','ANA','BAU','BAY','BEN','BOR','CRS','DEL','EBO','EDO','EKI','ENU','FCT','GOM','IMO','JIG','KAD','KAN','KAT','KEB','KOG','KWA','LAG','NAS','NIG','OGU','OND','OSU','OYO','PLA','RIV','SOK','TAR','YOB','ZAM');
SELECT l.id,s.name AS state,l.name,l.code,'UNEXPECTED_LGA' AS diagnostic
FROM lgas l JOIN states s ON s.id=l.state_id WHERE s.country_code='NG' AND l.code NOT LIKE 'NG___%';

SELECT g.id,g.group_code,g.state_id,g.lga_id,l.state_id AS lga_state_id
FROM vsla_groups g JOIN lgas l ON l.id=g.lga_id WHERE g.state_id IS DISTINCT FROM l.state_id;
SELECT g.id,g.group_code,g.lga_id,g.community_id,c.lga_id AS community_lga_id
FROM vsla_groups g JOIN communities c ON c.id=g.community_id WHERE g.lga_id IS DISTINCT FROM c.lga_id;
SELECT fp.id,fp.user_id,fp.state_id,fp.lga_id,l.state_id AS lga_state_id
FROM facilitator_profiles fp JOIN lgas l ON l.id=fp.lga_id WHERE fp.state_id IS DISTINCT FROM l.state_id;
SELECT jr.id,jr.reference_code,jr.state_id,jr.lga_id,l.state_id AS lga_state_id
FROM vsla_join_requests jr JOIN lgas l ON l.id=jr.lga_id WHERE jr.state_id IS DISTINCT FROM l.state_id;
SELECT jr.id,jr.reference_code,jr.lga_id,jr.community_id,c.lga_id AS community_lga_id
FROM vsla_join_requests jr JOIN communities c ON c.id=jr.community_id WHERE jr.lga_id IS DISTINCT FROM c.lga_id;
