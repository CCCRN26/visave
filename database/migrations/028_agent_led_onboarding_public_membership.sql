ALTER TABLE vsla_groups
  ADD COLUMN created_by_facilitator_id UUID REFERENCES facilitator_profiles(id),
  ADD COLUMN expected_member_count INTEGER CHECK(expected_member_count IS NULL OR expected_member_count BETWEEN 15 AND 30),
  ADD COLUMN onboarding_notes TEXT,
  ADD COLUMN public_visibility VARCHAR(10) NOT NULL DEFAULT 'HIDDEN' CHECK(public_visibility IN('HIDDEN','VISIBLE')),
  ADD COLUMN membership_intake_status VARCHAR(24) NOT NULL DEFAULT 'CLOSED' CHECK(membership_intake_status IN('CLOSED','OPEN','OPEN_FOR_NEXT_CYCLE','WAITLIST_ONLY'));
CREATE INDEX groups_public_location_idx ON vsla_groups(public_visibility,membership_intake_status,state_id,lga_id,community_id) WHERE status<>'ARCHIVED';

CREATE TABLE vsla_join_requests(
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), project_id UUID NOT NULL REFERENCES projects(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), assigned_facilitator_id UUID REFERENCES facilitator_profiles(id),
 reference_code VARCHAR(40) NOT NULL UNIQUE, first_name VARCHAR(100) NOT NULL, surname VARCHAR(100) NOT NULL, phone VARCHAR(30) NOT NULL, normalized_phone VARCHAR(30) NOT NULL, email VARCHAR(254), state_id UUID NOT NULL REFERENCES states(id), lga_id UUID NOT NULL REFERENCES lgas(id), community_id UUID REFERENCES communities(id), residence_text VARCHAR(300), message VARCHAR(1000),
 status VARCHAR(30) NOT NULL DEFAULT 'SUBMITTED' CHECK(status IN('SUBMITTED','VIEWED','CONTACTED','UNDER_GROUP_REVIEW','APPROVED','APPROVED_FOR_NEXT_CYCLE','WAITLISTED','REJECTED','WITHDRAWN','CONVERTED_TO_MEMBER')),
 submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(), reviewed_at TIMESTAMPTZ, reviewed_by UUID REFERENCES users(id), decision_notes VARCHAR(1000), decision_date DATE, converted_member_id UUID REFERENCES group_members(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX join_requests_active_phone_unique ON vsla_join_requests(group_id,normalized_phone) WHERE status IN('SUBMITTED','VIEWED','CONTACTED','UNDER_GROUP_REVIEW','WAITLISTED','APPROVED_FOR_NEXT_CYCLE');
CREATE UNIQUE INDEX join_requests_active_email_unique ON vsla_join_requests(group_id,lower(email)) WHERE email IS NOT NULL AND status IN('SUBMITTED','VIEWED','CONTACTED','UNDER_GROUP_REVIEW','WAITLISTED','APPROVED_FOR_NEXT_CYCLE');
CREATE INDEX join_requests_agent_status_idx ON vsla_join_requests(assigned_facilitator_id,status,submitted_at DESC);
CREATE INDEX join_requests_group_status_idx ON vsla_join_requests(group_id,status);

CREATE TABLE contact_requests(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),organization_id UUID REFERENCES organizations(id),name VARCHAR(160) NOT NULL,phone VARCHAR(30),email VARCHAR(254),category VARCHAR(40) NOT NULL CHECK(category IN('SAVINGS_GROUP_INFORMATION','JOINING_A_GROUP','FORMING_A_GROUP','TECHNICAL_SUPPORT','OTHER')),message VARCHAR(1500) NOT NULL,status VARCHAR(20) NOT NULL DEFAULT 'NEW' CHECK(status IN('NEW','IN_PROGRESS','RESOLVED','CLOSED')),created_at TIMESTAMPTZ NOT NULL DEFAULT now());

INSERT INTO permissions(code,description) VALUES
 ('group_public.manage','Manage public group discovery and membership intake'),('join_request.view','View scoped membership requests'),('join_request.manage','Manage scoped membership-request follow-up'),('join_request.convert','Convert an approved request to a member'),('notification.view','View own notifications') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN('SUPER_ADMIN','PROJECT_ADMIN','STATE_COORDINATOR') AND p.code IN('group_public.manage','join_request.view','join_request.manage','join_request.convert','notification.view') ON CONFLICT DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id) SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='FACILITATOR' AND p.code IN('group.create','group_public.manage','join_request.view','join_request.manage','join_request.convert','notification.view') ON CONFLICT DO NOTHING;
