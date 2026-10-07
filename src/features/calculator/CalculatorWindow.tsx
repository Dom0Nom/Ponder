import { useEffect } from "react";
import { useApplyAppearance } from "../../app/useTheme";
import { s } from "../../lib/strings";
import { Calculator } from "./Calculator";

/** Entry for the pop-out window: only the calculator, at its natural 400×560 size. */
export function CalculatorWindow() {
  useApplyAppearance();
  useEffect(() => {
    document.title = s.calc.title;
  }, []);
  return (
    <div className="flex h-full min-h-[560px] items-start justify-center overflow-hidden bg-surface">
      <Calculator globalKeys />
    </div>
  );
}
