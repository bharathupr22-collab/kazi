"use client";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  CheckCircle2,
  Clock3,
  ListTodo,
  TrendingUp,
} from "lucide-react";
import { useWorkspace } from "@/providers/workspace-provider";
import { Empty, PageHeading, Progress } from "@/components/ui/primitives";
export function CompletionChart({ compact = false }: { compact?: boolean }) {
  const { analytics, user } = useWorkspace();
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">(
    "weekly",
  );
  const selected = compact ? "weekly" : period;
  if (!analytics)
    return (
      <Empty
        title="Insights are unavailable"
        description="Use the refresh button to load your recorded activity."
      />
    );
  const points =
    selected === "daily"
      ? (analytics.daily ?? []).map((point) => ({
          completed: point.completed,
          day: point.hour,
        }))
      : (analytics[selected] ?? []).map((point) => ({
          completed: point.completed,
          day: new Date(point.date + "T12:00:00").toLocaleDateString(
            "en",
            selected === "weekly"
              ? { weekday: "short" }
              : { month: "short", day: "numeric" },
          ),
        }));
  const range =
    selected === "daily"
      ? "today by hour"
      : selected === "monthly"
        ? "the last 30 days"
        : "the last seven days";
  const emptyRange = selected === "daily" ? "today" : `in ${range}`;
  return (
    <>
      {!compact && (
        <div className="panel-header">
          <p>
            Recorded completions {range} · {user.timezone}
          </p>
          <div
            className="button-group"
            role="group"
            aria-label="Completion reporting period"
          >
            {(["daily", "weekly", "monthly"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`button ${selected === value ? "primary" : "secondary"} small`}
                aria-pressed={selected === value}
                onClick={() => setPeriod(value)}
              >
                {value === "daily"
                  ? "Day"
                  : value === "weekly"
                    ? "Week"
                    : "Month"}
              </button>
            ))}
          </div>
        </div>
      )}
      <div
        className={`chart-container ${compact ? "compact" : ""}`}
        role="img"
        aria-label={`Task completions ${range}: ${points.map((p) => `${p.day}: ${p.completed}`).join(", ")}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={points}
            margin={{ top: 18, right: 12, left: -25, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id={compact ? "completionCompact" : "completionFull"}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor="var(--teal)" stopOpacity={0.25} />
                <stop
                  offset="100%"
                  stopColor="var(--teal)"
                  stopOpacity={0.01}
                />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="4 5"
              vertical={false}
              stroke="var(--border)"
            />
            <XAxis
              dataKey="day"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              dy={8}
            />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                color: "var(--ink)",
              }}
              formatter={(value) => [value, "Completed"]}
            />
            <Area
              type="monotone"
              dataKey="completed"
              stroke="var(--teal)"
              strokeWidth={2.5}
              fill={`url(#${compact ? "completionCompact" : "completionFull"})`}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {points.length === 0 ? (
        <p className="chart-caption">
          This reporting period is unavailable. Refresh to load recorded
          activity.
        </p>
      ) : (
        points.every((p) => p.completed === 0) && (
          <p className="chart-caption">
            No completions recorded {emptyRange}. Your first finish will show up
            here.
          </p>
        )
      )}
    </>
  );
}
export function MetricCards() {
  const { analytics } = useWorkspace();
  const metrics = [
    {
      label: "Total tasks",
      value: analytics?.total,
      icon: ListTodo,
      detail: "Everything on your radar",
      color: "teal",
    },
    {
      label: "Completed",
      value: analytics?.completed,
      icon: CheckCircle2,
      detail: "Small wins, real progress",
      color: "green",
    },
    {
      label: "In your queue",
      value: analytics?.pending,
      icon: Clock3,
      detail: analytics
        ? `${analytics.overdue} overdue · room to reprioritize`
        : "Waiting for your data",
      color: "amber",
    },
    {
      label: "Completion rate",
      value: analytics
        ? `${Math.round(analytics.completion_rate)}%`
        : undefined,
      icon: TrendingUp,
      detail: "Your current task completion",
      color: "violet",
    },
  ];
  return (
    <div className="metric-grid">
      {metrics.map(({ label, value, icon: Icon, detail, color }) => (
        <article className="metric-card" key={label}>
          <div className="metric-top">
            <span>{label}</span>
            <span className={`metric-icon ${color}`}>
              <Icon size={18} />
            </span>
          </div>
          <strong className="metric-value">{value ?? "—"}</strong>
          <span className="metric-detail">{detail}</span>
        </article>
      ))}
    </div>
  );
}
export function AnalyticsView() {
  const { analytics, user, tasks } = useWorkspace();
  const categories = [...new Set(tasks.map((t) => t.category))].map(
    (category) => ({
      category,
      completed: tasks.filter(
        (t) => t.category === category && t.status === "completed",
      ).length,
      pending: tasks.filter(
        (t) => t.category === category && t.status !== "completed",
      ).length,
    }),
  );
  return (
    <>
      <PageHeading
        eyebrow="PROGRESS, NOT PERFECTION"
        title="Your work, in perspective"
        description={`Real activity. Useful perspective. Reporting in ${user.timezone}.`}
      />
      <MetricCards />
      <div className="analytics-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Your completion rhythm</h2>
              <p>Real completion activity in your timezone</p>
            </div>
          </div>
          <div className="chart-padding">
            <CompletionChart />
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>A moment of perspective</h2>
              <p>Grounded in your actual workspace</p>
            </div>
            <Activity size={19} />
          </div>
          <div className="insight-list">
            {analytics?.insights.map((insight, i) => (
              <div className="insight" key={i}>
                <span>0{i + 1}</span>
                <p>{insight}</p>
              </div>
            ))}
            <div className="time-summary">
              <Clock3 size={20} />
              <div>
                <strong>
                  {analytics
                    ? `${Math.floor(analytics.total_minutes / 60)}h ${analytics.total_minutes % 60}m`
                    : "—"}
                </strong>
                <span>actual time recorded across tasks</span>
              </div>
            </div>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Where your energy goes</h2>
              <p>Tasks by category</p>
            </div>
          </div>
          {categories.length ? (
            <div className="chart-container category-chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categories}
                  margin={{ top: 16, left: -25, right: 20 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="var(--border)"
                    strokeDasharray="4 5"
                  />
                  <XAxis
                    dataKey="category"
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted)", fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                    }}
                  />
                  <Bar
                    dataKey="completed"
                    name="Completed"
                    stackId="a"
                    fill="var(--teal)"
                  />
                  <Bar
                    dataKey="pending"
                    name="Pending"
                    stackId="a"
                    fill="var(--chart-light)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Empty
              title="Find your patterns"
              description="Add tasks with categories to see how your work is distributed."
            />
          )}
          <div className="chart-legend">
            <span>
              <i className="legend-dot" />
              Completed
            </span>
            <span>
              <i className="legend-dot pale-dot" />
              Pending
            </span>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Project momentum</h2>
              <p>Completed tasks as a share of each project</p>
            </div>
          </div>
          <div className="project-progress-list">
            {analytics?.projects.length ? (
              analytics.projects.map((project) => (
                <div key={project.id}>
                  <div className="progress-label">
                    <strong>{project.name}</strong>
                    <span>{Math.round(project.progress)}%</span>
                  </div>
                  <Progress value={project.progress} />
                </div>
              ))
            ) : (
              <Empty
                title="The bigger picture awaits"
                description="Your projects and their real completion rates will appear here."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
