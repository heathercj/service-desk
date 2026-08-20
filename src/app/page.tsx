import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";

export default async function HomePage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  if (auth.roles.has("CUSTOMER")) redirect("/dashboard");
  if (auth.roles.has("TRIAGE_AGENT") || auth.roles.has("ADMINISTRATOR"))
    redirect("/triage");
  if (auth.roles.has("DEPARTMENT_AGENT") || auth.roles.has("DEPARTMENT_MANAGER"))
    redirect("/queue");
  if (auth.roles.has("KNOWLEDGE_MANAGER")) redirect("/knowledge/manage");

  redirect("/login");
}
