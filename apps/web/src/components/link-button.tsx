import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
  "data-testid": testId,
}: { href: string; className?: string; children: React.ReactNode; "data-testid"?: string } & VariantProps<typeof buttonVariants>) {
  return (
    <Link href={href} data-testid={testId} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}
