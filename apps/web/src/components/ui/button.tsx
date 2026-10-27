import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/**
 * The one button style of the app.
 *  - default   = Primary: filled accent. The ONE main action of a page.
 *  - outline   = Secondary: every other action.
 *  - destructive = Danger: red, only for skip / delete / disconnect.
 *  - secondary = a soft tinted button, ghost = no border, link = text.
 * Sizes: sm (table rows), default (forms), lg (the big call to action on Home).
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-transparent font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/35 active:translate-y-px disabled:pointer-events-none disabled:opacity-55 aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-brand-strong",
        outline: "border-input bg-card text-foreground shadow-sm hover:border-zinc-400 hover:bg-muted",
        secondary: "bg-brand-tint text-accent-foreground hover:bg-emerald-100",
        ghost: "text-foreground hover:bg-muted",
        destructive: "border-red-200 bg-red-50 text-red-700 hover:border-red-700 hover:bg-red-700 hover:text-white focus-visible:ring-red-500/30",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 text-sm",
        sm: "h-9 px-3 text-sm",
        xs: "h-8 px-2.5 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "size-10",
        "icon-sm": "size-9",
        "icon-xs": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  icon,
  pending = false,
  children,
  disabled,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & { /** a ready element such as <Rocket />, never a component (components cannot cross from server to client code) */ icon?: React.ReactNode; pending?: boolean }) {
  return (
    <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} disabled={disabled || pending} aria-busy={pending || undefined} {...props}>
      {pending ? <Spinner /> : icon}
      {children}
    </ButtonPrimitive>
  );
}

export { Button, buttonVariants };
