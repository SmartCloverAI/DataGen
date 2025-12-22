import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/LogoutButton";
import { getSessionFromCookies } from "@/lib/auth/session";
import { getMetricsSafe } from "@/lib/datagen/metrics";
import { TasksPanel } from "@/components/TasksPanel";

export default async function DashboardPage() {
  const session = await getSessionFromCookies(cookies());
  if (!session) {
    redirect("/login");
  }

  const metrics = await getMetricsSafe();

  return (
    <main className="page">
      <section className="panel">
        <header className="panel__header">
          <div>
            <p className="eyebrow">Welcome</p>
            <h1>DataGen dashboard</h1>
            <p className="muted">
              Track generation jobs, see progress, and export results. Metrics are
              persisted in CStore.
            </p>
          </div>
          <div className="panel__actions">
            <div className="pill">
              Signed in as <strong>{session.username}</strong>
            </div>
            <LogoutButton />
          </div>
        </header>

        <div className="summary-grid">
          <MetricCard
            label="Total jobs"
            value={metrics?.totalJobs ?? 0}
            hint={metrics ? "Persisted" : "Metrics unavailable"}
          />
          <MetricCard
            label="Records requested"
            value={metrics?.totalRecordsRequested ?? 0}
            hint="Since first run"
          />
          <MetricCard
            label="Records generated"
            value={metrics?.totalRecordsGenerated ?? 0}
            hint="Successful completions"
          />
          <MetricCard
            label="Active jobs"
            value={metrics?.activeJobs ?? 0}
            hint="Currently running"
          />
          <MetricCard
            label="Failed jobs"
            value={metrics?.failedJobs ?? 0}
            hint="Needs attention"
          />
          <MetricCard
            label="Last job"
            value={
              metrics?.lastJobAt
                ? new Date(metrics.lastJobAt).toLocaleString()
                : "N/A"
            }
            hint="UTC time"
          />
        </div>

        <div className="panel__body">
          <h2>Next up</h2>
          <ul className="list">
            <li>Live jobs are persisted in CStore; UI polls every ~1.5s.</li>
            <li>JSON/CSV downloads are available after completion.</li>
            <li>Authentication enforced via cstore-auth session cookie.</li>
          </ul>
        </div>

        <TasksPanel />
      </section>
    </main>
  );
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <div className="metric">
      <p className="muted">{label}</p>
      <p className="metric__value">{value}</p>
      {hint ? <p className="muted small">{hint}</p> : null}
    </div>
  );
}
