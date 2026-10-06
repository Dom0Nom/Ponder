import { useEffect, useRef, useState } from "react";
import { Camera, ImagePlus, RotateCcw, ScanText, X } from "lucide-react";
import { Dialog } from "../../components/ui/dialog";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/input";
import { Segmented, Spinner } from "../../components/ui/misc";
import { NativeSelect } from "../settings/NativeSelect";
import { ModelPicker } from "../settings/ModelPicker";
import { api } from "../../lib/ipc";
import { NoModelError } from "../../lib/chat/llm";
import { qk, queryClient, useSettings, useSpace } from "../../lib/queries";
import { resolveVisionModel, transcribeSteps, VISION_SETTING, type Transcription } from "../../lib/steps/vision";
import { s } from "../../lib/strings";
import type { ModelRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import { imageFromClipboard, photoFromBlob, photoFromVideo, type Photo } from "./image";

type Tab = "camera" | "file";

function cameraMessage(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return s.steps.cameraDenied;
  if (name === "NotFoundError" || name === "OverconstrainedError") return s.steps.cameraNone;
  return s.steps.cameraError;
}

function CameraView({ onPhoto }: { onPhoto: (p: Photo) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [shown, setShown] = useState("");
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      setError(s.steps.cameraUnavailable);
      return;
    }
    let stream: MediaStream | null = null;
    let cancelled = false;
    setLive(false);
    setError(null);
    md.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1920 } }, audio: false })
      .then(async (st) => {
        if (cancelled) return st.getTracks().forEach((t) => t.stop());
        stream = st;
        if (video.current) {
          video.current.srcObject = st;
          await video.current.play().catch(() => {});
        }
        setLive(true);
        // labels are only filled in once access is granted
        const all = await md.enumerateDevices();
        if (!cancelled) setDevices(all.filter((d) => d.kind === "videoinput"));
        setShown(st.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId);
      })
      .catch((e) => !cancelled && setError(cameraMessage(e)));
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [deviceId]);

  if (error) {
    return (
      <p role="alert" className="rounded-xl bg-warn-soft px-3 py-2.5 text-sm" data-testid="camera-error">
        {error}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {devices.length > 0 && (
        <div>
          <Label htmlFor="step-camera">{s.steps.camera}</Label>
          <NativeSelect id="step-camera" value={shown} onChange={(e) => (setShown(e.target.value), setDeviceId(e.target.value))}>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `${s.steps.camera} ${i + 1}`}
              </option>
            ))}
          </NativeSelect>
        </div>
      )}
      <p className="text-xs text-muted">{s.steps.continuityHint}</p>
      <div className="relative overflow-hidden rounded-xl bg-surface-2">
        <video ref={video} muted playsInline className="aspect-video w-full object-contain" />
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted">
            <Spinner /> {s.steps.cameraStarting}
          </div>
        )}
      </div>
      <Button variant="primary" size="sm" disabled={!live} onClick={() => video.current && onPhoto(photoFromVideo(video.current))}>
        <Camera size={15} /> {s.steps.takePhoto}
      </Button>
    </div>
  );
}

function FileView({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted transition-colors",
        over ? "border-accent bg-accent-soft" : "border-border",
      )}
      data-testid="photo-drop"
    >
      <ImagePlus size={22} aria-hidden />
      <p>{s.steps.drop}</p>
      <Button size="sm" onClick={() => input.current?.click()}>
        {s.steps.chooseFile}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="step-photo-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function PhotoDialog({
  open,
  onOpenChange,
  spaceId,
  initialImage,
  onRead,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  spaceId: string;
  initialImage?: Blob | null;
  onRead: (t: Transcription) => void;
}) {
  const space = useSpace(spaceId);
  const settings = useSettings();
  const hasCamera = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const [tab, setTab] = useState<Tab>("file");
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const takeFile = async (f: Blob) => {
    setError(null);
    if (!f.type.startsWith("image/")) return setError(s.steps.notImage);
    try {
      setPhoto(await photoFromBlob(f));
    } catch {
      setError(s.steps.notImage);
    }
  };

  useEffect(() => {
    if (!open) {
      abort.current?.abort();
      setPhoto(null);
      setError(null);
      setReading(false);
      return;
    }
    setTab("file");
    if (initialImage) void takeFile(initialImage);
    const onPaste = (e: ClipboardEvent) => {
      const f = imageFromClipboard(e);
      if (f) {
        e.preventDefault();
        setTab("file");
        void takeFile(f);
      }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [open, initialImage]);

  const read = async () => {
    if (!photo) return;
    setReading(true);
    setError(null);
    const ac = new AbortController();
    abort.current = ac;
    try {
      const llm = await resolveVisionModel(space.data);
      const t = await transcribeSteps(llm, photo, { signal: ac.signal });
      if (ac.signal.aborted) return;
      onRead(t);
      onOpenChange(false);
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof NoModelError ? s.chat.noModel : `${s.steps.readFailed}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  };

  const visionRef = (settings.data?.[VISION_SETTING] as ModelRef | null | undefined) ?? null;
  const setVisionRef = async (v: ModelRef | null) => {
    await api.setSetting(VISION_SETTING, v);
    await queryClient.invalidateQueries({ queryKey: qk.settings });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s.steps.photoTitle}
      description={s.steps.photoBody}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {s.common.cancel}
          </Button>
          <Button variant="primary" disabled={!photo || reading} onClick={read}>
            {reading ? <Spinner className="text-on-accent" /> : <ScanText size={16} />}
            {reading ? s.steps.reading : s.steps.read}
          </Button>
        </>
      }
    >
      <div className="space-y-4 pb-2">
        {photo ? (
          <div className="relative">
            <img src={photo.url} alt={s.steps.photoAlt} className="max-h-72 w-full rounded-xl bg-surface-2 object-contain" data-testid="photo-preview" />
            <div className="absolute right-2 top-2 flex gap-1">
              <Button size="icon-sm" variant="secondary" aria-label={tab === "camera" ? s.steps.retake : s.steps.removeImage} onClick={() => setPhoto(null)}>
                {tab === "camera" ? <RotateCcw size={14} /> : <X size={14} />}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Segmented
              label={s.steps.photoTitle}
              value={tab}
              onChange={setTab}
              options={[
                { value: "file", label: s.steps.tabFile },
                { value: "camera", label: s.steps.tabCamera, title: hasCamera ? s.steps.continuityHint : s.steps.cameraUnavailable },
              ]}
            />
            {tab === "camera" ? <CameraView onPhoto={setPhoto} /> : <FileView onFile={takeFile} />}
          </>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}
        <div>
          <Label>{s.steps.readModel}</Label>
          <ModelPicker value={visionRef} onChange={setVisionRef} allowDefault />
          <p className="mt-1 text-xs text-muted">{s.steps.readModelHint}</p>
        </div>
      </div>
    </Dialog>
  );
}
