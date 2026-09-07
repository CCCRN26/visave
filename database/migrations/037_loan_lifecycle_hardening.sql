-- Loan lifecycle hardening. This migration never rewrites historical financial data.
DO $$
DECLARE
  duplicate_requests integer;
  invalid_requests integer;
  invalid_decisions integer;
  invalid_loans integer;
  invalid_repayments integer;
BEGIN
  SELECT COUNT(*) INTO duplicate_requests FROM (
    SELECT member_id,cycle_id FROM loan_requests
    WHERE status IN ('PENDING','APPROVED')
    GROUP BY member_id,cycle_id HAVING COUNT(*)>1
  ) violations;

  SELECT COUNT(*) INTO invalid_requests
  FROM loan_requests r
  LEFT JOIN vsla_cycles cy ON cy.id=r.cycle_id AND cy.group_id=r.group_id
  LEFT JOIN group_members m ON m.id=r.member_id AND m.group_id=r.group_id
  LEFT JOIN vsla_meetings vm ON vm.id=r.request_meeting_id
    AND vm.group_id=r.group_id AND vm.cycle_id=r.cycle_id
  WHERE cy.id IS NULL OR m.id IS NULL OR vm.id IS NULL;

  SELECT COUNT(*) INTO invalid_decisions
  FROM loan_decisions d
  LEFT JOIN loan_requests r ON r.id=d.loan_request_id
    AND r.organization_id=d.organization_id AND r.group_id=d.group_id
    AND r.cycle_id=d.cycle_id AND r.member_id=d.member_id
  LEFT JOIN vsla_meetings vm ON vm.id=d.decision_meeting_id
    AND vm.group_id=d.group_id AND vm.cycle_id=d.cycle_id
  WHERE r.id IS NULL OR vm.id IS NULL;

  SELECT COUNT(*) INTO invalid_loans
  FROM loans l
  LEFT JOIN loan_requests r ON r.id=l.loan_request_id
    AND r.organization_id=l.organization_id AND r.group_id=l.group_id
    AND r.cycle_id=l.cycle_id AND r.member_id=l.member_id
  LEFT JOIN loan_decisions d ON d.id=l.loan_decision_id
    AND d.loan_request_id=l.loan_request_id AND d.group_id=l.group_id
    AND d.cycle_id=l.cycle_id AND d.member_id=l.member_id
  LEFT JOIN vsla_meetings vm ON vm.id=l.disbursement_meeting_id
    AND vm.group_id=l.group_id AND vm.cycle_id=l.cycle_id
  WHERE r.id IS NULL OR d.id IS NULL OR vm.id IS NULL;

  SELECT COUNT(*) INTO invalid_repayments
  FROM loan_repayments p
  LEFT JOIN loans l ON l.id=p.loan_id AND l.group_id=p.group_id
    AND l.cycle_id=p.cycle_id AND l.member_id=p.member_id
  LEFT JOIN vsla_meetings vm ON vm.id=p.meeting_id
    AND vm.group_id=p.group_id AND vm.cycle_id=p.cycle_id
  WHERE l.id IS NULL OR vm.id IS NULL;

  IF duplicate_requests>0 OR invalid_requests>0 OR invalid_decisions>0
    OR invalid_loans>0 OR invalid_repayments>0 THEN
    RAISE EXCEPTION USING
      ERRCODE='23514',
      MESSAGE='Loan hardening diagnostics found historical integrity violations',
      DETAIL=format(
        'duplicate unresolved requests=%s, invalid requests=%s, invalid decisions=%s, invalid loans=%s, invalid repayments=%s',
        duplicate_requests,invalid_requests,invalid_decisions,invalid_loans,invalid_repayments
      ),
      HINT='Inspect and resolve the reported historical records explicitly; this migration will not rewrite them.';
  END IF;
END $$;

CREATE UNIQUE INDEX one_unresolved_loan_request_per_member_cycle
  ON loan_requests(member_id,cycle_id)
  WHERE status IN ('PENDING','APPROVED');

ALTER TABLE vsla_meetings
  ADD CONSTRAINT vsla_meetings_id_group_cycle_unique UNIQUE(id,group_id,cycle_id);
ALTER TABLE loan_requests
  ADD CONSTRAINT loan_requests_context_unique UNIQUE(id,organization_id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loan_requests_meeting_cycle_fk
    FOREIGN KEY(request_meeting_id,group_id,cycle_id)
    REFERENCES vsla_meetings(id,group_id,cycle_id);
ALTER TABLE loan_decisions
  ADD CONSTRAINT loan_decisions_context_unique UNIQUE(id,loan_request_id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loan_decisions_request_context_fk
    FOREIGN KEY(loan_request_id,organization_id,group_id,cycle_id,member_id)
    REFERENCES loan_requests(id,organization_id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loan_decisions_meeting_cycle_fk
    FOREIGN KEY(decision_meeting_id,group_id,cycle_id)
    REFERENCES vsla_meetings(id,group_id,cycle_id);
ALTER TABLE loans
  ADD CONSTRAINT loans_context_unique UNIQUE(id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loans_request_context_fk
    FOREIGN KEY(loan_request_id,organization_id,group_id,cycle_id,member_id)
    REFERENCES loan_requests(id,organization_id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loans_decision_context_fk
    FOREIGN KEY(loan_decision_id,loan_request_id,group_id,cycle_id,member_id)
    REFERENCES loan_decisions(id,loan_request_id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loans_meeting_cycle_fk
    FOREIGN KEY(disbursement_meeting_id,group_id,cycle_id)
    REFERENCES vsla_meetings(id,group_id,cycle_id);
ALTER TABLE loan_repayments
  ADD CONSTRAINT loan_repayments_loan_context_fk
    FOREIGN KEY(loan_id,group_id,cycle_id,member_id)
    REFERENCES loans(id,group_id,cycle_id,member_id),
  ADD CONSTRAINT loan_repayments_meeting_cycle_fk
    FOREIGN KEY(meeting_id,group_id,cycle_id)
    REFERENCES vsla_meetings(id,group_id,cycle_id);
