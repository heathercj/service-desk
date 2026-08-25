import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { NewTicketForm } from "./new-ticket-form";

export default async function NewTicketPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!auth.roles.has("CUSTOMER")) redirect("/");

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Create a ticket</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Submitting as <strong>{auth.displayName}</strong> ({auth.email}).
      </p>
      <NewTicketForm submitterName={auth.displayName} submitterEmail={auth.email} />
    </div>
  );
}
