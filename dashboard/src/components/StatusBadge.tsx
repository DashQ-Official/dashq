import { Badge } from "@/components/ui/badge";
import type { JobStatus } from "@/api/client";
import { cn } from "@/lib/utils";

const statusConfig: Record<
  JobStatus,
  { label: string; className: string }
> = {
  queued: {
    label: "Queued",
    className:
      "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50",
  },
  running: {
    label: "Running",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50",
  },
  succeeded: {
    label: "Succeeded",
    className:
      "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
  },
  failed: {
    label: "Failed",
    className:
      "bg-red-50 text-red-700 border-red-200 hover:bg-red-50",
  },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = statusConfig[status];
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", config.className)}>
      {config.label}
    </Badge>
  );
}
