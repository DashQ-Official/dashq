import { useState, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Eye, RotateCcw, Trash2, Search, AlertCircle, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable, type Column } from "@/components/DataTable";
import { Pagination } from "@/components/Pagination";
import { StatusBadge } from "@/components/StatusBadge";
import { usePolling } from "@/hooks/usePolling";
import { useApi } from "@/hooks/useApi";
import { api, type Job, type JobStatus } from "@/api/client";
import { formatDateTime, formatRelativeTime, truncate } from "@/lib/utils";

const LIMIT = 20;

const ALL_STATUSES = "all";
const ALL_TYPES = "all";

export function JobsList() {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const searchParams = useMemo(() => new URLSearchParams(searchStr), [searchStr]);

  const [status, setStatus] = useState<JobStatus | typeof ALL_STATUSES>(
    (searchParams.get("status") as JobStatus) ?? ALL_STATUSES,
  );
  const [jobType, setJobType] = useState<string>(ALL_TYPES);
  const [sortBy, setSortBy] = useState<"created_at" | "updated_at" | "run_at">("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const fetcher = useCallback(
    () =>
      api.getJobs({
        status: status === ALL_STATUSES ? undefined : status,
        job_type: jobType === ALL_TYPES ? undefined : jobType,
        sort_by: sortBy,
        sort_order: sortOrder,
        offset,
        limit: LIMIT,
      }),
    [status, jobType, sortBy, sortOrder, offset],
  );

  const { data, loading, refresh } = usePolling(fetcher, 5000);
  const { data: typesData } = useApi(() => api.getJobTypes(), []);

  const jobs = data?.jobs ?? [];
  const total = data?.total ?? 0;
  const jobTypes = typesData?.job_types ?? [];

  const filteredJobs = useMemo(() => {
    if (!searchQuery.trim()) return jobs;
    const q = searchQuery.toLowerCase();
    return jobs.filter(
      (j) =>
        j.id.toLowerCase().includes(q) ||
        j.job_type.toLowerCase().includes(q) ||
        j.last_error?.toLowerCase().includes(q),
    );
  }, [jobs, searchQuery]);

  function handleSort(key: string) {
    if (key === sortBy) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key as typeof sortBy);
      setSortOrder("desc");
    }
    setOffset(0);
  }

  async function handleRetry(job: Job) {
    await api.retryJob(job.id);
    refresh();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.deleteJob(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
  }

  const columns: Column<Job>[] = [
    {
      key: "job_type",
      header: "Job Type",
      render: (row) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
          {row.job_type}
        </code>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "attempts",
      header: "Attempts",
      render: (row) => (
        <span className="text-sm tabular-nums">
          {row.attempts}/{row.max_attempts}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      sortable: true,
      render: (row) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-sm text-muted-foreground">
              {formatRelativeTime(row.created_at)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(row.created_at)}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: "run_at",
      header: "Run At",
      sortable: true,
      render: (row) => (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-default text-sm text-muted-foreground">
              {formatRelativeTime(row.run_at)}
            </span>
          </TooltipTrigger>
          <TooltipContent>{formatDateTime(row.run_at)}</TooltipContent>
        </Tooltip>
      ),
    },
    {
      key: "last_error",
      header: "Error",
      render: (row) =>
        row.last_error ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1 text-sm text-red-600 cursor-default">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {truncate(row.last_error, 40)}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm bg-red-950 text-red-200 font-mono text-xs whitespace-pre-wrap">
              {row.last_error}
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="text-sm text-muted-foreground">&mdash;</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-24",
      render: (row) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => navigate(`/jobs/${row.id}`)}
              >
                <Eye />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View details</TooltipContent>
          </Tooltip>
          {row.status === "failed" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => handleRetry(row)}
                >
                  <RotateCcw />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retry job</TooltipContent>
            </Tooltip>
          )}
          {row.status !== "running" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-red-600"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete job</TooltipContent>
            </Tooltip>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Browse and manage queued jobs
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{total}</span> total
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Live" />
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search jobs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 w-56 rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-ring/50 focus:ring-[3px]"
          />
        </div>

        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as JobStatus | typeof ALL_STATUSES);
            setOffset(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="succeeded">Succeeded</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        {jobTypes.length > 0 && (
          <Select
            value={jobType}
            onValueChange={(v) => {
              setJobType(v);
              setOffset(0);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Job type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_TYPES}>All types</SelectItem>
              {jobTypes.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
        <DataTable
          columns={columns}
          data={filteredJobs}
          loading={loading}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(row) => navigate(`/jobs/${row.id}`)}
          rowKey={(row) => row.id}
          emptyIcon={<List className="h-6 w-6 text-muted-foreground" />}
          emptyTitle="No jobs found"
          emptyDescription="Try adjusting your filters or search query."
        />
      </div>

      <Pagination
        offset={offset}
        limit={LIMIT}
        total={total}
        onOffsetChange={setOffset}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete job?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the job and all its logs. This action
              cannot be undone.
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
    </div>
  );
}
