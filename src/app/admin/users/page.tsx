import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listUsersForAdmin } from "@/lib/admin/admin-service";
import { db } from "@/lib/db";
import { AccessDenied } from "@/components/access-denied";
import { ForbiddenError } from "@/lib/rbac/errors";
import { Card, CardContent } from "@/components/ui/card";
import { RoleToggles } from "./role-toggles";
import { AddAgentForm } from "./add-agent-form";
import { DepartmentMembershipToggles } from "./department-membership-toggles";
import { UserActiveToggle } from "./user-active-toggle";

const ALL_ROLES = [
  "CUSTOMER",
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "PRODUCT_MANAGER",
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

  const departments = await db.department.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Users &amp; roles</h1>
        <p className="text-sm text-muted-foreground">
          Secret values (like Entra client secrets) are never shown here -- only user
          profile and role data.
        </p>
      </div>

      <AddAgentForm />

      <div className="grid gap-3">
        {users.map((u) => (
          <Card key={u.id} className={u.isActive ? undefined : "opacity-60"}>
            <CardContent className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">
                    {u.displayName}{" "}
                    {u.isDevAccount && (
                      <span className="text-xs text-muted-foreground">(dev account)</span>
                    )}
                    {!u.isActive && (
                      <span className="text-xs text-muted-foreground"> (inactive)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                </div>
                <UserActiveToggle
                  userId={u.id}
                  isActive={u.isActive}
                  isSelf={u.id === auth.userId}
                />
              </div>
              <RoleToggles
                userId={u.id}
                currentRoles={u.roles.map((r) => r.role.name)}
                allRoles={[...ALL_ROLES]}
              />
              <DepartmentMembershipToggles
                userId={u.id}
                currentMemberships={u.departmentMemberships.map((m) => ({
                  departmentId: m.departmentId,
                  isManager: m.isManager,
                }))}
                allDepartments={departments}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
