"use client";

import { Home, RotateCcw, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { StatusPage } from "@/components/status-page";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  return (
    <StatusPage
      icon={<TriangleAlert />}
      tone="danger"
      title="Something went wrong"
      actions={
        <>
          <Button onClick={reset} icon={<RotateCcw aria-hidden />}>
            Try again
          </Button>
          <Button variant="outline" icon={<Home aria-hidden />} onClick={() => router.push("/")}>
            Go to Home
          </Button>
        </>
      }
    >
      <p>The page could not be shown. Try again. If it keeps happening, ask whoever installed the app to look at the server and worker windows for the reason.</p>
      {error.digest && <p className="mt-2 text-xs">Reference: {error.digest}</p>}
    </StatusPage>
  );
}
