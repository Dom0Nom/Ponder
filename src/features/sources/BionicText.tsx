import { memo, useMemo } from "react";
import { bionicSegments } from "../../lib/reading/bionic";

const Chunk = memo(function Chunk({ text }: { text: string }) {
  const segs = useMemo(() => bionicSegments(text), [text]);
  return (
    <>
      {segs.map((g, i) =>
        g.bold ? (
          <b key={i} className="font-semibold">
            {g.text}
          </b>
        ) : (
          g.text
        ),
      )}
    </>
  );
});

/** Renders text with bold word starts; chunked per line so long sources stay cheap to update. */
export const BionicText = memo(function BionicText({ text }: { text: string }) {
  const chunks = useMemo(() => text.match(/[^\n]*\n|[^\n]+/g) ?? [], [text]);
  return (
    <>
      {chunks.map((c, i) => (
        <Chunk key={i} text={c} />
      ))}
    </>
  );
});
