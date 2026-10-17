# Role and permission matrix

## Two separate authority systems

1. **System role** (`user_roles`): SUPER_ADMIN, PROJECT_ADMIN, STATE_COORDINATOR, FACILITATOR, VSLA_MEMBER. It supplies permission codes and project/state scope.
2. **Group/cycle officer assignment** (`group_officer_assignments`): CHAIRPERSON, RECORD_KEEPER, BOX_KEEPER, MONEY_COUNTER_1, MONEY_COUNTER_2. It is tied to a member and cycle, not a global role.

A person can be a `VSLA_MEMBER` system user and also the current Chairperson for one group/cycle. Officer authority is derived at request time from `users.id → group_members.linked_user_id → cycle_memberships → active officer assignment`. Never store “chairperson=true” as durable authorization on the device.

**UI visibility must never replace backend authorization.** The server checks organization, group, operating mode, active/current cycle, participation, assignment, status, and sometimes a permission code on every call.

Sources: `database/bootstrap/001_rbac.sql`, `src/modules/group-access/group-access.repository.js`, `src/modules/group-access/group-access.service.js`.

## System-role scope

| Role | Scope | General effect |
|---|---|---|
| SUPER_ADMIN | Organization | All seeded permissions; group policy generally admits all actions; special loan/meeting rules still run but explicitly include SUPER_ADMIN where intended |
| PROJECT_ADMIN | Assigned project(s), optionally state | Broad project operational/admin permissions; cannot perform PA meeting close or PA/MM loan request/decision/disbursement merely because of admin role |
| STATE_COORDINATOR | Assigned project + state | Similar operational permissions within narrower state scope; same special-action exclusions |
| FACILITATOR | Active profile, assigned project/state/LGA and assigned group | Full Program Assisted operator; in Member Managed becomes read-only plus Digital Access management |
| VSLA_MEMBER | Dynamic linked memberships | Self-service; current digital Chairperson/Record Keeper may gain contextual operations |

The runtime `permissions` array comes from all user-role assignments. It is a gate, not sufficient authority by itself.

## Major capability matrix

Legend: **Yes** direct/current scoped authority; **Conditional** group policy/state/SOD applies; **No** no authority from that identity alone.

| Capability | SUPER_ADMIN | PROJECT_ADMIN | STATE_COORDINATOR | Assigned FACILITATOR | Ordinary VSLA_MEMBER |
|---|---:|---:|---:|---:|---:|
| View scoped projects/groups/members | Yes | Yes | Yes | Yes | Own linked data; group view only when contextual policy admits |
| Create/update group | Yes | Yes | Yes | Yes in scope | No |
| Create/update members/cycles/officers/constitution | Yes | Yes | Yes | PA: Yes; MM: view only except Digital Access | No, unless current digital officer action below |
| View meetings/finance/loans/reports | Yes | Yes | Yes | Yes in assigned group | Self APIs; current digital officer can view workspace |
| Operate PA meeting/attendance/finance | Yes | Generally Yes, except close special rule | Generally Yes, except close special rule | Yes | Chairperson conditional; Record Keeper view-only in PA |
| Close PA meeting | Yes | No | No | Yes if assigned, active, in scope | Current digital Chairperson only |
| Operate MM meeting/attendance/finance | Yes | Generally Yes by program scope | Generally Yes by program scope | No (view only) | Current digital Chairperson or Record Keeper per action set |
| Close MM meeting | Yes | Yes by normal meeting-operation policy | Yes by normal meeting-operation policy | No | Chairperson or Record Keeper if meeting-operation policy admits |
| Ordinary-member self loan request | Not “self member” path | Not “self member” path | Not “self member” path | Not “self member” path | Yes only when no privileged role/officer, active/current participant, open meeting, PRESENT |
| PA loan request/decide/disburse | Yes | No | No | Yes | Current Chairperson Yes; ordinary member request only |
| MM loan request | Yes | No | No | No | Chairperson, Record Keeper, or ordinary self requester |
| MM loan decision | Yes | No | No | No | Current Chairperson |
| MM loan disbursement | Yes | No | No | No | Current Chairperson or Record Keeper |
| Loan repay/reverse/default | Conditional group action | Conditional | Conditional | PA conditional; MM view-only | Chair/RK according to operating action policy; ordinary member no |
| PA share-out operations | Yes | Yes | Yes | Yes | No officer grant from Chairperson alone |
| MM share-out operations | Yes | Conditional program scope | Conditional program scope | No | Chairperson; Record Keeper only payout during CLOSING |
| Change operating model | Program-scoped | Program-scoped | Program-scoped | No | No |
| Digital Access management | Yes | Yes | Yes | PA and MM when assigned/in scope | No |
| Assisted password reset | In-org, not self | fully scoped lower/equal ceiling, not SA | fully scoped lower/equal ceiling | managed VSLA_MEMBER-only accounts | No, including officers |

“Program scope” is the SQL-derived matching SUPER_ADMIN/project/state relationship. Route permission and service checks may narrow a cell further.

## Officer assignments

| Position | Digital authority implemented |
|---|---|
| CHAIRPERSON | Current linked participant can view; can operate a defined Chair action set; can decide/disburse loans; special PA meeting-close authority; broad MM close/share-out authority |
| RECORD_KEEPER | Current linked participant can view; in MM can operate meetings, attendance, finance, requests, disbursement, repayment, reconciliation; share-out payout while CLOSING |
| BOX_KEEPER | Required lifecycle position but no digital officer authority in `isCurrentDigitalOfficer()` |
| MONEY_COUNTER_1 | Required lifecycle position but no digital officer authority |
| MONEY_COUNTER_2 | Required lifecycle position but no digital officer authority |

Only Chairperson and Record Keeper are recognized as “digital officers” by the current policy. Do not build operator screens for the other three without backend changes.

## Program Assisted versus Member Managed

| Area | PROGRAM_ASSISTED | MEMBER_MANAGED |
|---|---|---|
| Facilitator | Assigned active facilitator is primary operator | Read-only group access plus Digital Access management |
| Chairperson | Can view, selected operations, loan decisions, and meeting close | Principal leader; operations, decisions, close, cycle/share-out actions |
| Record Keeper | Mostly view-only | Meeting/attendance/financial operator; loan request/disbursement/repayment; reconciliation |
| Loan special actions | SUPER_ADMIN, assigned Facilitator, Chairperson; ordinary self-request | SUPER_ADMIN, Chairperson, Record Keeper as specified; ordinary self-request |
| Program admins | Broad normal operations, but special loan actions and PA close intentionally exclude them | Broad normal operations; special loan actions exclude PROJECT_ADMIN/STATE_COORDINATOR |
| Share-out | Program users/facilitator | Chairperson, with Record Keeper payout exception |

## Loan segregation of duties

- Default: request recorder cannot approve/reject; approver cannot disburse.
- Exempt: current Chairperson in either mode; SUPER_ADMIN in both modes; assigned active scoped Facilitator in Program Assisted.
- Not exempt: Record Keeper, ordinary member, PROJECT_ADMIN, STATE_COORDINATOR, unassigned/inactive/out-of-scope facilitator, former officer.
- Actor attribution is stored in `requested_by`, `decided_by`, transaction/loan `created_by`, and audit logs.

Sources: `src/modules/loans/loan.authorization.js`, `tests/loan-privilege-redesign.test.js`, `tests/meeting-close-control.test.js`.

## Known risk

The current bootstrap grants broad permission codes to VSLA_MEMBER so contextual policy can decide current officer authority. A mobile client must not interpret those raw permission codes as direct capability. Use server response/capability context and treat any `403` as authoritative.
