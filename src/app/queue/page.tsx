import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function QueueIndexPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const isAdmin = auth.roles.has("ADMINISTRATOR");
  const departments = isAdmin
    ? await db.department.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
      })
    : await db.department.findMany({
        where: { id: { in: Array.from(auth.departments.keys()) }, isActive: true },
        orderBy: { name: "asc" },
      });

  if (departments.length === 0) {
    redirect("/");
  }
  if (departments.length === 1) {
    redirect(`/queue/${departments[0]!.key}`);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">My departments</h1>
      <div className="grid gap-3 sm:grid-cols-2">
        {departments.map((d) => (
          <Card key={d.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link href={`/queue/${d.key}`} className="hover:underline">
                  {d.name}
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
