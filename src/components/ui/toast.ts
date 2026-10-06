import { toast } from "sonner";
import { s } from "../../lib/strings";

/** Shows an error toast; with `retry`, the toast gets a Retry button. Nothing fails silently. */
export function toastError(title: string, error: unknown, retry?: () => void) {
  const description = error instanceof Error ? error.message : error ? String(error) : undefined;
  console.error(title, error);
  toast.error(title, {
    description,
    duration: retry ? 10000 : 6000,
    action: retry ? { label: s.common.retry, onClick: retry } : undefined,
  });
}

export { toast };
