-- Share-out/cycle relationship hardening. Historical financial data is never rewritten.
DO $$
DECLARE
  invalid_shareouts integer;
  invalid_entitlements integer;
  invalid_payouts integer;
  invalid_transfers integer;
  invalid_allocations integer;
  completed_unpaid integer;
BEGIN
  SELECT COUNT(*) INTO invalid_shareouts
  FROM cycle_shareouts s
  LEFT JOIN vsla_cycles cy ON cy.id=s.cycle_id AND cy.group_id=s.group_id AND cy.organization_id=s.organization_id
  LEFT JOIN vsla_meetings m ON m.id=s.final_meeting_id AND m.group_id=s.group_id AND m.cycle_id=s.cycle_id
  WHERE cy.id IS NULL OR m.id IS NULL;

  SELECT COUNT(*) INTO invalid_entitlements
  FROM cycle_shareout_entitlements e
  LEFT JOIN cycle_shareouts s ON s.id=e.shareout_id AND s.organization_id=e.organization_id
    AND s.group_id=e.group_id AND s.cycle_id=e.cycle_id
  LEFT JOIN group_members m ON m.id=e.member_id AND m.group_id=e.group_id
  WHERE s.id IS NULL OR m.id IS NULL;

  SELECT COUNT(*) INTO invalid_payouts
  FROM shareout_payouts p
  LEFT JOIN cycle_shareouts s ON s.id=p.shareout_id AND s.organization_id=p.organization_id
    AND s.group_id=p.group_id AND s.cycle_id=p.cycle_id AND s.final_meeting_id=p.meeting_id
  LEFT JOIN cycle_shareout_entitlements e ON e.id=p.entitlement_id AND e.organization_id=p.organization_id
    AND e.group_id=p.group_id AND e.cycle_id=p.cycle_id AND e.shareout_id=p.shareout_id AND e.member_id=p.member_id
  LEFT JOIN vsla_meetings m ON m.id=p.meeting_id AND m.group_id=p.group_id AND m.cycle_id=p.cycle_id
  WHERE s.id IS NULL OR e.id IS NULL OR m.id IS NULL;

  SELECT COUNT(*) INTO invalid_transfers
  FROM cycle_social_fund_transfers t
  LEFT JOIN vsla_cycles source ON source.id=t.source_cycle_id AND source.group_id=t.group_id AND source.organization_id=t.organization_id
  LEFT JOIN vsla_cycles target ON target.id=t.target_cycle_id AND target.group_id=t.group_id AND target.organization_id=t.organization_id
  WHERE source.id IS NULL OR target.id IS NULL OR target.cycle_number<>source.cycle_number+1;

  SELECT COUNT(*) INTO invalid_allocations FROM (
    SELECT s.id FROM cycle_shareouts s JOIN cycle_shareout_entitlements e ON e.shareout_id=s.id
    GROUP BY s.id,s.distributable_fund HAVING SUM(e.final_entitlement)<>s.distributable_fund
  ) violations;

  SELECT COUNT(*) INTO completed_unpaid FROM (
    SELECT s.id,e.id FROM cycle_shareouts s JOIN cycle_shareout_entitlements e ON e.shareout_id=s.id
    LEFT JOIN shareout_payouts p ON p.entitlement_id=e.id
    WHERE s.status='COMPLETED'
    GROUP BY s.id,e.id,e.final_entitlement
    HAVING COALESCE(SUM(CASE p.transaction_kind WHEN 'PAYOUT' THEN p.amount ELSE -p.amount END),0)<>e.final_entitlement
  ) violations;

  IF invalid_shareouts>0 OR invalid_entitlements>0 OR invalid_payouts>0 OR invalid_transfers>0
    OR invalid_allocations>0 OR completed_unpaid>0 THEN
    RAISE EXCEPTION USING ERRCODE='23514',
      MESSAGE='Share-out hardening diagnostics found historical integrity violations',
      DETAIL=format('invalid shareouts=%s, invalid entitlements=%s, invalid payouts=%s, invalid transfers=%s, invalid allocations=%s, completed unpaid=%s',
        invalid_shareouts,invalid_entitlements,invalid_payouts,invalid_transfers,invalid_allocations,completed_unpaid),
      HINT='Resolve the reported records explicitly; migration 038 will not rewrite financial history.';
  END IF;
END $$;

ALTER TABLE vsla_cycles
  ADD CONSTRAINT vsla_cycles_id_org_group_unique UNIQUE(id,organization_id,group_id);

ALTER TABLE cycle_shareouts
  ADD CONSTRAINT cycle_shareouts_base_context_unique UNIQUE(id,organization_id,group_id,cycle_id),
  ADD CONSTRAINT cycle_shareouts_context_unique UNIQUE(id,organization_id,group_id,cycle_id,final_meeting_id),
  ADD CONSTRAINT cycle_shareouts_final_meeting_cycle_fk
    FOREIGN KEY(final_meeting_id,group_id,cycle_id) REFERENCES vsla_meetings(id,group_id,cycle_id);

ALTER TABLE cycle_shareout_entitlements
  ADD CONSTRAINT shareout_entitlements_context_unique UNIQUE(id,organization_id,group_id,cycle_id,shareout_id,member_id),
  ADD CONSTRAINT shareout_entitlements_shareout_context_fk
    FOREIGN KEY(shareout_id,organization_id,group_id,cycle_id)
    REFERENCES cycle_shareouts(id,organization_id,group_id,cycle_id);

ALTER TABLE shareout_payouts
  ADD CONSTRAINT shareout_payouts_context_unique UNIQUE(id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id),
  ADD CONSTRAINT shareout_payouts_shareout_context_fk
    FOREIGN KEY(shareout_id,organization_id,group_id,cycle_id,meeting_id)
    REFERENCES cycle_shareouts(id,organization_id,group_id,cycle_id,final_meeting_id),
  ADD CONSTRAINT shareout_payouts_entitlement_context_fk
    FOREIGN KEY(entitlement_id,organization_id,group_id,cycle_id,shareout_id,member_id)
    REFERENCES cycle_shareout_entitlements(id,organization_id,group_id,cycle_id,shareout_id,member_id),
  ADD CONSTRAINT shareout_payouts_meeting_cycle_fk
    FOREIGN KEY(meeting_id,group_id,cycle_id) REFERENCES vsla_meetings(id,group_id,cycle_id),
  ADD CONSTRAINT shareout_payouts_reversal_context_fk
    FOREIGN KEY(original_shareout_payout_id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id)
    REFERENCES shareout_payouts(id,organization_id,group_id,cycle_id,meeting_id,shareout_id,entitlement_id,member_id);

ALTER TABLE cycle_social_fund_transfers
  ADD CONSTRAINT social_transfer_source_context_fk
    FOREIGN KEY(source_cycle_id,organization_id,group_id) REFERENCES vsla_cycles(id,organization_id,group_id),
  ADD CONSTRAINT social_transfer_target_context_fk
    FOREIGN KEY(target_cycle_id,organization_id,group_id) REFERENCES vsla_cycles(id,organization_id,group_id);
