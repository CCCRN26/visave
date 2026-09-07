CREATE TABLE group_members (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id),
 member_number INTEGER NOT NULL CHECK(member_number>0), member_code VARCHAR(100) NOT NULL, first_name VARCHAR(100) NOT NULL, middle_name VARCHAR(100), last_name VARCHAR(100) NOT NULL,
 sex VARCHAR(20) CHECK(sex IN ('FEMALE','MALE','OTHER','UNDISCLOSED')), date_of_birth DATE CHECK(date_of_birth IS NULL OR date_of_birth<=CURRENT_DATE), phone VARCHAR(30), date_joined DATE NOT NULL CHECK(date_joined<=CURRENT_DATE), linked_user_id UUID REFERENCES users(id),
 status VARCHAR(20) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE','LEFT','REMOVED','DECEASED')), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), archived_at TIMESTAMPTZ,
 UNIQUE(group_id,member_number), UNIQUE(group_id,member_code), UNIQUE(group_id,id), UNIQUE(organization_id,id)
);
CREATE INDEX group_members_group_status_idx ON group_members(group_id,status); CREATE INDEX group_members_org_idx ON group_members(organization_id); CREATE INDEX group_members_name_idx ON group_members(group_id,last_name,first_name);

CREATE TABLE group_constitutions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), version_number INTEGER NOT NULL CHECK(version_number>0), status VARCHAR(20) NOT NULL CHECK(status IN ('DRAFT','APPROVED','SUPERSEDED')),
 share_value NUMERIC(18,2) NOT NULL CHECK(share_value>0), min_shares_per_meeting INTEGER NOT NULL CHECK(min_shares_per_meeting>=1), max_shares_per_meeting INTEGER NOT NULL CHECK(max_shares_per_meeting<=5 AND max_shares_per_meeting>=min_shares_per_meeting), social_fund_contribution NUMERIC(18,2) NOT NULL CHECK(social_fund_contribution>=0),
 loan_max_multiple NUMERIC(5,2) NOT NULL CHECK(loan_max_multiple>0 AND loan_max_multiple<=3), loan_service_charge_rate NUMERIC(7,4) CHECK(loan_service_charge_rate IS NULL OR loan_service_charge_rate>=0), loan_max_term_months INTEGER NOT NULL CHECK(loan_max_term_months BETWEEN 1 AND 3), meeting_frequency VARCHAR(20) NOT NULL CHECK(meeting_frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')), loan_freeze_weeks_before_shareout INTEGER CHECK(loan_freeze_weeks_before_shareout IS NULL OR loan_freeze_weeks_before_shareout>=0), quorum_percentage NUMERIC(5,2) CHECK(quorum_percentage IS NULL OR quorum_percentage BETWEEN 0 AND 100), notes TEXT,
 approved_at TIMESTAMPTZ, approved_by UUID REFERENCES users(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(group_id,version_number), UNIQUE(group_id,id), UNIQUE(organization_id,id)
);
CREATE UNIQUE INDEX one_approved_constitution_per_group ON group_constitutions(group_id) WHERE status='APPROVED'; CREATE INDEX constitutions_group_status_idx ON group_constitutions(group_id,status);

CREATE TABLE constitution_fine_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), constitution_id UUID NOT NULL REFERENCES group_constitutions(id), code VARCHAR(50) NOT NULL, name VARCHAR(120) NOT NULL, description TEXT, amount NUMERIC(18,2) NOT NULL CHECK(amount>=0), status VARCHAR(20) NOT NULL CHECK(status IN ('ACTIVE','INACTIVE')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(constitution_id,code)
);

CREATE TABLE vsla_cycles (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), constitution_id UUID NOT NULL, cycle_number INTEGER NOT NULL CHECK(cycle_number>0), start_date DATE NOT NULL, expected_end_date DATE NOT NULL, expected_shareout_date DATE, meeting_day_of_week INTEGER CHECK(meeting_day_of_week BETWEEN 1 AND 7), status VARCHAR(20) NOT NULL CHECK(status IN ('DRAFT','READY','ACTIVE','CLOSING','CLOSED','CANCELLED')), activated_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 CHECK(expected_end_date>start_date), CHECK(expected_end_date<=start_date+INTERVAL '12 months'), CHECK(expected_shareout_date IS NULL OR expected_shareout_date BETWEEN start_date AND expected_end_date), UNIQUE(group_id,cycle_number), UNIQUE(group_id,id), UNIQUE(organization_id,id), FOREIGN KEY(group_id,constitution_id) REFERENCES group_constitutions(group_id,id)
);
CREATE UNIQUE INDEX one_active_cycle_per_group ON vsla_cycles(group_id) WHERE status='ACTIVE'; CREATE INDEX cycles_group_status_idx ON vsla_cycles(group_id,status);

CREATE TABLE group_officer_assignments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL, position_code VARCHAR(30) NOT NULL CHECK(position_code IN ('CHAIRPERSON','RECORD_KEEPER','BOX_KEEPER','MONEY_COUNTER_1','MONEY_COUNTER_2')), status VARCHAR(20) NOT NULL CHECK(status IN ('ACTIVE','ENDED','REMOVED')), appointed_at DATE, ended_at DATE, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), FOREIGN KEY(organization_id,member_id) REFERENCES group_members(organization_id,id), CHECK(ended_at IS NULL OR appointed_at IS NULL OR ended_at>=appointed_at)
);
CREATE UNIQUE INDEX one_active_officer_position ON group_officer_assignments(cycle_id,position_code) WHERE status='ACTIVE'; CREATE UNIQUE INDEX one_active_position_per_member ON group_officer_assignments(cycle_id,member_id) WHERE status='ACTIVE'; CREATE INDEX officers_group_cycle_idx ON group_officer_assignments(group_id,cycle_id,status);
