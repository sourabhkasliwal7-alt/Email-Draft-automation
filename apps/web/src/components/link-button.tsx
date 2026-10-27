import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A link that looks exactly like a Button.
 * `external` opens another site in a new tab. `plain` is an ordinary link without Next's client navigation (for addresses that answer
 * with a redirect, like the Google sign-in). `disabled` shows the greyed button and removes the address.
 * `icon` is a ready element such as <Rocket />, never a component.
 */
export function LinkButton({
  href,
  variant,
  size,
  className,
  children,
  icon,
  external = false,
  plain = false,
  disabled = false,
  "data-testid": testId,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
  icon?: React.ReactNode;
  external?: boolean;
  plain?: boolean;
  disabled?: boolean;
  "data-testid"?: string;
} & VariantProps<typeof buttonVariants>) {
  const body = (
    <>
      {icon}
      {children}
    </>
  );
  const classes = cn(buttonVariants({ variant, size }), disabled && "pointer-events-none opacity-55", className);
  if (disabled) {
    return (
      <a aria-disabled="true" role="link" data-testid={testId} className={classes}>
        {body}
      </a>
    );
  }
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" data-testid={testId} className={classes}>
      {body}
    </a>
  ) : plain ? (
    <a href={href} data-testid={testId} className={classes}>
      {body}
    </a>
  ) : (
    <Link href={href} data-testid={testId} className={classes}>
      {body}
    </Link>
  );
}
