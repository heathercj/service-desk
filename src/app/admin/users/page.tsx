import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listUsersForAdmin } from "@/lib/admin/admin-service";
import { AccessDenied } from "@/components/access-denied";
import { ForbiddenError } from "@/lib/rbac/errors";
import { Card, CardContent } from "@/components/ui/card";
import { RoleToggles } from "./role-toggles";

const ALL_ROLES = [
  "CUSTOMER",
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "ADMINISTRATOR",
] as const;

export default async function AdminUsersPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  let users;
  try {
    users = await listUsersForAdmin(auth);
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users &amp; roles</h1>
        <p className="text-sm text-muted-foreground">
          Secret values (like Entra client secrets) are never shown here -- only user
          profile and role data.
        </p>
      </div>

      <div className="grid gap-3">
        {users.map((u) => (
          <Card key={u.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {u.displayName}{" "}
                    {u.isDevAccount && (
                      <span className="text-xs text-muted-foreground">(dev account)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  {u.departmentMemberships.map((m) => m.department.name).join(", ") ||
                    "No department memberships"}
                </p>
              </div>
              <RoleToggles
                userId={u.id}
                currentRoles={u.roles.map((r) => r.role.name)}
                allRoles={[...ALL_ROLES]}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
