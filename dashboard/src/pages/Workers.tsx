import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/DataTable";
import { Server } from "lucide-react";
import { usePolling } from "@/hooks/usePolling";
import { api, type WorkerWithStats, type WorkerStatus } from "@/api/client";
import { cn, formatRelativeTime } from "@/lib/utils";

const ALL_STATUSES = "all";

const statusStyles: Record<WorkerStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50",
  stopped: "bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-50",
};

function getHeartbeatHealth(lastHeartbeat: string): "green" | "yellow" | "red" {
  const diffMs = Date.now() - new Date(lastHeartbeat).getTime();
  const diffSec = diffMs / 1000;
  if (diffSec < 30) return "green";
  if (diffSec < 60) return "yellow";
  return "red";
}

const healthDotColors = {
  green: "bg-emerald-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
};

export function Workers() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<WorkerStatus | typeof ALL_STATUSES>(ALL_STATUSES);

  const fetcher = useCallback(
    () => api.getWorkers({ status: status === ALL_STATUSES ? undefined : status }),
    [status],
  );

  const { data, loading } = usePolling(fetcher, 5000);
  const workers = data?.workers ?? [];

  const columns: Column<WorkerWithStats>[] = [
    {
      key: "id",
      header: "Worker ID",
      render: (row) => (
        <code className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium font-mono">
          {row.id.slice(0, 8)}
        </code>
      ),
    },
    {
      key: "hostname",
      header: "Hostname",
      render: (row) => <span className="text-sm">{row.hostname}</span>,
    },
    {
      key: "pid",
      header: "PID",
      render: (row) => <span className="text-sm tabular-nums">{row.pid}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant="outline" className={cn("text-xs font-medium", statusStyles[row.status])}>
          {row.status === "active" ? "Active" : "Stopped"}
        </Badge>
      ),
    },
    {
      key: "concurrency",
      header: "Concurrency",
      render: (row) => <span className="text-sm tabular-nums">{row.concurrency}</span>,
    },
    {
      key: "running_jobs",
      header: "Running",
      render: (row) => (
        <span className="text-sm tabular-nums">
          {row.running_jobs} / {row.concurrency}
        </span>
      ),
    },
    {
      key: "started_at",
      header: "Started",
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {formatRelativeTime(row.started_at)}
        </span>
      ),
    },
    {
      key: "last_heartbeat",
      header: "Last Heartbeat",
      render: (row) => {
        const health = row.status === "active" ? getHeartbeatHealth(row.last_heartbeat) : null;
        return (
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {formatRelativeTime(row.last_heartbeat)}
            {health && (
              <span
                className={cn("inline-block h-2 w-2 rounded-full", healthDotColors[health])}
                title={`Heartbeat ${health === "green" ? "healthy" : health === "yellow" ? "warning" : "stale"}`}
              />
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Workers</h1>
          <p className="text-sm text-muted-foreground">
            Monitor active and stopped worker processes
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums font-medium text-foreground">{workers.length}</span> total
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" title="Live" />
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3">
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as WorkerStatus | typeof ALL_STATUSES)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border">
        <DataTable
          columns={columns}
          data={workers}
          loading={loading}
          onRowClick={(row) => navigate(`/jobs?status=running&worker_id=${row.id}`)}
          rowKey={(row) => row.id}
          emptyIcon={<Server className="h-6 w-6 text-muted-foreground" />}
          emptyTitle="No workers found"
          emptyDescription="Workers will appear here when they connect."
        />
      </div>
    </div>
  );
}
