# Route catalogue

All routes require an authenticated session unless marked **public**
(enforced by `src/middleware.ts`; fine-grained authorization is re-checked
in the service layer for every route regardless).

## Pages (Server Components)

| Route                                                          | Who                       | Purpose                                                  |
| -------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `/login`                                                       | public                    | Sign-in (Entra + optional dev identities)                |
| `/`                                                            | any                       | Redirects to the right portal for the user's roles       |
| `/dashboard`                                                   | Customer                  | My tickets                                               |
| `/tickets/new`                                                 | Customer                  | Ticket submission form                                   |
| `/tickets/[ticketNumber]`                                      | scoped                    | Shared ticket detail/workbench (view scoped by role)     |
| `/triage`                                                      | Triage Agent, Admin       | Triage queue                                             |
| `/queue`                                                       | Dept Agent/Manager, Admin | Department picker (redirects if only one)                |
| `/queue/[departmentKey]`                                       | scoped                    | Department queue                                         |
| `/knowledge/[slug]`                                            | any                       | Article view (published only unless staff)               |
| `/knowledge/manage`                                            | staff roles               | Draft/review/publish/archive console                     |
| `/dev-mailbox`                                                 | staff roles               | Captured outbound email (dev-only concept, always local) |
| `/admin`, `/admin/users`, `/admin/departments`, `/admin/audit` | Administrator             | User/role, department, audit management                  |

## API routes (mutations; JSON in, JSON out)

| Route                                  | Method           | Who                              | Purpose                               | Rate limit                  |
| -------------------------------------- | ---------------- | -------------------------------- | ------------------------------------- | --------------------------- |
| `/api/auth/[...nextauth]`              | GET/POST         | public                           | Auth.js handlers                      | sign-in paths limited by IP |
| `/api/health`                          | GET              | public                           | Liveness                              | --                          |
| `/api/ready`                           | GET              | public                           | Readiness (DB reachable)              | --                          |
| `/api/tickets`                         | POST             | Customer                         | Create ticket                         | 10/min/user                 |
| `/api/tickets/[id]/messages`           | POST             | scoped                           | Add customer-visible message          | 20/min/user                 |
| `/api/tickets/[id]/notes`              | POST             | staff                            | Add internal note                     | --                          |
| `/api/tickets/[id]/triage`             | POST             | Triage/Admin                     | Confirm triage + route                | --                          |
| `/api/tickets/[id]/assign-self`        | POST             | Dept Agent/Manager/Admin         | Self-assign                           | --                          |
| `/api/tickets/[id]/reassign`           | POST             | Dept Manager/Admin               | Reassign within department            | --                          |
| `/api/tickets/[id]/transition`         | POST             | role-gated by state machine      | Generic status transition             | --                          |
| `/api/tickets/[id]/transfer`           | POST             | Triage/Dept Manager/Admin        | Department transfer (reason required) | --                          |
| `/api/tickets/[id]/resolve`            | POST             | Dept Agent/Manager/Admin         | Enter resolution, attempt gate        | --                          |
| `/api/tickets/[id]/knowledge-outcome`  | POST             | staff (exception: KM/Admin only) | Record resolution-gate outcome        | --                          |
| `/api/tickets/[id]/attachments`        | POST (multipart) | scoped                           | Upload attachment                     | 15/min/user                 |
| `/api/attachments/[id]/download`       | GET              | scoped                           | Download (only if `scanStatus=CLEAN`) | --                          |
| `/api/knowledge/suggestions`           | POST             | any                              | Pre-ticket knowledge suggestions      | 60/min/user                 |
| `/api/knowledge/similar`               | POST             | staff                            | Author-facing duplicate check         | 60/min/user                 |
| `/api/knowledge/articles`              | POST             | staff                            | Create draft article                  | --                          |
| `/api/knowledge/articles/[id]/publish` | POST             | Knowledge Manager/Admin          | Publish                               | --                          |
| `/api/knowledge/articles/[id]/archive` | POST             | Knowledge Manager/Admin          | Archive                               | --                          |
| `/api/knowledge/articles/[id]/restore` | POST             | Knowledge Manager/Admin          | Restore from archive                  | --                          |
| `/api/knowledge/feedback`              | POST             | any                              | Helpful/not-helpful                   | --                          |
| `/api/knowledge/deflection`            | POST             | any                              | Record deflection event               | --                          |
| `/api/chat`                            | POST             | any                              | Retrieval-only knowledge chat         | 30/min/user                 |
| `/api/admin/users/[id]/role`           | POST             | Administrator                    | Grant/revoke a role                   | --                          |
| `/api/admin/departments/[id]/active`   | POST             | Administrator                    | Activate/deactivate department        | --                          |

Every non-GET route validates its body with a Zod schema
(`src/lib/validation/`) and returns `400` with issue details on failure,
`401` unauthenticated, `403` forbidden, `404` not found, `409` conflict
(stale version / invalid transition), `429` rate limited, `500` generic
(with the real error logged server-side, never returned to the client).
