import { useState } from "react";
import { Image } from "lucide-react";
import { LearnChevron } from "../../components/motion/LearnChevron";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { panelRow } from "../space/PanelList";
import { OcclusionEditor } from "./OcclusionEditor";

export function OcclusionEditorButton({ spaceId, className }: { spaceId: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className={cn(panelRow, "t-learn h-[42px] w-full gap-3 text-left", className)}
        data-testid="occlusion-editor-button"
        onClick={() => setOpen(true)}
      >
        <Image size={15} />
        <span className="flex-1 font-medium">{s.occlusion.open}</span>
        <LearnChevron size={14} />
      </button>
      <OcclusionEditor spaceId={spaceId} open={open} onOpenChange={setOpen} />
    </>
  );
}
