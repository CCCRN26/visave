# Recommended mobile screen map

Everything in this file is **RECOMMENDED MOBILE UX**, not an assertion that equivalent web navigation or a single endpoint exists.

## Member-first navigation

```text
Auth
├─ Login
└─ Forced password change

Tabs
├─ Home
├─ Groups
│  └─ Group activity
│     ├─ Cycle selector
│     ├─ Savings / Social Fund / fines
│     ├─ Loan and repayment activity
│     ├─ Loan request (when eligible)
│     └─ Share-out
├─ Meetings
│  └─ Meeting detail → Join Google Meet
├─ Notifications
└─ Profile
```

## Screen-to-API mapping

| Screen | Data required | GET endpoints | Mutations | Actors | Loading / empty / error | Refresh |
|---|---|---|---|---|---|---|
| Login | email/password, Turnstile token | none | `POST /auth/login` | public | challenge loading; invalid credentials; Turnstile errors; 429 | never auto-retry |
| Forced password | policy and current session | none | `POST /auth/change-password`, logout | forced-change user | mismatch, same-password, session expiry | submit only |
| Session bootstrap | current user/roles | `/auth/me` | logout | authenticated | 401→login; password code→forced screen | app launch/foreground |
| Home | group cards + selected activity summary | `/me/groups`, `/me/groups/{id}/activity` | none | linked member | no memberships; stale cached values label | focus + pull |
| Groups | memberships, cycle/position | `/me/groups` | none | linked member | “No digital memberships” | focus + pull |
| Group activity | selected cycle, summary, loan, share-out, feed | `/me/groups/{id}/activity?cycleId=` | none | linked member | 403 link issue; empty activity | pull; revalidate after loan request |
| Loan request | eligibility supplied by activity/open meeting; details | activity; operator eligibility route is not ideal for ordinary UI | loan request; own cancel | ordinary self requester | no open meeting; not PRESENT; ineligible; 409 state | fetch immediately before submit; no offline |
| Meetings | history rows | `/me/meetings` | none | linked member | empty history | focus + pull |
| Meeting detail | join URL, attendance, totals/contributions | `/me/groups/{id}/meetings/{meetingId}` | none | linked attendee | no join URL, 403 membership | while OPEN on focus/pull; closed is stable |
| External Meet launch | `joinUrl` | from meeting detail | OS open URL | authorized attendee | missing app→browser fallback; invalid URL reject | refetch before launch if stale |
| Notifications | latest 100, unread count | `/notifications` | mark one/read-all | permission-bearing current user | empty inbox; 403 permission | focus + pull; optimistic read with rollback |
| Profile | current user and Meet email | `/auth/me`, `/me/google-meet-email` | PATCH Meet email, logout | current user | validation/session errors | on focus |
| Statement download (later) | cycle/member IDs, file metadata | member PDF/XLSX route | none | server-authorized linked member/operator | download progress, storage/share errors | explicit only |

The ordinary member loan form should omit `memberId`. The server derives the linked member. A 409 should refresh activity/eligibility and explain that group/meeting/loan state changed.

## Deferred role flows

### Facilitator

Dashboard → assigned groups → onboarding → members → constitution → cycles/officers → meetings → financial operations → closeout. Backend APIs exist, but mobile V1 should not implement this surface.

### Chairperson / Record Keeper

My Groups may expose “Officer workspace” only when `/me/groups` says current participation and `has_officer_workspace=true`. Entering it must still load server-authoritative capabilities and handle 403. PA/MM action differences must be visible.

### Admin

Projects → users → facilitators → groups → reports. This is not recommended for native V1; the web application remains the admin console.

## State management rules

- Keep auth/session errors centralized.
- Treat every financial decimal as a string until display formatting; do not use JavaScript floating point for authoritative operations.
- Do not merge cached activity from two cycle IDs.
- Invalidate affected group/activity/meeting/notification queries after mutations.
- Never optimistically display a financial write as final before server success.
- Show server `message`, map known `code` to a safe action, and retain a support correlation timestamp without logging secrets.
