import { useEffect, useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import * as Tip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import { api } from "../lib/ipc";
import { queryClient, useCards } from "../lib/queries";
import { occlusionGroups } from "../lib/srs/occlusion";
import type { Card } from "../lib/types";
import { Button } from "../components/ui/button";
import { OcclusionEditorButton } from "../features/cards/OcclusionEditorButton";
import { OcclusionEditor } from "../features/cards/OcclusionEditor";
import { OcclusionCardView } from "../features/cards/OcclusionCardView";

/** Mock-only page for e2e (`/?harness=occlusion`) until the editor is placed in the Flashcards card. */
export function App() {
  const [spaceId, setSpaceId] = useState<string | null>(null);
  useEffect(() => {
    api.createSpace({ name: "Occlusion" }).then((sp) => setSpaceId(sp.id));
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <Tip.Provider>
        <div className="h-full overflow-auto p-6">{spaceId && <Harness spaceId={spaceId} />}</div>
        <Toaster position="bottom-right" richColors closeButton theme="system" />
      </Tip.Provider>
    </QueryClientProvider>
  );
}

function Harness({ spaceId }: { spaceId: string }) {
  const cards = useCards(spaceId);
  const [editing, setEditing] = useState<Card[] | undefined>();
  const [revealed, setRevealed] = useState(false);
  const groups = occlusionGroups(cards.data ?? []);
  return (
    <div className="flex flex-col gap-4">
      <OcclusionEditorButton spaceId={spaceId} />
      {groups.map((g) => (
        <div key={g[0].id} className="flex flex-col gap-2" data-testid="occlusion-group">
          <OcclusionCardView card={g[0]} revealed={revealed} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setRevealed((r) => !r)}>
              Reveal
            </Button>
            <Button size="sm" onClick={() => setEditing(g)}>
              Edit
            </Button>
          </div>
        </div>
      ))}
      <OcclusionEditor spaceId={spaceId} open={!!editing} onOpenChange={(o) => !o && setEditing(undefined)} cards={editing} />
    </div>
  );
}
