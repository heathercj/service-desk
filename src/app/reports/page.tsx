import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import {
  canViewKnowledgeReports,
  canViewTeamReports,
  toPolicyActor,
} from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ReportsIndexPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const policyActor = toPolicyActor(auth);
  const links: Array<{ href: string; label: string }> = [];
  if (canViewTeamReports(policyActor))
    links.push({ href: "/reports/team", label: "Team" });
  if (canViewKnowledgeReports(policyActor)) {
    links.push({ href: "/reports/knowledge", label: "Knowledge base" });
  }

  if (links.length === 0) {
    return <AccessDenied message="You do not have access to any reports." />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <div className="grid gap-3 sm:grid-cols-2">
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
