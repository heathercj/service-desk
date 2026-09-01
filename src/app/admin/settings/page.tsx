import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canManageReportSettings, toPolicyActor } from "@/lib/rbac/policies";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRubric } from "@/lib/reports/rubric-settings-service";
import { RubricSettingsForm } from "./rubric-settings-form";

export default async function AdminSettingsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!canManageReportSettings(toPolicyActor(auth)))
    return <AccessDenied message="Administrator access required." />;

  const rubric = await getRubric();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Report settings</h1>
        <p className="text-sm text-muted-foreground">
          Controls the &ldquo;slow to resolve&rdquo; signal on the Product Signals report
          -- a ticket is flagged once it takes longer than its priority&apos;s target plus
          the grace period.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product-signal rubric</CardTitle>
        </CardHeader>
        <CardContent>
          <RubricSettingsForm rubric={rubric} />
        </CardContent>
      </Card>
    </div>
  );
}
