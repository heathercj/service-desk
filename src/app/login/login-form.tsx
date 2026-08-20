"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

interface DevIdentityOption {
  key: string;
  displayName: string;
  roles: string[];
  description: string;
}

interface LoginFormProps {
  devEnabled: boolean;
  devIdentities: DevIdentityOption[];
}

export function LoginForm({ devEnabled, devIdentities }: LoginFormProps) {
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Microsoft Entra ID</CardTitle>
          <CardDescription>Sign in with your work or partner account.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              setPending("entra");
              void signIn("microsoft-entra-id", { callbackUrl: "/" });
            }}
          >
            {pending === "entra" ? "Redirecting..." : "Sign in with Microsoft"}
          </Button>
        </CardContent>
      </Card>

      {devEnabled && (
        <Card className="border-warning">
          <CardHeader>
            <CardTitle>Development sign-in</CardTitle>
            <CardDescription>
              Only available because ENABLE_DEV_AUTH=true. Pick a seeded demo identity.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {devIdentities.map((identity) => (
              <Button
                key={identity.key}
                variant="outline"
                className="w-full justify-between"
                disabled={pending !== null}
                onClick={() => {
                  setPending(identity.key);
                  void signIn("dev-credentials", {
                    devUserKey: identity.key,
                    callbackUrl: "/",
                  });
                }}
              >
                <span>
                  {identity.displayName}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({identity.roles.join(", ")})
                  </span>
                </span>
                {pending === identity.key ? "..." : ""}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
