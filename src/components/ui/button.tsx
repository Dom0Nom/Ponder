import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "ghost-muted" | "chrome" | "danger" | "success";
type Size = "sm" | "md" | "lg" | "icon" | "icon-sm" | "icon-xs";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-on-primary font-semibold hover:bg-primary-hover",
  secondary: "border border-control bg-transparent text-fg font-semibold hover:bg-fill-subtle",
  ghost: "text-fg font-medium hover:bg-fill",
  "ghost-muted": "text-muted font-medium hover:bg-fill hover:text-fg",
  chrome: "text-fg font-medium hover:bg-fill-active aria-pressed:bg-pressed aria-pressed:hover:bg-pressed",
  danger: "bg-danger text-on-danger font-semibold hover:brightness-110",
  success: "bg-success text-on-success font-medium hover:brightness-110",
};
const sizes: Record<Size, string> = {
  sm: "h-7.5 px-2.25 gap-1.5 rounded-btn",
  md: "h-8.5 px-3.5 gap-2 rounded-control",
  lg: "h-9 px-3.5 gap-2 rounded-control",
  icon: "size-8 rounded-btn",
  "icon-sm": "size-7 rounded-btn",
  "icon-xs": "size-6 rounded-item",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap text-body m-press disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
