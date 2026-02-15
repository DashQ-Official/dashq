import { Router, Route, Switch } from "wouter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import { Overview } from "@/pages/Overview";
import { JobsList } from "@/pages/JobsList";
import { JobDetail } from "@/pages/JobDetail";
import { basePath } from "@/api/client";

export function App() {
  return (
    <Router base={basePath()}>
      <TooltipProvider>
        <Layout>
          <Switch>
            <Route path="/" component={Overview} />
            <Route path="/jobs" component={JobsList} />
            <Route path="/jobs/:id" component={JobDetail} />
            <Route>
              <div className="flex flex-col items-center justify-center py-20">
                <h2 className="text-xl font-semibold">404</h2>
                <p className="text-muted-foreground">Page not found</p>
              </div>
            </Route>
          </Switch>
        </Layout>
      </TooltipProvider>
    </Router>
  );
}
