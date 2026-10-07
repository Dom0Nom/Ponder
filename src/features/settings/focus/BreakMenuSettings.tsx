import { ChevronRight } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { s } from "../../../lib/strings";
import { useUi } from "../../../stores/ui";
import { SettingsRow } from "../layout";

export function BreakMenuSettings() {
  const navigate = useUi((st) => st.navigate);
  return (
    <SettingsRow title={s.breakMenu.title} description={s.breakMenu.short}>
      <Button
        variant="ghost"
        size="sm"
        aria-label={s.breakMenu.editAria}
        onClick={() => navigate({ name: "settings", page: { kind: "breakMenu" } })}
      >
        <ChevronRight size={14} />
        {s.common.edit}
      </Button>
    </SettingsRow>
  );
}
