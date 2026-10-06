import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { s } from "../../lib/strings";
import { Button, type ButtonProps } from "../../components/ui/button";
import { OcclusionEditor } from "./OcclusionEditor";

export function OcclusionEditorButton({
  spaceId,
  variant = "secondary",
  size = "sm",
  className,
}: {
  spaceId: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} size={size} className={className} data-testid="occlusion-editor-button" onClick={() => setOpen(true)}>
        <ImagePlus size={14} />
        {s.occlusion.open}
      </Button>
      <OcclusionEditor spaceId={spaceId} open={open} onOpenChange={setOpen} />
    </>
  );
}
