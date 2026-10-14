import * as Tip from "@radix-ui/react-tooltip";
import { useApplyAppearance } from "../../app/useTheme";
import { LocaleKey } from "../../lib/i18n/LocaleKey";
import { CalculatorWindowBody } from "./CalculatorPanel";

/** Entry for the pop-out window: only the calculator, scaled to fill the window. */
export function CalculatorWindow() {
  useApplyAppearance();
  return (
    <LocaleKey>
      <Tip.Provider>
        <CalculatorWindowBody />
      </Tip.Provider>
    </LocaleKey>
  );
}
