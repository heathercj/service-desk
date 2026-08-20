# Role / permission matrix

Source of truth: `src/lib/rbac/policies.ts` (unit tested in
`policies.test.ts`). This table is a human-readable summary -- if it ever
disagrees with the code, the code wins.

A user may hold more than one role simultaneously (`UserRole` is a join
table). Department-scoped roles (Department Agent/Manager) are further
scoped by `DepartmentMembership`.

| Capability                             |    Customer    | Triage Agent |  Dept Agent   | Dept Manager  | Knowledge Manager | Administrator |
| -------------------------------------- | :------------: | :----------: | :-----------: | :-----------: | :---------------: | :-----------: |
| Create ticket                          |    ✅ (own)    |      --      |      --       |      --       |        --         |      --       |
| View own ticket                        |       ✅       |      --      |      --       |      --       |        --         |      ✅       |
| View any ticket in triage              |       --       |      ✅      |      --       |      --       |        --         |      ✅       |
| View ticket in own department          |       --       |      --      |      ✅       |      ✅       |        --         |      ✅       |
| View internal notes                    |       --       |      ✅      | ✅ (own dept) | ✅ (own dept) |        --         |      ✅       |
| Add customer-visible message           | ✅ (own, open) |   ✅ (any)   | ✅ (own dept) | ✅ (own dept) |        --         |      ✅       |
| Add internal note                      |       --       |      ✅      | ✅ (own dept) | ✅ (own dept) |        --         |      ✅       |
| Confirm triage / route                 |       --       |      ✅      |      --       |      --       |        --         |      ✅       |
| Self-assign (queued, own dept)         |       --       |      --      |      ✅       |      ✅       |        --         |      ✅       |
| Reassign to another agent              |       --       |      --      |      --       | ✅ (own dept) |        --         |      ✅       |
| Transfer department                    |       --       |      ✅      |      --       | ✅ (own dept) |        --         |      ✅       |
| Resolve ticket                         |       --       |      --      | ✅ (own dept) | ✅ (own dept) |        --         |      ✅       |
| Reopen / cancel (reason required)      | ✅ reopen only |  ✅ cancel   |   ✅ reopen   |    ✅ both    |        --         |      ✅       |
| View department workload metrics       |       --       |      --      |      --       | ✅ (own dept) |        --         |      ✅       |
| View published knowledge articles      |       ✅       |      ✅      |      ✅       |      ✅       |        ✅         |      ✅       |
| Draft / link / propose-update articles |       --       |      ✅      |      ✅       |      ✅       |        ✅         |      ✅       |
| View draft/in-review/archived articles |       --       |      ✅      |      ✅       |      ✅       |        ✅         |      ✅       |
| Publish / archive / restore articles   |       --       |      --      |      --       |      --       |        ✅         |      ✅       |
| Record a knowledge-gate **exception**  |       --       |      --      |      --       |      --       |        ✅         |      ✅       |
| View audit events                      |       --       |      --      |      --       |      --       |        --         |      ✅       |
| Manage users / roles / departments     |       --       |      --      |      --       |      --       |        --         |      ✅       |

Notes:

- "Own dept" means the actor has a `DepartmentMembership` row for that
  ticket's _current_ department (`isDepartmentMember` /
  `isDepartmentManager` in `policies.ts`). Administrators bypass department
  scoping entirely.
- Triage Agents are intentionally **not** department-scoped -- they need to
  see and route tickets before a department is finalized.
- A customer can never see another customer's ticket, another department's
  queue, internal notes, unpublished articles, audit events, or admin
  pages, under any role combination, because `isCustomer()` only grants
  access to tickets where `submittedById === actor.userId`.
