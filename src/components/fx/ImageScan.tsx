import { useEffect, useRef, useState, type ReactNode } from "react";
import { ImageGeneration } from "img-fx";
import { useIsDark } from "../../app/useTheme";
import { acquireFxSlot, releaseFxSlot } from "../brand/glSlots";
import { useFxActive } from "./useFxActive";

/** img-fx sweep over a photo while the vision model reads it. Plain children when no GL slot is free. */
export default function ImageScan({ reading, children }: { reading: boolean; children: ReactNode }) {
  const dark = useIsDark();
  const ref = useRef<HTMLDivElement>(null);
  const active = useFxActive(ref);
  const [id] = useState(() => Symbol("img-fx"));
  const [slot, setSlot] = useState(false);
  useEffect(() => {
    if (!reading) return;
    setSlot(acquireFxSlot(id));
    return () => {
      releaseFxSlot(id);
      setSlot(false);
    };
  }, [reading, id]);
  if (!reading || !slot) return <>{children}</>;
  return (
    <div ref={ref}>
      <ImageGeneration preset="sweep-gradient" theme={dark ? "dark" : "light"} borderRadius={10} paused={!active} autoReveal={false}>
        {children}
      </ImageGeneration>
    </div>
  );
}
