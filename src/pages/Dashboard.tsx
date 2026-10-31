import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowRight, CalendarCheck2, CircleAlert, Clock3, FileCheck2, Fingerprint, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { api } from "@/lib/api";
import { SHIFT_BY_CODE } from "@shared/roster";
import { formatDate, SHIFTS } from "@/lib/operations";
import type { Dashboard as DashboardData } from "@/lib/types";
import { useAuth } from "@/providers/auth";

export default function Dashboard() {
  const navigate = useNavigate();
  const { user, isManager } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardData>("/dashboard"),
    refetchInterval: 60_000,
  });
  if (isLoading) return <LoadingState label="Bringing today’s operations into focus…" />;
  if (error || !data) return <ErrorState message={error?.message ?? "Dashboard unavailable"} retry={() => refetch()} />;

  const team = data.scope === "team";
  const maxProduction = Math.max(1, ...data.production.map((row) => row.drt + row.pmt));
  const metrics = [
    { label: team ? "Reports filed today" : "My reports today", value: data.stats.reportsToday, icon: FileCheck2, note: team ? `${data.stats.employees} active staff` : data.myShiftToday ? `Today: shift ${data.myShiftToday} · ${SHIFTS[data.myShiftToday] ?? ""}` : "No shift on roster today", to: "/reports" },
    { label: team ? "Open error reports" : "My open errors", value: data.stats.openErrors, icon: CircleAlert, note: "Needs review or closure", to: "/errors" },
    { label: team ? "Pending leave" : "My pending leave", value: data.stats.pendingLeave, icon: CalendarCheck2, note: team ? "Awaiting manager action" : "Awaiting approval", to: "/leave" },
    { label: "Ad-hoc hours this month", value: data.stats.adhocHoursMonth, icon: Clock3, note: `${data.stats.activeSessions} session${data.stats.activeSessions === 1 ? "" : "s"} running`, to: "/adhoc" },
  ];

  return (
    <div>
      <PageHeader
        eyebrow={formatDate(data.today, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
        title={team ? "Operations at a glance" : `Hello, ${user?.name.split(" ")[0] ?? ""}`}
        description={team ? "Production, support time, people and shift compliance across all Infinity Solutions accounts." : "Your production, time and requests for this month."}
        actions={<Button onClick={() => navigate("/reports?new=1")}><Plus className="h-4 w-4" /> New daily report</Button>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <button key={metric.label} onClick={() => navigate(metric.to)} className="text-left">
              <div className="flex h-full min-h-36 flex-col justify-between rounded-xl border border-[#e4e9f0] bg-white p-4 transition-all hover:-translate-y-0.5 hover:border-[#b9d5fb] md:p-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] font-medium leading-5 text-[#667085] md:text-[13px]">{metric.label}</span>
                  <Icon className="h-4 w-4 shrink-0 text-[#0064e6]" />
                </div>
                <div className="mt-4">
                  <div className="font-mono text-[28px] font-medium leading-none tracking-[-0.05em] text-[#101828] md:text-[34px]">{metric.value}</div>
                  <div className="mt-2 text-[11px] leading-4 text-[#667085] md:text-xs">{metric.note}</div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="min-w-0 space-y-5">
          <Panel>
            <PanelHeader title="Production trend" description="Total EDR + MAN items per day, last 14 days" />
            <div className="h-56 px-2 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0064e6" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#0064e6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#edf0f4" vertical={false} />
                  <XAxis dataKey="date" tickFormatter={(value) => formatDate(value, { day: "2-digit", month: "short" })} tick={{ fontSize: 11, fill: "#667085" }} axisLine={false} tickLine={false} />
                  <YAxis width={40} tick={{ fontSize: 11, fill: "#667085" }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip labelFormatter={(value) => formatDate(String(value))} formatter={(value) => [value, "Items"]} contentStyle={{ borderRadius: 8, border: "1px solid #e4e9f0", fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="#0064e6" strokeWidth={2} fill="url(#trendFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <Panel>
            <PanelHeader
              title="Production by account"
              description="DRT and PMT volume recorded this month"
              action={<div className="flex gap-4 font-mono text-[10px] uppercase tracking-wider text-[#667085]"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#0064e6]" />DRT</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#9cc5f7]" />PMT</span></div>}
            />
            <div className="space-y-4 px-5 py-5">
              {data.production.map((row) => {
                const total = row.drt + row.pmt;
                return (
                  <div key={row.account} className="grid grid-cols-[minmax(110px,160px)_1fr_46px] items-center gap-3 md:gap-5">
                    <div className="truncate text-[11px] font-medium text-[#344054] md:text-xs" title={row.account}>{row.account}</div>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-[#f0f3f7]" aria-label={`${row.account}: ${total} items`}>
                      <div className="h-full bg-[#0064e6]" style={{ width: `${(row.drt / maxProduction) * 100}%` }} />
                      <div className="h-full bg-[#9cc5f7]" style={{ width: `${(row.pmt / maxProduction) * 100}%` }} />
                    </div>
                    <div className="text-right font-mono text-xs font-medium text-[#344054]">{total}</div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Latest daily reports" description="Most recent shift submissions" action={<Button variant="ghost" size="sm" onClick={() => navigate("/reports")}>View all <ArrowRight className="h-3.5 w-3.5" /></Button>} />
            {data.recentReports.length ? (
              <div className="overflow-x-auto">
                <table className="data-table min-w-[680px]">
                  <thead><tr><th>Employee</th><th>Date</th><th>Account</th><th>Shift</th><th className="text-right">DRT</th><th className="text-right">PMT</th></tr></thead>
                  <tbody>{data.recentReports.map((report) => (
                    <tr key={report.id}>
                      <td><div className="font-medium text-[#1d2939]">{report.employeeName}</div><div className="mt-0.5 font-mono text-[10px] text-[#667085]">{report.employeeCode}</div></td>
                      <td className="whitespace-nowrap">{formatDate(report.reportDate, { day: "2-digit", month: "short" })}</td>
                      <td className="max-w-52 truncate text-xs">{report.account}</td>
                      <td><span className="font-mono font-medium text-[#0064e6]">{report.shiftCode}</span></td>
                      <td className="text-right font-mono">{report.drt}</td>
                      <td className="text-right font-mono">{report.pmt}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            ) : <EmptyState title="No reports yet" description="Submit the first daily production report to begin tracking shift output." />}
          </Panel>
        </div>

        <aside className="space-y-5">
          <Panel>
            <PanelHeader title="On the roster today" description={data.todayCoverage.length ? `${data.todayCoverage.filter((g) => g.kind === "work").reduce((n, g) => n + g.people.length, 0)} working` : undefined} action={<Button variant="ghost" size="sm" onClick={() => navigate("/roster")}>Roster</Button>} />
            {data.todayCoverage.length ? (
              <div className="divide-y divide-[#edf0f4]">
                {data.todayCoverage.map((group) => {
                  const def = SHIFT_BY_CODE.get(group.code);
                  return (
                    <div key={group.code} className="flex gap-3 px-5 py-3">
                      <span className="flex h-7 min-w-9 items-center justify-center rounded font-mono text-[11px] font-semibold" style={{ background: def?.bg, color: def?.fg }}>{group.code}</span>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-[#98a2b3]">{group.timing}</div>
                        <div className="mt-0.5 text-xs leading-5 text-[#344054]">{group.people.map((p) => (p.id === user?.id ? <strong key={p.id}>You</strong> : p.name)).reduce<React.ReactNode[]>((list, item, i) => (i ? [...list, ", ", item] : [item]), [])}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <div className="p-5 text-sm text-[#667085]">{data.rosterPublished || isManager ? "Nobody is on the roster for today." : "This month's roster is not published yet."}</div>}
          </Panel>

          <Panel>
            <PanelHeader title="Action queue" description="Items that need attention" />
            <div className="divide-y divide-[#edf0f4]">
              <QueueItem icon={CalendarCheck2} tone="text-[#b76e00]" title="Leave requests" note={`${data.stats.pendingLeave} awaiting approval`} onClick={() => navigate("/leave")} />
              {isManager && <QueueItem icon={Fingerprint} tone="text-[#0064e6]" title="Punch matching" note={`${data.stats.attendanceIssues} record${data.stats.attendanceIssues === 1 ? "" : "s"} to review this week`} onClick={() => navigate("/attendance")} />}
              <QueueItem icon={CalendarCheck2} tone="text-[#0064e6]" title="Duty roster" note={isManager ? "Review shift coverage" : "See your upcoming shifts"} onClick={() => navigate("/roster")} />
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Error watch" description="Latest quality and process issues" action={<Button variant="ghost" size="sm" onClick={() => navigate("/errors")}>All</Button>} />
            {data.recentErrors.length ? (
              <div className="divide-y divide-[#edf0f4]">
                {data.recentErrors.map((item) => (
                  <div key={item.id} className="px-5 py-4">
                    <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-[#344054]">{item.errorType}</span><StatusBadge status={item.status} /></div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-[#667085]">{item.description}</p>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-wide text-[#98a2b3]">{item.employeeName}</div>
                  </div>
                ))}
              </div>
            ) : <div className="p-5 text-sm text-[#667085]">No error reports.</div>}
          </Panel>

          <div className="rounded-xl bg-[#0e253f] p-5 text-white">
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9cc5f7]">Shift discipline</div>
            <p className="mt-3 text-sm leading-6 text-[#eef5fc]">Start ad-hoc work in the system and end it on completion. Biometric punches are matched separately for attendance review.</p>
            <Button variant="secondary" className="mt-4 w-full" onClick={() => navigate("/adhoc")}>Open time tracker <ArrowRight className="h-4 w-4" /></Button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function QueueItem({ icon: Icon, tone, title, note, onClick }: { icon: typeof CalendarCheck2; tone: string; title: string; note: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[#f8fbff]">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1"><div className="text-sm font-medium text-[#344054]">{title}</div><div className="mt-1 text-xs text-[#667085]">{note}</div></div>
      <ArrowRight className="h-4 w-4 text-[#98a2b3]" />
    </button>
  );
}
