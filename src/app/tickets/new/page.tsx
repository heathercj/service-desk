import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { NewTicketForm } from "./new-ticket-form";

export default async function NewTicketPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!auth.roles.has("CUSTOMER")) redirect("/");

  const franchises = await db.franchise.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Create a ticket</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Submitting as <strong>{auth.displayName}</strong> ({auth.email}).
      </p>
      <NewTicketForm
        franchises={franchises.map((f) => ({ id: f.id, name: f.name }))}
        submitterName={auth.displayName}
        submitterEmail={auth.email}
      />
    </div>
  );
}
