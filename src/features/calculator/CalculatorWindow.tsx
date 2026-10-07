import { useEffect, useState } from "react";
import { useApplyAppearance } from "../../app/useTheme";
import { s } from "../../lib/strings";
import { BODY, Calculator } from "./Calculator";

/** Entry for the pop-out window: only the calculator, scaled to fill the window. */
export function CalculatorWindow() {
  useApplyAppearance();
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const update = () => setScale(Math.min(window.innerWidth / BODY.w, window.innerHeight / BODY.h));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  useEffect(() => {
    document.title = s.calc.title;
  }, []);
  return (
    <div className="flex h-screen items-center justify-center overflow-hidden bg-surface">
      <Calculator globalKeys scale={scale} />
    </div>
  );
}
