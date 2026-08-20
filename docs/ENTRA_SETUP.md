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

## 3. API permissions

No Microsoft Graph permissions beyond the default OIDC scopes are required.
This app requests only `openid profile email` (see `src/auth.ts`) -- it
deliberately does not request `User.Read` or any Graph scope, since it
doesn't call Graph. Leave the default "User.Read" delegated permission
Azure adds automatically if you want, but the app never uses it; removing
it is also fine and matches least-privilege intent (Section 3).

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
