import { useRef, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SparklineArea } from "@/components/SparklineArea";
import { usePolling } from "@/hooks/usePolling";
import { api, type JobStatus } from "@/api/client";
import { cn } from "@/lib/utils";

const statusCards: {
  key: JobStatus;
  label: string;
  icon: typeof Clock;
  color: string;
  sparkColor: string;
}[] = [
  {
    key: "queued",
    label: "Queued",
    icon: Clock,
    color: "text-blue-600",
    sparkColor: "#2563eb",
  },
  {
    key: "running",
    label: "Running",
    icon: Loader2,
    color: "text-amber-600",
    sparkColor: "#d97706",
  },
  {
    key: "succeeded",
    label: "Succeeded",
    icon: CheckCircle2,
    color: "text-emerald-600",
    sparkColor: "#059669",
  },
  {
    key: "failed",
    label: "Failed",
    icon: XCircle,
    color: "text-red-600",
    sparkColor: "#dc2626",
  },
];

const MAX_HISTORY = 20;

export function Overview() {
  const [, navigate] = useLocation();

  const historyRef = useRef<Record<JobStatus, number[]>>({
    queued: [],
    running: [],
    succeeded: [],
    failed: [],
  });

  const fetcher = useCallback(async () => {
    const result = await api.getOverview();
    const counts = result.counts;

    // Accumulate history for sparklines
    for (const key of Object.keys(counts) as JobStatus[]) {
      const arr = historyRef.current[key];
      arr.push(counts[key] ?? 0);
      if (arr.length > MAX_HISTORY) arr.shift();
    }

    return counts;
  }, []);

  const { data: counts, loading } = usePolling(fetcher, 5000);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Job queue status at a glance
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statusCards.map((card) => {
          const Icon = card.icon;
          const count = counts?.[card.key] ?? 0;
          const history = historyRef.current[card.key];

          return (
            <Card
              key={card.key}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/jobs?status=${card.key}`)}
            >
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className={cn("h-4 w-4", card.color)} />
                    <span className="text-sm font-medium text-muted-foreground">
                      {card.label}
                    </span>
                  </div>
                </div>
                {loading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <p className="text-3xl font-bold tabular-nums">{count}</p>
                )}
                <div className="h-10">
                  {history.length >= 2 && (
                    <SparklineArea
                      data={history}
                      color={card.sparkColor}
                      id={card.key}
                    />
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
