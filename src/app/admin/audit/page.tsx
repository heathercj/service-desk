import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { listAuditEventsForAdmin } from "@/lib/admin/admin-service";
import { AccessDenied } from "@/components/access-denied";
import { ForbiddenError } from "@/lib/rbac/errors";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";

export default async function AdminAuditPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  let events;
  try {
    events = await listAuditEventsForAdmin(auth);
  } catch (err) {
    if (err instanceof ForbiddenError) return <AccessDenied message={err.message} />;
    throw err;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Audit events</h1>
      <div className="grid gap-2">
        {events.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-3 text-xs">
              <p>
                <strong>{e.action}</strong> on {e.entityType} ({e.entityId}) by{" "}
                {e.actorDisplayName} at {formatDateTime(e.createdAt)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
