import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canAdminister, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminIndexPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!canAdminister(toPolicyActor(auth)))
    return <AccessDenied message="Administrator access required." />;

  const links = [
    { href: "/admin/users", label: "Users & roles" },
    { href: "/admin/departments", label: "Departments" },
    { href: "/admin/audit", label: "Audit events" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Administration</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        {links.map((l) => (
          <Card key={l.href}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={l.href} className="hover:underline">
                  {l.label}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent />
          </Card>
        ))}
      </div>
    </div>
  );
}
