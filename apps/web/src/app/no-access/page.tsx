import { LockKeyhole, LogOut } from "lucide-react";
import { StatusPage } from "@/components/status-page";
import { Button } from "@/components/ui/button";

export default async function NoAccessPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
  const disabled = reason === "disabled";
  return (
    <StatusPage
      icon={<LockKeyhole />}
      tone="warning"
      title={disabled ? "Your account is disabled" : "No access yet"}
      actions={
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" icon={<LogOut aria-hidden />}>
            Sign out
          </Button>
        </form>
      }
    >
      <p>
        {disabled
          ? "An administrator has disabled your account. Ask them to turn it back on if you think this is a mistake."
          : "You are signed in, but no role has been given to your account yet. Ask an administrator to add you."}
      </p>
    </StatusPage>
  );
}
