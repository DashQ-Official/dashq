import { useState, useCallback, useMemo } from "react";
import { useLocation, useSearch } from "wouter";
import { Eye, RotateCcw, Trash2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { formatDateTime, truncate } from "@/lib/utils";

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
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.created_at)}
        </span>
      ),
    },
    {
      key: "run_at",
      header: "Run At",
      sortable: true,
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatDateTime(row.run_at)}
        </span>
      ),
    },
    {
      key: "last_error",
      header: "Error",
      render: (row) =>
        row.last_error ? (
          <span className="text-sm text-red-600" title={row.last_error}>
            {truncate(row.last_error, 40)}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: "",
      className: "w-10",
      render: (row) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => navigate(`/jobs/${row.id}`)}>
              <Eye className="mr-2 h-4 w-4" />
              View
            </DropdownMenuItem>
            {row.status === "failed" && (
              <DropdownMenuItem onClick={() => handleRetry(row)}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Retry
              </DropdownMenuItem>
            )}
            {row.status !== "running" && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(row);
                }}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="text-sm text-muted-foreground">
          Browse and manage queued jobs
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
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
          data={jobs}
          loading={loading}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={(row) => navigate(`/jobs/${row.id}`)}
          rowKey={(row) => row.id}
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
