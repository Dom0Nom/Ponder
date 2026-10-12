import * as Tip from "@radix-ui/react-tooltip";
import { useApplyAppearance } from "../../app/useTheme";
import { CalculatorWindowBody } from "./CalculatorPanel";

/** Entry for the pop-out window: only the calculator, scaled to fill the window. */
export function CalculatorWindow() {
  useApplyAppearance();
  return (
    <Tip.Provider>
      <CalculatorWindowBody />
    </Tip.Provider>
  );
}
