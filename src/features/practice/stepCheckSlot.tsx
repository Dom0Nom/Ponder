import { useState } from "react";
import { ListChecks } from "lucide-react";
import { s } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { StepCheckerDialog } from "../steps/StepChecker";

export function StepCheckSlot({ spaceId, problem, expectedAnswer }: { spaceId: string; problem: string; expectedAnswer?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="practice-check-steps">
        <ListChecks size={15} /> {s.practice.checkSteps}
      </Button>
      <StepCheckerDialog open={open} onOpenChange={setOpen} spaceId={spaceId} problem={problem} expectedAnswer={expectedAnswer} />
    </>
  );
}
