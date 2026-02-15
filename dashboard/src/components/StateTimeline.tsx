import { cn } from "@/lib/utils";
import type { JobStatus } from "@/api/client";

const steps = [
  { key: "queued" as const, label: "Queued" },
  { key: "running" as const, label: "Running" },
  { key: "terminal" as const, label: "" },
] as const;

const statusColors: Record<string, string> = {
  queued: "bg-blue-500",
  running: "bg-amber-500",
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
};

const statusRing: Record<string, string> = {
  queued: "ring-blue-500/30",
  running: "ring-amber-500/30",
  succeeded: "ring-emerald-500/30",
  failed: "ring-red-500/30",
};

function statusStepIndex(status: JobStatus): number {
  switch (status) {
    case "queued":
      return 0;
    case "running":
      return 1;
    case "succeeded":
    case "failed":
      return 2;
  }
}

export function StateTimeline({ status }: { status: JobStatus }) {
  const activeIdx = statusStepIndex(status);
  const terminalLabel = status === "succeeded" ? "Succeeded" : status === "failed" ? "Failed" : "";

  return (
    <div className="flex items-center gap-0">
      {steps.map((step, i) => {
        const isActive = i <= activeIdx;
        const isCurrent = i === activeIdx;
        const label = step.key === "terminal" ? terminalLabel : step.label;
        const colorKey = step.key === "terminal" ? status : step.key;

        return (
          <div key={step.key} className="flex items-center">
            {/* Connector line */}
            {i > 0 && (
              <div
                className={cn(
                  "h-0.5 w-8",
                  isActive ? statusColors[colorKey] : "bg-border",
                )}
              />
            )}
            {/* Step circle + label */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={cn(
                  "h-3 w-3 rounded-full transition-all",
                  isActive ? statusColors[colorKey] : "bg-border",
                  isCurrent && "ring-4",
                  isCurrent && statusRing[colorKey],
                  isCurrent && status === "running" && "animate-pulse",
                )}
              />
              {label && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
