import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";

const STAFF_ROLES = [
  "TRIAGE_AGENT",
  "DEPARTMENT_AGENT",
  "DEPARTMENT_MANAGER",
  "KNOWLEDGE_MANAGER",
  "ADMINISTRATOR",
];

export default async function DevMailboxPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!STAFF_ROLES.some((r) => auth.roles.has(r as never))) {
    return (
      <AccessDenied message="The development mailbox is only visible to staff roles." />
    );
  }

  const emails = await db.outboundEmail.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Development mailbox</h1>
        <p className="text-sm text-muted-foreground">
          Section 9: these messages were <strong>captured locally</strong>, not delivered.
          No real email was sent.
        </p>
      </div>

      {emails.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No captured mail yet.
        </p>
      ) : (
        <div className="grid gap-3">
          {emails.map((e) => (
            <Card key={e.id}>
              <CardContent className="space-y-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">
                    To: {e.toEmail} -- {e.subject}
                  </p>
                  <Badge variant={e.status === "CAPTURED_DEV" ? "secondary" : "outline"}>
                    {e.status}
                  </Badge>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{e.bodyText}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
