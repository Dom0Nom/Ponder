import * as Sw from "@radix-ui/react-switch";
import * as Tip from "@radix-ui/react-tooltip";
import { AlertCircle, Loader } from "lucide-react";
import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../../lib/utils";
import { s } from "../../lib/strings";
import { useSlidingPill } from "../motion/useSlidingPill";
import { Button } from "./button";

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  className,
  size = "md",
}: {
  checked: boolean;
  onCheckedChange: (c: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  return (
    <Sw.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      disabled={disabled}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full t-toggle data-[state=checked]:bg-primary data-[state=unchecked]:bg-control-off disabled:cursor-default disabled:opacity-50",
        sm ? "h-4 w-7" : "h-4.5 w-7.5",
        className,
      )}
    >
      <Sw.Thumb
        className={cn(
          "block translate-x-[calc(0.125rem*var(--dir-x))] rounded-full bg-surface t-toggle-thumb data-[state=checked]:translate-x-[calc(0.875rem*var(--dir-x))]",
          sm ? "size-3" : "size-3.5",
        )}
      />
    </Sw.Root>
  );
}

export function Tooltip({
  content,
  description,
  children,
  side,
}: {
  content: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tip.Root delayDuration={400}>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content
          side={side ?? "bottom"}
          sideOffset={6}
          className="t-tt-radix z-[60] max-w-[220px] rounded-btn bg-primary px-2.5 py-[7px] text-label leading-[1.35] text-on-primary"
        >
          {description ? (
            <>
              <b className="block font-semibold">{content}</b>
              <span className="text-tooltip-muted">{description}</span>
            </>
          ) : (
            content
          )}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}

export function Spinner({ className, size = 16 }: { className?: string; size?: number }) {
  return <Loader size={size} className={cn("m-spin text-muted", className)} aria-label={s.common.loading} />;
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("t-skel-skeleton is-pulsing", className)} aria-hidden>
      <div className="size-full rounded-[inherit] bg-fill-active" />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  size = "md",
}: {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  className?: string;
  size?: "md" | "sm";
}) {
  const sm = size === "sm";
  return (
    <div
      className={cn(
        "t-stagger is-shown flex flex-col items-center justify-center text-center",
        sm ? "px-6 py-6" : "gap-2.5 p-10",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "t-stagger-line flex items-center justify-center bg-fill text-fg",
            sm ? "mb-3 size-[34px] rounded-pane" : "size-11 rounded-dialog",
          )}
        >
          {icon}
        </div>
      )}
      <p className={cn("t-stagger-line font-semibold", sm ? "text-title" : "mt-1 text-section")}>{title}</p>
      {body && (
        <p
          className={cn(
            "t-stagger-line t-stagger-line--2 max-w-[380px] text-muted",
            sm ? "mt-1 text-body" : "text-body-lg leading-[1.5]",
          )}
        >
          {body}
        </p>
      )}
      {action && <div className={cn("t-stagger-line t-stagger-line--3", sm ? "mt-4" : "mt-2")}>{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  error,
  onRetry,
  className,
  size = "md",
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
  size?: "md" | "sm";
}) {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const sm = size === "sm";
  return (
    <div role="alert" className={cn("flex flex-col items-center px-6 text-center", sm ? "py-6" : "py-8", className)}>
      <div
        className={cn(
          "mb-3 flex items-center justify-center bg-danger-soft text-danger",
          sm ? "size-[34px] rounded-pane" : "size-11 rounded-dialog",
        )}
      >
        <AlertCircle size={20} />
      </div>
      <p className="font-semibold">{title}</p>
      {msg && <p className="mt-1 max-w-sm break-words text-body text-muted">{msg}</p>}
      {onRetry && (
        <Button className="mt-4" size="sm" onClick={onRetry}>
          {s.common.retry}
        </Button>
      )}
    </div>
  );
}

export function Kbd({
  keys,
  children,
  className,
  ...rest
}: { keys?: string[]; children?: ReactNode; className?: string } & HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      {...rest}
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center gap-px rounded-kbd bg-keycap px-1.25 font-kbd text-kbd font-semibold leading-none text-fg-secondary",
        className,
      )}
    >
      {keys ? keys.join("") : children}
    </kbd>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
  block,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
  label: string;
  size?: "sm" | "md";
  block?: boolean;
}) {
  const list = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useSlidingPill(list, pill, value);
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={label}
      className={cn(
        "t-tabs inline-flex gap-0.5 border border-field p-0.5",
        size === "sm" ? "rounded-btn" : "rounded-control",
        block && "flex w-full",
      )}
    >
      <span ref={pill} className="t-tabs-pill" aria-hidden />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "t-tab flex flex-1 items-center justify-center whitespace-nowrap transition-colors",
            size === "sm" ? "h-6.5 rounded-kbd px-2 text-label" : "h-7.5 rounded-item px-2.5",
            value === o.value ? "font-semibold text-fg" : "font-medium text-fg hover:bg-fill",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
