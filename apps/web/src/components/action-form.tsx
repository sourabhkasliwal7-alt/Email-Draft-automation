"use client";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { useToast } from "@/components/toast";

/**
 * A form around a server action that returns nothing (Disconnect, Skip, Archive, Delete ...). After it runs, a toast says
 * what happened; if it fails, a toast says so and what to do. Redirects are left alone (the page that follows shows its own notice).
 */
export function ActionForm({
  action,
  success,
  failure = "That did not work. Reload the page and try again.",
  className,
  children,
  "data-testid": testId,
}: {
  action: (formData: FormData) => Promise<void>;
  /** the sentence shown when it worked */
  success?: string;
  failure?: string;
  className?: string;
  children: React.ReactNode;
  "data-testid"?: string;
}) {
  const toast = useToast();
  return (
    <form
      className={className}
      data-testid={testId}
      action={async (formData) => {
        try {
          await action(formData);
          if (success) toast.success(success);
        } catch (e) {
          if (isRedirectError(e)) throw e;
          toast.error(failure);
        }
      }}
    >
      {children}
    </form>
  );
}
