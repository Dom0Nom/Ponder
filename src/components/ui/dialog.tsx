import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { s } from "../../lib/strings";
import { Button } from "./button";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  bodyClassName,
  style,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="t-modal-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          // switching to another app and back must not dismiss a half-filled dialog
          onFocusOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            // focus the first field, not the close button
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>(
              "[autofocus], input:not([type=hidden]), textarea, select",
            );
            e.preventDefault();
            (el ?? (e.currentTarget as HTMLElement)).focus();
          }}
          className={cn(
            "t-modal fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(440px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-dialog border border-border bg-surface shadow-dialog outline-none",
            className,
          )}
          style={style}
        >
          <div className="flex items-start gap-4 pb-1 pl-5 pr-4 pt-4">
            <div className="min-w-0 flex-1">
              <D.Title className="text-title font-semibold">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-body text-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close
              aria-label={s.common.close}
              className="flex size-7 shrink-0 items-center justify-center rounded-btn text-fg hover:bg-fill"
            >
              <X size={15} />
            </D.Close>
          </div>
          <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3", bodyClassName)}>{children}</div>
          {footer && <div className="flex items-center justify-end gap-2 border-t border-divider px-5 py-3.5">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  danger?: boolean;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="t-modal-scrim fixed inset-0 z-40 bg-scrim" />
        <D.Content
          onFocusOutside={(e) => e.preventDefault()}
          className="t-modal fixed left-1/2 top-1/2 z-50 flex w-[min(400px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 rounded-dialog border border-border bg-surface p-5 shadow-dialog outline-none"
        >
          <D.Title className="text-title font-semibold">{title}</D.Title>
          <D.Description className="text-body-lg text-fg-secondary">{body}</D.Description>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" className="px-3.5" onClick={() => onOpenChange(false)}>
              {s.common.cancel}
            </Button>
            <Button
              variant={danger ? "danger" : "primary"}
              className="px-4"
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
