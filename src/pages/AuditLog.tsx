import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState, PageHeader, Panel, PanelHeader } from "@/components/Workspace";
import { api } from "@/lib/api";
import { downloadCsv, formatDateTime, todayInput } from "@/lib/operations";
import type { AuditLog as AuditEntry } from "@/lib/types";

const CATEGORIES = [
  { value: "", label: "All activity" },
  { value: "auth.", label: "Sign-ins & security" },
  { value: "employee.", label: "Employee changes" },
  { value: "report.", label: "Daily reports" },
  { value: "error.", label: "Error reports" },
  { value: "leave.", label: "Leave" },
  { value: "roster.", label: "Roster" },
  { value: "adhoc.", label: "Ad-hoc" },
  { value: "attendance.", label: "Attendance" },
];

const tone = (action: string) =>
  /failed|locked/.test(action) ? "text-[#b42318]" : /delete|reject|cancel|reset/.test(action) ? "text-[#946200]" : "text-[#0064e6]";

export default function AuditLog() {
  const [action, setAction] = useState("");
  const logs = useQuery({
    queryKey: ["audit", action],
    queryFn: () => api.get<AuditEntry[]>("/audit-logs", { action, limit: 500 }),
    placeholderData: keepPreviousData,
  });
  const rows = logs.data ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        description="Every sign-in attempt and every change made in the portal, with who did it, when and from which IP address."
        actions={<>
          <Button variant="outline" onClick={() => logs.refetch()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
          <Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(`audit-log-${todayInput()}.csv`, ["Time", "User", "Employee ID", "Action", "Entity", "Entity ID", "Details", "IP"], rows.map((r) => [r.createdAt, r.actorName, r.actorCode, r.action, r.entity, r.entityId, r.details, r.ipAddress]))}>Export</Button>
        </>}
      />
      <Panel>
        <PanelHeader
          title="Recent activity"
          description={`Latest ${rows.length} entries`}
          action={<select aria-label="Filter category" className="form-input h-10 w-52" value={action} onChange={(e) => setAction(e.target.value)}>{CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select>}
        />
        {logs.isLoading ? <LoadingState /> : logs.error ? <ErrorState message={logs.error.message} retry={() => logs.refetch()} /> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[900px]">
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
              <tbody>{rows.map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{formatDateTime(row.createdAt)}</td>
                  <td>{row.actorName ? <><div className="font-medium text-[#1d2939]">{row.actorName}</div><div className="font-mono text-[10px]">{row.actorCode}</div></> : <span className="text-[#98a2b3]">Unknown</span>}</td>
                  <td><span className={`font-mono text-xs font-medium ${tone(row.action)}`}>{row.action}</span></td>
                  <td className="font-mono text-xs">{row.entity ? `${row.entity}${row.entityId ? ` #${row.entityId}` : ""}` : "—"}</td>
                  <td className="max-w-72"><div className="truncate font-mono text-[11px]" title={row.details ?? ""}>{row.details ?? "—"}</div></td>
                  <td className="font-mono text-xs">{row.ipAddress ?? "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No activity" description="Actions will appear here as people use the portal." />}
      </Panel>
    </div>
  );
}
