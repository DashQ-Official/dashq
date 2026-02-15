import { tryParseJson } from "@/lib/utils";

function renderValue(value: unknown, indent: number): React.ReactNode {
  if (value === null) {
    return <span className="text-zinc-400">null</span>;
  }

  if (typeof value === "boolean") {
    return <span className="text-violet-600">{String(value)}</span>;
  }

  if (typeof value === "number") {
    return <span className="text-blue-600">{value}</span>;
  }

  if (typeof value === "string") {
    return <span className="text-emerald-600">"{value}"</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    const pad = " ".repeat(indent);
    const innerPad = " ".repeat(indent + 2);
    return (
      <>
        {"[\n"}
        {value.map((item, i) => (
          <span key={i}>
            {innerPad}
            {renderValue(item, indent + 2)}
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}]
      </>
    );
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0)
      return <span className="text-zinc-500">{"{}"}</span>;
    const pad = " ".repeat(indent);
    const innerPad = " ".repeat(indent + 2);
    return (
      <>
        {"{\n"}
        {entries.map(([key, val], i) => (
          <span key={key}>
            {innerPad}
            <span className="text-rose-600">"{key}"</span>
            {": "}
            {renderValue(val, indent + 2)}
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {pad}
        {"}"}
      </>
    );
  }

  return <span>{String(value)}</span>;
}

export function JsonViewer({ data }: { data: string }) {
  const parsed = tryParseJson(data);

  return (
    <pre className="overflow-auto rounded-lg border border-border bg-muted/30 p-4 text-sm font-mono leading-relaxed">
      {renderValue(parsed, 0)}
    </pre>
  );
}
