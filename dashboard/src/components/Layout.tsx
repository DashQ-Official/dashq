import { Link, useLocation } from "wouter";
import { LayoutDashboard, List, Server, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { basePath } from "@/api/client";
import { Separator } from "@/components/ui/separator";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: List },
  { href: "/workers", label: "Workers", icon: Server },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-col border-r border-border bg-card">
        <div className="h-1 bg-gradient-to-r from-blue-500 via-violet-500 to-emerald-500" />
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold tracking-tight">DashQ</span>
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        </div>
        <Separator />
        <nav className="flex flex-col gap-1 p-3">
          {navItems.map((item) => {
            const isActive =
              item.href === "/"
                ? location === "/"
                : location.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground border-l-2 border-primary pl-[10px]"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-5 py-4">
          <p className="text-xs text-muted-foreground">
            Serving at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
              {basePath()}
            </code>
          </p>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b border-border px-4 md:hidden">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600">
              <Zap className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-base font-semibold">DashQ</span>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
          <nav className="ml-auto flex gap-1">
            {navItems.map((item) => {
              const isActive =
                item.href === "/"
                  ? location === "/"
                  : location.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </header>

        {/* Main content */}
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
