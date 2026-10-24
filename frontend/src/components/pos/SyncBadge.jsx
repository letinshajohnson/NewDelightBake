import { CloudOff, RefreshCw, Wifi, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";

export default function SyncBadge({ sync }) {
  const { t } = useI18n();
  const { online, pending, failed, syncing, syncNow } = sync;
  const run = async () => {
    const r = await syncNow();
    if (r?.error) toast.error("Sync failed — will retry automatically");
    else if (r?.sent) toast.success(`${r.sent} item(s) synced`);
    if (r?.failed) toast.error(`${r.failed} sale(s) were rejected by the server — see Sales`);
  };
  return (
    <div className="flex items-center gap-2" data-testid="sync-badge">
      <span className={`relative flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium ${online ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`} data-testid="connection-status">
        {!online && <span className="absolute -top-0.5 -end-0.5 w-2 h-2 rounded-full bg-warning animate-ping" />}
        {online ? <Wifi className="w-3.5 h-3.5" /> : <CloudOff className="w-3.5 h-3.5" />}{online ? t("online") : t("offline")}
      </span>
      {pending > 0 && (
        <span className="relative px-2.5 h-8 inline-flex items-center rounded-md text-xs font-medium bg-warning/15 text-warning" data-testid="pending-sync-count">
          <span className="absolute -top-0.5 -end-0.5 w-2 h-2 rounded-full bg-warning animate-ping" />
          {pending} {t("pending_sync")}
        </span>
      )}
      {failed > 0 && <span className="px-2 h-8 inline-flex items-center gap-1 rounded-md text-xs bg-destructive/15 text-destructive" data-testid="failed-sync-count"><AlertTriangle className="w-3.5 h-3.5" />{failed}</span>}
      <Button size="sm" variant="outline" onClick={run} disabled={syncing || !online} data-testid="sync-now-btn" className="h-8">
        <RefreshCw className={`w-3.5 h-3.5 me-1 ${syncing ? "animate-spin" : ""}`} />{t("sync_now")}
      </Button>
    </div>
  );
}
