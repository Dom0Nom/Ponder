import * as Sw from "@radix-ui/react-switch";
import * as Tip from "@radix-ui/react-tooltip";
import { AlertCircle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { s } from "../../lib/strings";
import { Button } from "./button";

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Sw.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-accent data-[state=unchecked]:bg-surface-3 disabled:opacity-50",
        className,
      )}
    >
      <Sw.Thumb className="block h-4 w-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0 dark:data-[state=checked]:bg-on-accent" />
    </Sw.Root>
  );
}

export function Tooltip({ content, children, side }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tip.Root delayDuration={400}>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content
          side={side ?? "bottom"}
          sideOffset={6}
          className="z-[60] rounded-lg bg-fg px-2.5 py-1.5 text-xs text-bg shadow-lg"
        >
          {content}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader2 size={size} className={cn("animate-spin text-muted", className)} aria-label={s.common.loading} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 rounded-full bg-surface-2 p-3 text-muted">{icon}</div>}
      <p className="text-[0.9375rem] font-medium">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ title, error, onRetry, className }: { title: string; error: unknown; onRetry?: () => void; className?: string }) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 py-8 text-center", className)}>
      <div className="mb-3 rounded-full bg-danger-soft p-3 text-danger">
        <AlertCircle size={20} />
      </div>
      <p className="font-medium">{title}</p>
      {msg && <p className="mt-1 max-w-sm break-words text-sm text-muted">{msg}</p>}
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          {s.common.retry}
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface-2 px-1.5 py-0.5 font-sans text-[0.6875rem] text-muted">
      {children}
    </kbd>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-border bg-surface p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full font-medium transition-colors",
            size === "sm" ? "h-7 px-3 text-xs" : "h-8 px-3.5 text-[0.8125rem]",
            value === o.value ? "bg-accent-soft text-accent-text" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
