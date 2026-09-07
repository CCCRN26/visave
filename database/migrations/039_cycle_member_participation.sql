CREATE TABLE cycle_memberships (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL,
 participation_start_date DATE NOT NULL, participation_end_date DATE, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(cycle_id,member_id), UNIQUE(id,group_id,cycle_id,member_id), FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id),
 FOREIGN KEY(organization_id,cycle_id) REFERENCES vsla_cycles(organization_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES group_members(organization_id,id), CHECK(participation_end_date IS NULL OR participation_end_date>=participation_start_date)
);
CREATE INDEX cycle_memberships_cycle_idx ON cycle_memberships(cycle_id);
CREATE INDEX cycle_memberships_member_idx ON cycle_memberships(member_id);
CREATE INDEX cycle_memberships_group_idx ON cycle_memberships(group_id);
CREATE FUNCTION validate_cycle_membership_dates() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cycle_start DATE; cycle_end DATE; joined DATE;
BEGIN
 SELECT start_date,expected_end_date INTO cycle_start,cycle_end FROM vsla_cycles WHERE id=NEW.cycle_id AND group_id=NEW.group_id;
 SELECT date_joined INTO joined FROM group_members WHERE id=NEW.member_id AND group_id=NEW.group_id;
 IF cycle_start IS NULL OR joined IS NULL OR NEW.participation_start_date<cycle_start OR NEW.participation_start_date>cycle_end OR NEW.participation_start_date<joined OR (NEW.participation_end_date IS NOT NULL AND NEW.participation_end_date>cycle_end) THEN
  RAISE EXCEPTION 'invalid cycle participation dates' USING ERRCODE='23514',CONSTRAINT='cycle_memberships_date_range';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER cycle_memberships_validate_dates BEFORE INSERT OR UPDATE ON cycle_memberships FOR EACH ROW EXECUTE FUNCTION validate_cycle_membership_dates();
WITH evidence AS (
 SELECT cycle_id,member_id FROM savings_transactions UNION SELECT cycle_id,member_id FROM social_fund_transactions UNION SELECT cycle_id,member_id FROM fine_transactions
 UNION SELECT cycle_id,member_id FROM loan_requests UNION SELECT cycle_id,member_id FROM loans UNION SELECT cycle_id,member_id FROM loan_repayments
 UNION SELECT cycle_id,member_id FROM group_officer_assignments UNION SELECT cycle_id,member_id FROM cycle_shareout_entitlements UNION SELECT cycle_id,member_id FROM shareout_payouts
 UNION SELECT cycle_id,member_id FROM meeting_attendance
 UNION SELECT c.id,m.id FROM vsla_cycles c JOIN group_members m ON m.group_id=c.group_id AND m.status='ACTIVE' WHERE c.status='ACTIVE'
)
INSERT INTO cycle_memberships(organization_id,group_id,cycle_id,member_id,participation_start_date,created_by)
SELECT c.organization_id,c.group_id,c.id,m.id,GREATEST(c.start_date,m.date_joined),COALESCE(c.created_by,m.created_by)
FROM evidence e JOIN vsla_cycles c ON c.id=e.cycle_id JOIN group_members m ON m.id=e.member_id AND m.group_id=c.group_id
WHERE GREATEST(c.start_date,m.date_joined)<=c.expected_end_date ON CONFLICT(cycle_id,member_id) DO NOTHING;
