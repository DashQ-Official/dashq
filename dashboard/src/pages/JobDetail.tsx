import { useState, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  RotateCcw,
  Copy,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/StatusBadge";
import { StateTimeline } from "@/components/StateTimeline";
import { JsonViewer } from "@/components/JsonViewer";
import { LogViewer } from "@/components/LogViewer";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/api/client";
import { cn, formatDateTime, formatRelativeTime } from "@/lib/utils";

const statusBorderColor: Record<string, string> = {
  queued: "border-l-blue-500",
  running: "border-l-amber-500",
  succeeded: "border-l-emerald-500",
  failed: "border-l-red-500",
};

export function JobDetail() {
  const params = useParams<{ id: string }>();
  const id = params.id!;
  const [, navigate] = useLocation();
  const [selectedAttempt, setSelectedAttempt] = useState<number | undefined>(
    undefined,
  );

  const jobFetcher = useCallback(() => api.getJob(id), [id]);
  const logFetcher = useCallback(() => api.getJobLogs(id), [id]);

  const { data: jobData, loading: jobLoading, refresh: refreshJob } = usePolling(jobFetcher, 5000);
  const { data: logData } = usePolling(logFetcher, 3000);

  const job = jobData?.job ?? null;
  const logs = logData?.logs ?? [];

  async function handleRetry() {
    await api.retryJob(id);
    refreshJob();
  }

  async function handleRequeue() {
    const result = await api.requeueJob(id);
    navigate(`/jobs/${result.job.id}`);
  }

  async function handleDelete() {
    await api.deleteJob(id);
    navigate("/jobs");
  }

  if (jobLoading && !job) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 rounded-lg" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Jobs
        </Button>
        <p className="text-muted-foreground">Job not found.</p>
      </div>
    );
  }

  const metadataItems = [
    {
      label: "Attempts",
      value: `${job.attempts} / ${job.max_attempts}`,
    },
    {
      label: "Created",
      value: formatRelativeTime(job.created_at),
      tooltip: formatDateTime(job.created_at),
    },
    {
      label: "Run At",
      value: formatRelativeTime(job.run_at),
      tooltip: formatDateTime(job.run_at),
    },
    {
      label: "Updated",
      value: formatRelativeTime(job.updated_at),
      tooltip: formatDateTime(job.updated_at),
    },
    ...(job.locked_until
      ? [
          {
            label: "Locked Until",
            value: formatRelativeTime(job.locked_until),
            tooltip: formatDateTime(job.locked_until),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      {/* Unified Header Block */}
      <div
        className={cn(
          "rounded-lg bg-card shadow-sm border-l-4",
          statusBorderColor[job.status] ?? "border-l-border",
        )}
      >
        {/* Top row: nav + identity + actions */}
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}>
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
            <div className="h-6 w-px bg-border" />
            <div>
              <div className="flex items-center gap-2">
                <code className="text-lg font-semibold">{job.job_type}</code>
                <StatusBadge status={job.status} />
              </div>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {job.id}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            {job.status === "failed" && (
              <Button variant="outline" size="sm" onClick={handleRetry}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                Retry
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={handleRequeue}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Requeue
            </Button>
            {job.status !== "running" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete job?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this job and all its logs.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDelete}
                      className="bg-red-600 hover:bg-red-700"
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </div>

        {/* Middle row: metadata strip */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/50 px-5 py-3">
          {metadataItems.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              {item.tooltip ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default tabular-nums font-medium">
                      {item.value}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{item.tooltip}</TooltipContent>
                </Tooltip>
              ) : (
                <span className="tabular-nums font-medium">{item.value}</span>
              )}
            </div>
          ))}
        </div>

        {/* Bottom row: state timeline */}
        <div className="border-t border-border/50 px-5 py-3">
          <StateTimeline status={job.status} />
        </div>
      </div>

      {/* Two-column content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column: Arguments + Error */}
        <div className="space-y-6">
          <div>
            <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
              Arguments
            </h3>
            <JsonViewer data={job.args} />
          </div>

          {job.last_error && (
            <div>
              <h3 className="text-xs font-medium uppercase tracking-wider text-red-600 mb-3">
                Error
              </h3>
              <div className="rounded-lg border-l-4 border-l-red-400 bg-red-50 p-4">
                <pre className="overflow-auto text-sm text-red-800 font-mono whitespace-pre-wrap">
                  {job.last_error}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Logs */}
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
            Logs
          </h3>
          <LogViewer
            logs={logs}
            selectedAttempt={selectedAttempt}
            onAttemptChange={setSelectedAttempt}
            maxAttempts={job.attempts}
          />
        </div>
      </div>
    </div>
  );
}
