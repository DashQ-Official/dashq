import { useState, useCallback } from "react";
import { useLocation, useParams } from "wouter";
import {
  ArrowLeft,
  RotateCcw,
  Copy,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
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
import { StatusBadge } from "@/components/StatusBadge";
import { StateTimeline } from "@/components/StateTimeline";
import { JsonViewer } from "@/components/JsonViewer";
import { LogViewer } from "@/components/LogViewer";
import { usePolling } from "@/hooks/usePolling";
import { api } from "@/api/client";
import { formatDateTime, formatRelativeTime } from "@/lib/utils";

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
        <Skeleton className="h-8 w-48" />
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/jobs")}>
            <ArrowLeft className="mr-1 h-4 w-4" />
            Back
          </Button>
          <Separator orientation="vertical" className="h-6" />
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

        {/* Actions */}
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

      {/* Content */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left column */}
        <div className="space-y-6">
          {/* Metadata */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <StatusBadge status={job.status} />
                </dd>
                <dt className="text-muted-foreground">Attempts</dt>
                <dd className="tabular-nums">
                  {job.attempts} / {job.max_attempts}
                </dd>
                <dt className="text-muted-foreground">Created</dt>
                <dd title={job.created_at}>
                  {formatDateTime(job.created_at)}
                  <span className="ml-1 text-xs text-muted-foreground">
                    ({formatRelativeTime(job.created_at)})
                  </span>
                </dd>
                <dt className="text-muted-foreground">Run At</dt>
                <dd title={job.run_at}>{formatDateTime(job.run_at)}</dd>
                <dt className="text-muted-foreground">Updated</dt>
                <dd title={job.updated_at}>
                  {formatDateTime(job.updated_at)}
                </dd>
                {job.locked_until && (
                  <>
                    <dt className="text-muted-foreground">Locked Until</dt>
                    <dd>{formatDateTime(job.locked_until)}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          {/* State timeline */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <StateTimeline status={job.status} />
            </CardContent>
          </Card>

          {/* Arguments */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Arguments</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonViewer data={job.args} />
            </CardContent>
          </Card>

          {/* Error */}
          {job.last_error && (
            <Card className="border-red-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-base text-red-600">Error</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="overflow-auto rounded-lg bg-red-50 p-4 text-sm text-red-800 font-mono whitespace-pre-wrap">
                  {job.last_error}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column — Logs */}
        <div>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Logs</CardTitle>
            </CardHeader>
            <CardContent>
              <LogViewer
                logs={logs}
                selectedAttempt={selectedAttempt}
                onAttemptChange={setSelectedAttempt}
                maxAttempts={job.attempts}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
