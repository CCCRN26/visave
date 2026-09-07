DO $$
DECLARE g UUID; org UUID; actor UUID; constitution UUID; cycle UUID; i INTEGER; member UUID; positions TEXT[]:=ARRAY['CHAIRPERSON','RECORD_KEEPER','BOX_KEEPER','MONEY_COUNTER_1','MONEY_COUNTER_2'];
BEGIN
 UPDATE vsla_groups SET status='ONBOARDING',updated_at=now() WHERE group_code='CCCRN-NIG-MNA-0002' AND NOT EXISTS(SELECT 1 FROM vsla_cycles c WHERE c.group_id=vsla_groups.id AND c.status='ACTIVE');
 SELECT id,organization_id INTO g,org FROM vsla_groups WHERE group_code='CCCRN-NIG-MNA-0001';
 SELECT ur.user_id INTO actor FROM user_roles ur JOIN roles r ON r.id=ur.role_id JOIN users u ON u.id=ur.user_id WHERE r.code='SUPER_ADMIN' AND u.organization_id=org LIMIT 1;
 IF g IS NULL OR actor IS NULL THEN RETURN; END IF;
 UPDATE vsla_groups SET status='ONBOARDING',date_formed=COALESCE(date_formed,CURRENT_DATE-60),meeting_location=COALESCE(meeting_location,'Community Hall'),updated_at=now() WHERE id=g AND status<>'ACTIVE';
 FOR i IN 1..20 LOOP
   INSERT INTO group_members(organization_id,group_id,member_number,member_code,first_name,last_name,sex,date_joined,status,created_by)
   VALUES(org,g,i,'CCCRN-NIG-MNA-0001-'||lpad(i::text,3,'0'),'Demo'||i,'Member',CASE WHEN i<=14 THEN 'FEMALE' ELSE 'MALE' END,CURRENT_DATE-45,'ACTIVE',actor) ON CONFLICT(group_id,member_number) DO NOTHING;
 END LOOP;
 SELECT id INTO constitution FROM group_constitutions WHERE group_id=g AND version_number=1;
 IF constitution IS NULL THEN INSERT INTO group_constitutions(organization_id,group_id,version_number,status,share_value,min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,loan_max_multiple,loan_service_charge_rate,loan_max_term_months,meeting_frequency,approved_at,approved_by,created_by) VALUES(org,g,1,'APPROVED',1000,1,5,200,3,5,3,'WEEKLY',now(),actor,actor) RETURNING id INTO constitution; END IF;
 SELECT id INTO cycle FROM vsla_cycles WHERE group_id=g AND cycle_number=1;
 IF cycle IS NULL THEN INSERT INTO vsla_cycles(organization_id,group_id,constitution_id,cycle_number,start_date,expected_end_date,expected_shareout_date,meeting_day_of_week,status,created_by) VALUES(org,g,constitution,1,CURRENT_DATE,CURRENT_DATE+INTERVAL '11 months',CURRENT_DATE+INTERVAL '11 months',3,'READY',actor) RETURNING id INTO cycle; END IF;
 FOR i IN 1..5 LOOP SELECT id INTO member FROM group_members WHERE group_id=g AND member_number=i; INSERT INTO group_officer_assignments(organization_id,group_id,cycle_id,member_id,position_code,status,appointed_at,created_by) VALUES(org,g,cycle,member,positions[i],'ACTIVE',CURRENT_DATE,actor) ON CONFLICT DO NOTHING; END LOOP;
END $$;
