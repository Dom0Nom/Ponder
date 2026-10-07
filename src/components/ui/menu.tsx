import * as DM from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

const itemClass =
  "flex h-7.5 cursor-pointer select-none items-center gap-2.5 rounded-item px-2.5 font-medium outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-fill";
const contentClass =
  "t-dropdown z-50 flex min-w-[148px] flex-col rounded-pane border border-border bg-surface p-1 text-body text-fg";

export const popoverClass = "shadow-popover";

export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;
export const MenuGroup = DM.Group;
export const MenuRadioGroup = DM.RadioGroup;
export const MenuSub = DM.Sub;

export function MenuContent({ className, popover, ...p }: DM.DropdownMenuContentProps & { popover?: boolean }) {
  return (
    <DM.Portal>
      <DM.Content sideOffset={4} {...p} className={cn(contentClass, popover ? popoverClass : "shadow-menu", className)} />
    </DM.Portal>
  );
}

export function MenuItem({ danger, className, ...p }: DM.DropdownMenuItemProps & { danger?: boolean }) {
  return <DM.Item {...p} className={cn(itemClass, danger && "text-danger data-[highlighted]:bg-danger-hover", className)} />;
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DM.Separator className={cn("my-1 h-px bg-divider", className)} />;
}

export function MenuLabel({ className, ...p }: DM.DropdownMenuLabelProps) {
  return <DM.Label {...p} className={cn("px-2.5 pb-1 pt-2 text-label font-semibold text-muted", className)} />;
}

export function MenuRadioItem({ className, children, ...p }: DM.DropdownMenuRadioItemProps) {
  return (
    <DM.RadioItem {...p} className={cn(itemClass, "justify-between", className)}>
      {children}
      <DM.ItemIndicator>
        <Check size={14} />
      </DM.ItemIndicator>
    </DM.RadioItem>
  );
}

export function MenuSubTrigger({ className, children, ...p }: DM.DropdownMenuSubTriggerProps) {
  return (
    <DM.SubTrigger {...p} className={cn(itemClass, "justify-between data-[state=open]:bg-fill", className)}>
      {children}
      <ChevronRight size={14} className="text-muted" />
    </DM.SubTrigger>
  );
}

export function MenuSubContent({ className, ...p }: DM.DropdownMenuSubContentProps) {
  return (
    <DM.Portal>
      <DM.SubContent sideOffset={4} {...p} className={cn(contentClass, "shadow-menu", className)} />
    </DM.Portal>
  );
}
