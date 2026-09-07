-- pgAdmin reconciliation for the four dashboard savings/Social Fund metrics.
-- Replace the zero UUID with the dashboard user's organization UUID.
-- Leave group_ids NULL for every non-archived group in that organization, or
-- replace NULL::uuid[] with ARRAY['group-uuid'::uuid, ...] for the exact
-- authorized group set produced by dashboardScopeSql().

-- A. TOTAL SAVINGS EVER, by group and relevant cycle
WITH dashboard_scope AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid organization_id,
    NULL::uuid[] group_ids
), scoped_groups AS (
  SELECT g.id,g.group_code,g.name
  FROM vsla_groups g
  CROSS JOIN dashboard_scope ds
  WHERE g.organization_id=ds.organization_id
    AND g.status<>'ARCHIVED'
    AND (ds.group_ids IS NULL OR g.id=ANY(ds.group_ids))
)
SELECT
  sg.id group_id,
  sg.group_code,
  sg.name group_name,
  cy.id cycle_id,
  cy.cycle_number,
  cy.status cycle_status,
  COALESCE(SUM(CASE st.transaction_kind
    WHEN 'PURCHASE' THEN st.amount
    WHEN 'REVERSAL' THEN -st.amount
    ELSE 0
  END),0)::numeric(18,2) total_savings_ever
FROM scoped_groups sg
JOIN vsla_cycles cy ON cy.group_id=sg.id
  AND cy.status IN ('ACTIVE','CLOSING','CLOSED')
LEFT JOIN savings_transactions st ON st.cycle_id=cy.id AND st.group_id=sg.id
GROUP BY sg.id,sg.group_code,sg.name,cy.id,cy.cycle_number,cy.status
ORDER BY sg.name,cy.cycle_number;

-- B. CURRENT CYCLE SAVINGS, by group and active cycle
WITH dashboard_scope AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid organization_id,
    NULL::uuid[] group_ids
), scoped_groups AS (
  SELECT g.id,g.group_code,g.name
  FROM vsla_groups g
  CROSS JOIN dashboard_scope ds
  WHERE g.organization_id=ds.organization_id
    AND g.status<>'ARCHIVED'
    AND (ds.group_ids IS NULL OR g.id=ANY(ds.group_ids))
)
SELECT
  sg.id group_id,
  sg.group_code,
  sg.name group_name,
  cy.id cycle_id,
  cy.cycle_number,
  cy.status cycle_status,
  COALESCE(SUM(CASE st.transaction_kind
    WHEN 'PURCHASE' THEN st.amount
    WHEN 'REVERSAL' THEN -st.amount
    ELSE 0
  END),0)::numeric(18,2) current_cycle_savings
FROM scoped_groups sg
JOIN vsla_cycles cy ON cy.group_id=sg.id AND cy.status='ACTIVE'
LEFT JOIN savings_transactions st ON st.cycle_id=cy.id AND st.group_id=sg.id
GROUP BY sg.id,sg.group_code,sg.name,cy.id,cy.cycle_number,cy.status
ORDER BY sg.name,cy.cycle_number;

-- C. TOTAL SOCIAL FUND CONTRIBUTIONS, by group and relevant cycle
WITH dashboard_scope AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid organization_id,
    NULL::uuid[] group_ids
), scoped_groups AS (
  SELECT g.id,g.group_code,g.name
  FROM vsla_groups g
  CROSS JOIN dashboard_scope ds
  WHERE g.organization_id=ds.organization_id
    AND g.status<>'ARCHIVED'
    AND (ds.group_ids IS NULL OR g.id=ANY(ds.group_ids))
)
SELECT
  sg.id group_id,
  sg.group_code,
  sg.name group_name,
  cy.id cycle_id,
  cy.cycle_number,
  cy.status cycle_status,
  COALESCE(SUM(CASE sf.transaction_kind
    WHEN 'CONTRIBUTION' THEN sf.amount
    WHEN 'REVERSAL' THEN -sf.amount
    ELSE 0
  END),0)::numeric(18,2) total_social_fund_contributions
FROM scoped_groups sg
JOIN vsla_cycles cy ON cy.group_id=sg.id
  AND cy.status IN ('ACTIVE','CLOSING','CLOSED')
LEFT JOIN social_fund_transactions sf ON sf.cycle_id=cy.id AND sf.group_id=sg.id
GROUP BY sg.id,sg.group_code,sg.name,cy.id,cy.cycle_number,cy.status
ORDER BY sg.name,cy.cycle_number;

-- D. CURRENT SOCIAL FUND BALANCE, by group and active cycle
WITH dashboard_scope AS (
  SELECT
    '00000000-0000-0000-0000-000000000000'::uuid organization_id,
    NULL::uuid[] group_ids
), scoped_groups AS (
  SELECT g.id,g.group_code,g.name
  FROM vsla_groups g
  CROSS JOIN dashboard_scope ds
  WHERE g.organization_id=ds.organization_id
    AND g.status<>'ARCHIVED'
    AND (ds.group_ids IS NULL OR g.id=ANY(ds.group_ids))
)
SELECT
  sg.id group_id,
  sg.group_code,
  sg.name group_name,
  cy.id cycle_id,
  cy.cycle_number,
  cy.status cycle_status,
  COALESCE(SUM(CASE le.entry_side
    WHEN 'DEBIT' THEN le.amount
    WHEN 'CREDIT' THEN -le.amount
    ELSE 0
  END),0)::numeric(18,2) current_social_fund_balance
FROM scoped_groups sg
JOIN vsla_cycles cy ON cy.group_id=sg.id AND cy.status='ACTIVE'
LEFT JOIN ledger_accounts la ON la.cycle_id=cy.id
  AND la.group_id=sg.id
  AND la.account_code='SOCIAL_FUND_CASH'
LEFT JOIN ledger_entries le ON le.ledger_account_id=la.id
GROUP BY sg.id,sg.group_code,sg.name,cy.id,cy.cycle_number,cy.status
ORDER BY sg.name,cy.cycle_number;
