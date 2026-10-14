import { api } from "../../lib/ipc";
import { queryClient, qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import { useUi } from "../../stores/ui";
import { toast, toastError } from "../../components/ui/toast";
import { formatList } from "../../lib/i18n/format";

// sonner drops a dismiss that lands before the toast has mounted
const dismissLater = (id: string | number) => setTimeout(() => toast.dismiss(id), 120);

export async function exportStudyPack(spaceId: string, spaceName: string) {
  const id = toast.loading(s.pack.exporting(spaceName));
  try {
    const res = await api.packExport(spaceId);
    if (!res) dismissLater(id);
    else toast.success(s.pack.exported(formatList([s.pack.nSources(res.counts.sources), s.pack.nCards(res.counts.cards), s.pack.nNotes(res.counts.notes)], "unit")), { id, description: res.path });
  } catch (e) {
    dismissLater(id);
    toastError(s.pack.exportFailed, e, () => void exportStudyPack(spaceId, spaceName));
  }
}

export async function importStudyPack() {
  const id = toast.loading(s.pack.importing);
  try {
    const res = await api.packImport();
    if (!res) {
      dismissLater(id);
      return;
    }
    for (const k of [qk.spaces, qk.dueCounts]) await queryClient.invalidateQueries({ queryKey: k });
    toast.success(res.counts.sources > 0 ? s.pack.importedIndexing(res.name, res.counts.sources) : s.pack.imported(res.name), { id });
    useUi.getState().navigate({ name: "space", spaceId: res.spaceId });
  } catch (e) {
    dismissLater(id);
    toastError(s.pack.importFailed, e, () => void importStudyPack());
  }
}
