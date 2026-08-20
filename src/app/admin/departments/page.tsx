import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { DepartmentToggle } from "./department-toggle";

export default async function AdminDepartmentsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!canAdminister(toPolicyActor(auth)))
    return <AccessDenied message="Administrator access required." />;

  const departments = await db.department.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Departments</h1>
        <p className="text-sm text-muted-foreground">
          Deactivating a department hides it from new ticket submission without deleting
          existing ticket history.
        </p>
      </div>
      <div className="grid gap-3">
        {departments.map((d) => (
          <Card key={d.id}>
            <CardContent className="flex items-center justify-between p-4">
              <span className="font-medium">{d.name}</span>
              <DepartmentToggle departmentId={d.id} isActive={d.isActive} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
