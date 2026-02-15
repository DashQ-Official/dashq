import { useEffect, useRef, useMemo } from "react";
import type { JobLog } from "@/api/client";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const levelStyles: Record<string, string> = {
  info: "text-blue-400",
  warn: "text-amber-400",
  error: "text-red-400",
};

const levelBadgeStyles: Record<string, string> = {
  info: "bg-blue-500/20 text-blue-400",
  warn: "bg-amber-500/20 text-amber-400",
  error: "bg-red-500/20 text-red-400",
};

function formatLogTime(iso: string): string {
  const d = new Date(iso);
  const base = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${base}.${ms}`;
}

type LogViewerProps = {
  logs: JobLog[];
  selectedAttempt: number | undefined;
  onAttemptChange: (attempt: number | undefined) => void;
  maxAttempts: number;
};

export function LogViewer({
  logs,
  selectedAttempt,
  onAttemptChange,
  maxAttempts,
}: LogViewerProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs.length]);

  const attempts = useMemo(() => {
    const set = new Set<number>();
    for (let i = 1; i <= maxAttempts; i++) set.add(i);
    for (const log of logs) set.add(log.attempt);
    return Array.from(set).sort((a, b) => a - b);
  }, [logs, maxAttempts]);

  const filteredLogs =
    selectedAttempt !== undefined
      ? logs.filter((l) => l.attempt === selectedAttempt)
      : logs;

  return (
    <div className="flex flex-col gap-2">
      {attempts.length > 1 && (
        <Tabs
          value={selectedAttempt !== undefined ? String(selectedAttempt) : "all"}
          onValueChange={(v) =>
            onAttemptChange(v === "all" ? undefined : Number(v))
          }
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            {attempts.map((a) => (
              <TabsTrigger key={a} value={String(a)}>
                Attempt {a}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <div className="rounded-lg bg-zinc-950 p-4 font-mono text-sm leading-relaxed max-h-[28rem] overflow-y-auto">
        {filteredLogs.length === 0 ? (
          <p className="text-zinc-500">No logs yet.</p>
        ) : (
          filteredLogs.map((log) => (
            <div
              key={log.id}
              className={cn("py-0.5", levelStyles[log.level])}
            >
              <span className="text-zinc-500">
                {formatLogTime(log.timestamp)}
              </span>{" "}
              <span
                className={cn(
                  "inline-block rounded px-1 py-0 text-[11px] font-semibold uppercase",
                  levelBadgeStyles[log.level],
                )}
              >
                {log.level}
              </span>{" "}
              <span className="text-zinc-200">{log.message}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
