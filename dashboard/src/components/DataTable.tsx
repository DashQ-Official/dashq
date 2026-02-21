import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

export type Column<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
};

type DataTableProps<T> = {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  onSort?: (key: string) => void;
  onRowClick?: (row: T) => void;
  rowKey: (row: T) => string;
  emptyIcon?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
};

export function DataTable<T>({
  columns,
  data,
  loading,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  rowKey,
  emptyIcon,
  emptyTitle = "No results",
  emptyDescription,
}: DataTableProps<T>) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead
              key={col.key}
              className={cn(
                col.sortable && "cursor-pointer select-none",
                col.className,
              )}
              onClick={col.sortable ? () => onSort?.(col.key) : undefined}
            >
              <span className="flex items-center gap-1">
                {col.header}
                {col.sortable && sortBy === col.key ? (
                  sortOrder === "asc" ? (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowDown className="h-3.5 w-3.5" />
                  )
                ) : col.sortable ? (
                  <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground/50" />
                ) : null}
              </span>
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          : data.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={cn(onRowClick && "cursor-pointer")}
                onClick={() => onRowClick?.(row)}
              >
                {columns.map((col) => (
                  <TableCell key={col.key} className={col.className}>
                    {col.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
        {!loading && data.length === 0 && (
          <TableRow>
            <TableCell
              colSpan={columns.length}
              className="h-48"
            >
              <div className="flex flex-col items-center justify-center gap-2 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                  {emptyIcon ?? <Inbox className="h-6 w-6 text-muted-foreground" />}
                </div>
                <p className="text-sm font-medium text-foreground">{emptyTitle}</p>
                {emptyDescription && (
                  <p className="text-sm text-muted-foreground">{emptyDescription}</p>
                )}
              </div>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
