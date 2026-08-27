# Microsoft Entra ID app registration

Follow this to authenticate against a real tenant instead of development
authentication.

## 1. Register the application

In the Azure Portal: **Microsoft Entra ID -> App registrations -> New
registration**.

- **Name**: `Service Desk (local dev)` or similar.
- **Supported account types**: **Accounts in this organizational directory
  only (Single tenant)**. Do NOT choose "any organizational directory" or
  "personal Microsoft accounts" -- the app is built to reject anything but
  a single, specific tenant (Section 3).
- **Redirect URI**: platform **Web**,
  `http://localhost:3000/api/auth/callback/microsoft-entra-id` for local
  development.

After creation, note:

- **Application (client) ID** -> `ENTRA_CLIENT_ID`
- **Directory (tenant) ID** -> `ENTRA_TENANT_ID`

## 2. Create a client secret

**Certificates & secrets -> New client secret.** Copy the _value_
immediately (it's shown once) -> `ENTRA_CLIENT_SECRET`.

## 3. API permissions (sign-in)

No Microsoft Graph permissions beyond the default OIDC scopes are required
**for sign-in**. This app requests only `openid profile email` (see
`src/auth.ts`) -- it deliberately does not request `User.Read` or any Graph
scope for the sign-in flow itself, since that flow doesn't call Graph.
Leave the default "User.Read" delegated permission Azure adds
automatically if you want, but the app never uses it; removing it is also
fine and matches least-privilege intent (Section 3).

Franchise resolution and email intake (§8 below) add a _second_, separate
set of permissions to this same app registration -- Application (app-only)
permissions, not delegated ones. That's a deliberate widening beyond the
"OIDC only" posture above, done for two specific features, not a general
loosening -- see §8 for why and exactly what it grants.

## 4. Redirect URIs for other environments

Add one Redirect URI per environment you'll actually run, e.g.:

- `https://service-desk.your-domain.example/api/auth/callback/microsoft-entra-id`

## 5. Environment variables

```bash
ENTRA_TENANT_ID="<Directory (tenant) ID>"
ENTRA_CLIENT_ID="<Application (client) ID>"
ENTRA_CLIENT_SECRET="<client secret value>"
AUTH_SECRET="$(openssl rand -base64 32)"
AUTH_URL="http://localhost:3000"
ENABLE_DEV_AUTH=false
```

## 6. Guest / partner accounts

Guest (B2B) accounts already invited into your tenant authenticate through
this exact same flow -- no extra configuration is needed. Their `tid` claim
is the _resource_ tenant (yours), which is what `ENTRA_TENANT_ID` checks
against, so they pass the tenant-claim check like any member account.

## 7. Verifying it worked

1. Restart the app with the variables above set and `ENABLE_DEV_AUTH=false`.
2. Visit `/login` -- only the "Sign in with Microsoft" button should
   appear (no dev-identity panel).
3. Sign in with a real account in your tenant. You should land on the
   appropriate portal based on your seeded/assigned roles (a brand-new user
   has no roles yet -- have an Administrator grant one via `/admin/users`).
4. Try signing in with an account from a _different_ tenant (if you have
   one available) and confirm it's rejected -- this exercises the
   `isTenantClaimValid()` check.

## 8. Email intake (support@ -> ticket) and Entra-driven franchise

Two features share one new capability: this app calling Microsoft Graph
itself (app-only, client-credentials), rather than only being called into
via delegated sign-in.

- **Franchise resolution**: every ticket's franchise is derived from the
  submitter's Entra `department` attribute (`src/lib/tickets/franchise-lookup.ts`)
  rather than picked by hand -- this needs `User.Read.All` to look anyone
  up by email, and applies to every ticket, not just email-submitted ones.
- **Email intake**: a Microsoft Graph webhook subscription on
  `support@alairhomes.com` turns an inbound email into a ticket
  (`src/app/api/webhooks/graph-email/route.ts`) -- this additionally needs
  `Mail.Read`, scoped to only that one mailbox.

### 8.1 Application permissions

On the **same** app registration from §1 (reusing `ENTRA_CLIENT_ID`/
`ENTRA_CLIENT_SECRET`/`ENTRA_TENANT_ID` -- a client-credentials grant uses
the same client id/secret pair, just a different OAuth flow than sign-in):

**API permissions -> Add a permission -> Microsoft Graph -> Application
permissions**, add:

- `User.Read.All` -- directory lookups (department, and provisioning a
  User row for an email sender with no local account yet).
- `Mail.Read` -- reading messages in the support mailbox.

Click **Grant admin consent** -- Application permissions don't work until
an admin explicitly consents; a user's own sign-in consent doesn't cover
them.

### 8.2 Exchange Application Access Policy -- do not skip this

`Mail.Read` as an Application permission with no policy grants read access
to **every mailbox in the tenant**, not just `support@alairhomes.com`.
Scope it down with an Application Access Policy (Exchange Online
PowerShell, `ExchangeOnlineManagement` module):

```powershell
Connect-ExchangeOnline

New-ApplicationAccessPolicy `
  -AppId "<Application (client) ID from §1>" `
  -PolicyScopeGroupId "support@alairhomes.com" `
  -AccessRight RestrictAccess `
  -Description "Service desk email intake -- support mailbox only"

# Verify: should show Result "Access Granted" for support@alairhomes.com
# and "Access Denied" for any other mailbox.
Test-ApplicationAccessPolicy -AppId "<client ID>" -Identity "support@alairhomes.com"
Test-ApplicationAccessPolicy -AppId "<client ID>" -Identity "someone.else@alairhomes.com"
```

### 8.3 Environment variables

```bash
ENABLE_EMAIL_INTAKE=true
SUPPORT_MAILBOX_ADDRESS="support@alairhomes.com"
GRAPH_WEBHOOK_CLIENT_STATE="$(openssl rand -base64 32)"
```

`APP_BASE_URL` (already set) must be the real public HTTPS URL of this
deployment -- Graph needs to reach it to deliver notifications. This is
the reason email intake cannot be exercised from local dev at all: there
is no public HTTPS endpoint on a laptop for Graph to call back to. Verify
everything up through §8.2 in a real deployment first.

### 8.4 Create the subscription

Once deployed with the above set:

```bash
pnpm graph:subscribe
```

This creates the Graph subscription on the support mailbox's Inbox
(`src/lib/graph/mailbox-subscription.ts`) and is a one-time step -- run it
again only if the subscription is deleted or the stored id
(`AppSetting` row, key `graph_email_subscription`) is lost. Renewal after
that is automatic: Graph sends a `reauthorizationRequired` lifecycle
notification to the same webhook route before the subscription expires
(roughly every 3 days), and the route renews it in response. No cron job
or external scheduler is needed.

### 8.5 Verifying it worked

1. Send a real email to `support@alairhomes.com` from an account in your
   tenant.
2. Within a few seconds, a new ticket should appear in the queue, status
   `SUBMITTED`, with a "Received via support@alairhomes.com" note on the
   ticket detail page.
3. Confirm the submitter's name/email match the real sender, and that
   their franchise was derived (not defaulted to "Head Office /
   Unassigned") if their Entra `department` attribute matches a real
   franchise name or code.
4. Send from an address with no account in your tenant at all (if you can
   arrange one) and confirm a ticket still gets created rather than the
   email being silently dropped -- check the server logs for the
   "no local account or Entra match" warning this logs as an anomaly to
   investigate.

## 9. Outbound notification email -- Entra permissions for a future Graph mail-send provider

This does **not** apply yet. `EmailProvider` (`src/lib/email/provider.ts`)
has exactly one implementation, `ConsoleEmailProvider` -- it captures every
outbound email (agent-facing ticket-assigned/KB-published/dormant-ticket
alerts, and customer-facing staff-reply and ticket-assigned notices
included) as an `OutboundEmail` row and surfaces it on `/dev-mailbox`
rather than delivering it, by design (ADR 0005). Nothing in this repo
sends real mail. This section exists so that when a real
`GraphEmailProvider` implementing the same interface is written, the Entra
side is already documented rather than reverse-engineered under deadline
pressure. Every notification listed above goes through this same
interface, so nothing here is per-notification-type -- a single
`GraphEmailProvider` covers all of them, including the "your ticket has
been assigned" email the submitter gets once triage names an agent
(`notifySubmitterOfAssignment` in `src/lib/tickets/ticket-service.ts`).

### 9.1 Application permission

On the **same** app registration as §1/§8, add one more Microsoft Graph
**Application permission**:

- `Mail.Send` -- lets the app send mail as a specific mailbox via
  client-credentials, the same OAuth flow §8 already uses for `Mail.Read`.

**Grant admin consent** the same way as §8.1 -- this is an Application
permission, so a user's own sign-in consent never covers it.

### 9.2 Scope it to one mailbox -- do not skip this

Exactly the same problem as §8.2: `Mail.Send` as an Application permission
with no policy lets the app send mail **as any mailbox in the tenant**, not
just the one it's meant to send from. Reuse the same Application Access
Policy mechanism, adding `Mail.Send` alongside `Mail.Read` for the same
`support@alairhomes.com` scope (a single policy can cover both permissions
for the same mailbox -- there's no need for a second policy):

```powershell
Connect-ExchangeOnline

New-ApplicationAccessPolicy `
  -AppId "<Application (client) ID from §1>" `
  -PolicyScopeGroupId "support@alairhomes.com" `
  -AccessRight RestrictAccess `
  -Description "Service desk outbound notifications -- support mailbox only"

Test-ApplicationAccessPolicy -AppId "<client ID>" -Identity "support@alairhomes.com"
```

If §8's policy already exists for this mailbox, Graph enforces `Mail.Send`
under that same policy automatically -- there's nothing further to do.

### 9.3 What the provider would send as

No new environment variable is needed: the existing `SUPPORT_MAILBOX_ADDRESS`
(§8.3) is the natural "From" address for a `GraphEmailProvider`, since it's
already the one mailbox the app registration is scoped to send and read as.

### 9.4 Verifying it worked (once the provider exists)

1. Trigger one of the four notification emails (assign a ticket to a
   colleague, reply as a customer, publish a KB article, or run
   `pnpm dormant:check` against a stale ticket).
2. Confirm the recipient actually receives it, rather than checking
   `/dev-mailbox` -- that page only reflects `ConsoleEmailProvider`.
3. Send from/to an account outside the policy's scope (if you can arrange
   one) and confirm Graph refuses it, the same check as §8.2's
   `Test-ApplicationAccessPolicy` line but for the send direction.
