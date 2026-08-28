import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { db } from "@/lib/db";
import { Card, CardContent } from "@/components/ui/card";
import { DepartmentToggle } from "./department-toggle";
import { CreateDepartmentForm } from "./create-department-form";
import { RenameDepartmentForm } from "./rename-department-form";

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
      <Card>
        <CardContent className="p-4">
          <CreateDepartmentForm />
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {departments.map((d) => (
          <Card key={d.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-xs text-muted-foreground">{d.key}</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <RenameDepartmentForm departmentId={d.id} name={d.name} />
                <DepartmentToggle departmentId={d.id} isActive={d.isActive} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
