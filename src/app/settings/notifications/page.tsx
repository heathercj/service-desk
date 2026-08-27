import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { canManageNotificationPreferences, toPolicyActor } from "@/lib/rbac/policies";
import { getNotificationPreferences } from "@/lib/notifications/preferences-service";
import { NotificationSettingsForm } from "./notification-settings-form";

export default async function NotificationSettingsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");
  if (!canManageNotificationPreferences(toPolicyActor(auth))) redirect("/");

  const preferences = await getNotificationPreferences(auth.userId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose which of your own activity emails you want to receive. Dormant-ticket
          alerts are sent regardless of these settings.
        </p>
      </div>
      <NotificationSettingsForm initialPreferences={preferences} />
    </div>
  );
}
