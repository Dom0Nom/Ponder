import { Timer } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Kbd, Tooltip } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";

/** Compact timer in the header; shows a start button when no session runs. */
export function FocusHeaderTimer() {
  const open = useUi((st) => st.setFocusDialogOpen);
  return (
    <Tooltip content={<span>{s.focus.startTitle} <Kbd>{s.focus.shortcut}</Kbd></span>}>
      <Button variant="tonal" size="sm" onClick={() => open(true)}>
        <Timer size={15} /> {s.focus.start}
      </Button>
    </Tooltip>
  );
}
