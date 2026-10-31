import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Download, GitCompareArrows, Hand, Plus, Router, Trash2, Upload, Wifi, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { ATTENDANCE_STATUSES, EARLY_GRACE_MINUTES, LATE_GRACE_MINUTES, type AttendanceStatus } from "@shared/constants";
import { SHIFT_BY_CODE, addDaysKey } from "@shared/roster";
import { ConfirmButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { downloadCsv, errorMessage, formatDate, formatDateTime, formatMinutes, formatTime, parseCsv, todayInput } from "@/lib/operations";
import type { AttendanceMatch, BiometricDevice, DeviceTotals, PunchRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth";

type PunchImport = { employeeCode: string; punchTime: string; direction: "IN" | "OUT" | "AUTO"; deviceId: string };
type ImportResult = { imported: number; duplicates: number; skipped: number; problems: { row: number; reason: string }[] };

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ROWS = 5000;
const REQUIRED = ["employee_id", "punch_time", "direction"];
const SOURCE_STYLE: Record<PunchRecord["source"], string> = {
  device: "bg-[#ecf8f1] text-[#157347]",
  csv: "bg-[#eef4ff] text-[#175cd3]",
  manual: "bg-[#fff5df] text-[#946200]",
};

export default function Attendance() {
  const { user, isAdmin } = useAuth();
  const today = todayInput();
  const [workDate, setWorkDate] = useState(today);
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | "">("");
  const [manualOpen, setManualOpen] = useState(false);

  const matches = useQuery({ queryKey: ["attendance", "matches", workDate], queryFn: () => api.get<AttendanceMatch[]>("/attendance", { date: workDate }), refetchInterval: workDate === today ? 30_000 : false });
  const punches = useQuery({ queryKey: ["attendance", "punches", workDate], queryFn: () => api.get<PunchRecord[]>("/attendance/punches", { date: workDate }), refetchInterval: workDate === today ? 30_000 : false });
  const devices = useQuery({ queryKey: ["biometric", "devices"], queryFn: () => api.get<{ items: BiometricDevice[]; totals: DeviceTotals }>("/biometric/devices"), refetchInterval: 60_000 });

  const match = useApiMutation((date: string) => api.post<{ processed: number }>("/attendance/match", { workDate: date }), {
    invalidate: ["attendance"],
    success: (result) => `${result.processed} staff record${result.processed === 1 ? "" : "s"} checked for ${formatDate(workDate)}`,
    errorTitle: "Could not run matching",
  });
  const removePunch = useApiMutation((id: number) => api.delete(`/attendance/punches/${id}`), { invalidate: ["attendance"], success: "Punch removed", errorTitle: "Could not remove punch" });

  const rows = useMemo(() => matches.data ?? [], [matches.data]);
  const counts = useMemo(() => Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<AttendanceStatus, number>, [rows]);
  const visible = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;
  const activeDevices = (devices.data?.items ?? []).filter((d) => d.isActive);
  const failedDevices = activeDevices.filter((d) => d.lastSyncStatus === "FAILED").length;
  const lastSync = activeDevices.map((d) => d.lastSyncAt).filter(Boolean).sort().pop();

  function exportMatches() {
    downloadCsv(`attendance-${workDate}.csv`, ["Employee", "Employee ID", "Machine ID", "Shift", "In", "Out", "Worked", "Late (min)", "Early (min)", "Ad-hoc in", "Ad-hoc out", "Status", "Remarks"],
      rows.map((r) => [r.employeeName, r.employeeCode, r.biometricId, r.rosterShift, formatTime(r.biometricStart), formatTime(r.biometricEnd), r.workedMinutes !== null ? formatMinutes(r.workedMinutes) : "", r.lateMinutes, r.earlyMinutes, formatTime(r.systemStart), formatTime(r.systemEnd), r.status, r.remarks]));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Biometric reconciliation"
        title="Punch matching"
        description={`Biometric punches are checked against each person's roster shift (late after ${LATE_GRACE_MINUTES} min, early before ${EARLY_GRACE_MINUTES} min) and against ad-hoc system time. Results update automatically as punches arrive.`}
        actions={<>
          <div className="flex items-center rounded-lg border border-[#d7dee8] bg-white">
            <Button variant="ghost" size="icon" aria-label="Previous day" onClick={() => setWorkDate(addDaysKey(workDate, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <input aria-label="Attendance work date" type="date" className="h-10 w-36 border-x border-[#e4e9f0] bg-transparent px-2 text-center text-sm" max={today} value={workDate} onChange={(e) => e.target.value && setWorkDate(e.target.value)} />
            <Button variant="ghost" size="icon" aria-label="Next day" disabled={workDate >= today} onClick={() => setWorkDate(addDaysKey(workDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          <Button variant="outline" onClick={() => setManualOpen(true)}><Plus className="h-4 w-4" />Manual punch</Button>
          <Button variant="outline" onClick={exportMatches} disabled={!rows.length}><Download className="h-4 w-4" />Export</Button>
          <Button onClick={() => match.mutate(workDate)} disabled={match.isPending}><GitCompareArrows className="h-4 w-4" />{match.isPending ? "Checking…" : "Re-check"}</Button>
        </>}
      />

      <Link to="/devices" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-[#e4e9f0] bg-white px-4 py-3 text-sm transition-colors hover:border-[#b9d5fb]">
        <Router className="h-4 w-4 text-[#0064e6]" />
        {activeDevices.length ? (
          <span className={cn("flex items-center gap-1.5 font-medium", failedDevices ? "text-[#b42318]" : "text-[#157347]")}>
            {failedDevices ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
            {failedDevices ? `${failedDevices} of ${activeDevices.length} machine${activeDevices.length === 1 ? "" : "s"} failed last sync` : `${activeDevices.length} machine${activeDevices.length === 1 ? "" : "s"} synced`}
          </span>
        ) : <span className="text-[#667085]">No fingerprint machine added yet — set one up</span>}
        {lastSync && <span className="text-xs text-[#667085]">Last sync {formatDateTime(lastSync)}</span>}
        {(devices.data?.totals.unlinkedUsers ?? 0) > 0 && <span className="rounded-full bg-[#fff5df] px-2 py-0.5 text-xs font-medium text-[#946200]">{devices.data!.totals.unlinkedUsers} machine user{devices.data!.totals.unlinkedUsers === 1 ? "" : "s"} not linked</span>}
        <span className="ml-auto text-xs text-[#0053bf]">Manage devices →</span>
      </Link>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <FilterCard label="All" value={rows.length} active={!statusFilter} onClick={() => setStatusFilter("")} tone="text-[#101828]" />
        <FilterCard label="On duty" value={counts["On duty"]} active={statusFilter === "On duty"} onClick={() => setStatusFilter("On duty")} tone="text-[#175cd3]" />
        <FilterCard label="Matched" value={counts.Matched} active={statusFilter === "Matched"} onClick={() => setStatusFilter("Matched")} tone="text-[#157347]" />
        <FilterCard label="Needs review" value={counts.Review} active={statusFilter === "Review"} onClick={() => setStatusFilter("Review")} tone="text-[#946200]" />
        <FilterCard label="Missing punch" value={counts.Missing} active={statusFilter === "Missing"} onClick={() => setStatusFilter("Missing")} tone="text-[#b42318]" />
        <FilterCard label="Absent" value={counts.Absent} active={statusFilter === "Absent"} onClick={() => setStatusFilter("Absent")} tone="text-[#b42318]" />
      </div>

      <Panel>
        <PanelHeader title="Attendance" description={`${formatDate(workDate, { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · ${visible.length} staff`} />
        {matches.isLoading ? <LoadingState /> : matches.error ? <ErrorState message={matches.error.message} retry={() => matches.refetch()} /> : visible.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1100px]">
              <thead><tr><th>Employee</th><th>Shift</th><th>In / Out</th><th className="text-right">Worked</th><th className="text-right">Late</th><th className="text-right">Early</th><th>Ad-hoc in / out</th><th>Status</th></tr></thead>
              <tbody>{visible.map((item) => {
                const shift = item.rosterShift ? SHIFT_BY_CODE.get(item.rosterShift) : undefined;
                return (
                  <tr key={item.id}>
                    <td><div className="font-medium text-[#1d2939]">{item.employeeName}</div><div className="mt-0.5 font-mono text-[10px]">{item.employeeCode}{item.biometricId ? ` · ID ${item.biometricId}` : " · no machine ID"}</div></td>
                    <td>{shift ? <><span className="inline-flex rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: shift.bg, color: shift.fg }}>{shift.code}</span><div className="mt-0.5 font-mono text-[10px] text-[#98a2b3]">{shift.start ? `${shift.start}–${shift.end}` : shift.label}</div></> : <span className="text-xs text-[#98a2b3]">Not rostered</span>}</td>
                    <td className="whitespace-nowrap font-mono">{formatTime(item.biometricStart)} <span className="text-[#98a2b3]">/</span> {formatTime(item.biometricEnd)}<div className="text-[10px] text-[#98a2b3]">{item.punchCount} punch{item.punchCount === 1 ? "" : "es"}</div></td>
                    <td className="text-right font-mono">{item.workedMinutes !== null ? formatMinutes(item.workedMinutes) : "—"}</td>
                    <td className={cn("text-right font-mono", (item.lateMinutes ?? 0) > LATE_GRACE_MINUTES && "font-semibold text-[#b42318]")}>{item.lateMinutes ? `${item.lateMinutes}m` : "—"}</td>
                    <td className={cn("text-right font-mono", (item.earlyMinutes ?? 0) > EARLY_GRACE_MINUTES && "font-semibold text-[#b42318]")}>{item.earlyMinutes ? `${item.earlyMinutes}m` : "—"}</td>
                    <td className="whitespace-nowrap font-mono text-xs">{item.systemStart ? <>{formatTime(item.systemStart)} / {formatTime(item.systemEnd)}{item.varianceMinutes !== null && <div className="text-[10px] text-[#98a2b3]">±{item.varianceMinutes} min</div>}</> : "—"}</td>
                    <td className="max-w-64"><StatusBadge status={item.status} />{item.remarks && <div className="mt-1 text-[11px] leading-4 text-[#667085]">{item.remarks}</div>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <EmptyState title={statusFilter ? `No “${statusFilter}” records` : "Nothing to show for this date"} description="Results appear when staff are rostered, punch on a machine, or record ad-hoc work. Select Re-check to recalculate." />}
      </Panel>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="Punches" description={`Every punch on ${formatDate(workDate)} · machine punches cannot be deleted`} />
          {punches.isLoading ? <LoadingState /> : punches.data?.length ? (
            <div className="max-h-[520px] overflow-auto">
              <table className="data-table min-w-[720px]">
                <thead className="sticky top-0"><tr><th>Employee</th><th>Time</th><th>Direction</th><th>Source</th><th /></tr></thead>
                <tbody>{punches.data.map((punch) => (
                  <tr key={punch.id}>
                    <td className="font-medium text-[#1d2939]">{punch.employeeName}</td>
                    <td className="font-mono">{formatDateTime(punch.punchTime)}</td>
                    <td><span className={cn("font-mono text-xs font-medium", punch.direction === "IN" ? "text-[#157347]" : punch.direction === "OUT" ? "text-[#946200]" : "text-[#667085]")}>{punch.direction === "AUTO" ? "—" : punch.direction}</span></td>
                    <td>
                      <span className={cn("rounded-full px-2 py-0.5 font-mono text-[10px] uppercase", SOURCE_STYLE[punch.source])}>{punch.source}</span>
                      <span className="ml-2 text-xs text-[#667085]">{punch.source === "device" ? punch.deviceName ?? punch.deviceId : punch.source === "manual" ? punch.note : punch.deviceId}</span>
                    </td>
                    <td className="text-right">
                      {punch.source !== "device" && (
                        <ConfirmButton title="Remove this punch?" description={`${punch.employeeName} · ${formatDateTime(punch.punchTime)} (${punch.source}). Attendance is re-checked automatically.`} confirmLabel="Remove" onConfirm={() => removePunch.mutate(punch.id)}>
                          <Button size="icon" variant="ghost" aria-label="Remove punch" className="text-[#b42318] hover:text-[#b42318]"><Trash2 className="h-4 w-4" /></Button>
                        </ConfirmButton>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <EmptyState title="No punches" description="Machine punches appear here automatically." />}
        </Panel>
        <CsvImport workDate={workDate} />
      </div>

      <ManualPunchDialog open={manualOpen} onOpenChange={setManualOpen} workDate={workDate} currentUserId={user!.id} isAdmin={isAdmin} />
    </div>
  );
}

function FilterCard({ label, value, active, onClick, tone }: { label: string; value: number; active: boolean; onClick: () => void; tone: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-xl border bg-white p-4 text-left transition-colors", active ? "border-[#0064e6] ring-1 ring-[#0064e6]" : "border-[#e4e9f0] hover:border-[#b9d5fb]")}>
      <div className="text-xs font-medium text-[#667085]">{label}</div>
      <div className={cn("mt-2 font-mono text-2xl font-medium", tone)}>{value}</div>
    </button>
  );
}

function ManualPunchDialog({ open, onOpenChange, workDate, currentUserId, isAdmin }: { open: boolean; onOpenChange: (open: boolean) => void; workDate: string; currentUserId: number; isAdmin: boolean }) {
  const employees = useEmployees();
  const add = useApiMutation((body: { employeeId: number; punchTime: string; direction: "IN" | "OUT"; note: string }) => api.post("/attendance/punches/manual", body), {
    invalidate: ["attendance"],
    success: "Manual punch added — attendance re-checked",
    errorTitle: "Could not add punch",
  });
  const people = (employees.data ?? []).filter((e) => isAdmin || e.id !== currentUserId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add manual punch</DialogTitle><DialogDescription>For a forgotten or failed punch. It is marked “manual”, needs a reason and is recorded in the audit log.</DialogDescription></DialogHeader>
        {open && (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              add.mutate(
                { employeeId: Number(data.get("employeeId")), punchTime: `${data.get("date")}T${data.get("time")}`, direction: data.get("direction") as "IN" | "OUT", note: String(data.get("note")).trim() },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            <Field label="Employee"><select name="employeeId" required className="form-input" defaultValue="">{[<option key="" value="" disabled>Choose employee</option>, ...people.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.employeeCode}</option>)]}</select></Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date"><input name="date" type="date" required max={todayInput()} defaultValue={workDate} className="form-input px-2" /></Field>
              <Field label="Time"><input name="time" type="time" required className="form-input px-2" /></Field>
              <Field label="Direction"><select name="direction" className="form-input px-2" defaultValue="IN"><option>IN</option><option>OUT</option></select></Field>
            </div>
            <Field label="Reason"><textarea name="note" required minLength={5} maxLength={255} className="form-input" placeholder="e.g. Fingerprint not recognised, confirmed by supervisor" /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={add.isPending}><Hand className="h-4 w-4" />{add.isPending ? "Saving…" : "Add punch"}</Button></div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CsvImport({ workDate }: { workDate: string }) {
  const [rows, setRows] = useState<PunchImport[]>([]);
  const [fileName, setFileName] = useState("");
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importPunches = useApiMutation((records: PunchImport[]) => api.post<ImportResult>("/attendance/punches/import", { records }), {
    invalidate: ["attendance"],
    success: (r) => `${r.imported} imported${r.duplicates ? `, ${r.duplicates} already existed` : ""}${r.skipped ? `, ${r.skipped} skipped` : ""}`,
    errorTitle: "Could not import punches",
  });

  function reset() {
    setRows([]);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function readCsv(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 1 MB. Split it into smaller files.");
      const table = parseCsv(await file.text());
      const headers = table[0]?.map((h) => h.toLowerCase().replace(/^\uFEFF/, ""));
      if (!headers || REQUIRED.some((h) => !headers.includes(h))) throw new Error("Use the template headers: employee_id, punch_time, direction, device_id");
      const index = (name: string) => headers.indexOf(name);
      const parsed = table.slice(1).map((cells, i): PunchImport => {
        const direction = (cells[index("direction")] || "AUTO").toUpperCase();
        if (direction !== "IN" && direction !== "OUT" && direction !== "AUTO") throw new Error(`Row ${i + 2}: direction must be IN, OUT or AUTO`);
        return { employeeCode: cells[index("employee_id")] ?? "", punchTime: cells[index("punch_time")] ?? "", direction, deviceId: (index("device_id") >= 0 ? cells[index("device_id")] : "") || "CSV" };
      });
      if (!parsed.length) throw new Error("The CSV has no punch records");
      if (parsed.length > MAX_ROWS) throw new Error(`Up to ${MAX_ROWS} records per file`);
      setRows(parsed);
      setFileName(file.name);
      setLastImport(null);
    } catch (error) {
      reset();
      toast.error("Could not read CSV", { description: errorMessage(error) });
    }
  }

  return (
    <Panel>
      <PanelHeader title="CSV import (fallback)" description="Only needed if a machine was offline. employee_id can be the employee ID or machine ID." />
      <div className="space-y-3 p-5">
        <input ref={fileRef} id="punch-file" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => readCsv(e.target.files?.[0])} />
        <label htmlFor="punch-file" className="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#b8c3d1] bg-[#f8fafc] p-4 text-center transition-colors hover:border-[#0064e6] hover:bg-[#f2f7ff]">
          <Upload className="h-5 w-5 text-[#0064e6]" />
          <span className="mt-2 max-w-full truncate text-sm font-medium text-[#344054]">{fileName || "Choose punch CSV"}</span>
          <span className="mt-1 text-xs text-[#667085]">Up to {MAX_ROWS.toLocaleString()} rows · 1 MB</span>
        </label>
        <Button variant="outline" className="w-full" onClick={() => downloadCsv("biometric-punch-template.csv", ["employee_id", "punch_time", "direction", "device_id"], [["1033", `${workDate} 06:00`, "IN", "BIO-01"], ["1033", `${workDate} 14:00`, "OUT", "BIO-01"]])}><Download className="h-4 w-4" />Template</Button>
        <Button className="w-full" disabled={!rows.length || importPunches.isPending} onClick={() => importPunches.mutate(rows, { onSuccess: (result) => { setLastImport(result); reset(); } })}>{importPunches.isPending ? "Importing…" : `Import ${rows.length || ""} punches`}</Button>
        {lastImport && lastImport.problems.length > 0 && (
          <div className="rounded-lg border border-[#f5e3b5] bg-[#fffaf0] p-3 text-xs text-[#7a4f00]">
            <div className="font-medium">Skipped rows</div>
            <ul className="mt-1 max-h-32 space-y-0.5 overflow-auto">{lastImport.problems.map((p) => <li key={`${p.row}-${p.reason}`}>Row {p.row}: {p.reason}</li>)}</ul>
          </div>
        )}
      </div>
    </Panel>
  );
}
