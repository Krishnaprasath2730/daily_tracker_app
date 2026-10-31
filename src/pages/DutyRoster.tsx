import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CalendarRange, ChevronLeft, ChevronRight, Copy, Download, EyeOff, Grid3x3, ListChecks, Search, Send, Settings2, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { SHIFT_BY_CODE, SHIFT_DEFS, addDaysKey, dayCoverage, employeeIssues, summarise, type RosterIssue } from "@shared/roster";
import { PatternDialog, type PatternInput } from "@/components/roster/PatternDialog";
import { cellKey, type Cell, type GridDay } from "@/components/roster/cells";
import { RosterGrid } from "@/components/roster/RosterGrid";
import { SwapPanel } from "@/components/roster/SwapPanel";
import { ConfirmButton, EmptyState, ErrorState, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { downloadCsv, errorMessage, formatDate, formatDateTime, todayInput } from "@/lib/operations";
import type { RosterEntry, RosterMonth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth";

type Change = { employeeId: number; dutyDate: string; shiftCode: string };

const monthLabel = (month: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
const shiftMonth = (month: string, delta: number) => {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default function DutyRoster() {
  const { user, isManager, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const today = todayInput();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [view, setView] = useState<"grid" | "mine">(isManager ? "grid" : "mine");
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [patternOpen, setPatternOpen] = useState(false);
  const [undoStack, setUndoStack] = useState<Change[][]>([]);

  const employees = useEmployees();
  const rosterKey = ["roster", month];
  const roster = useQuery({ queryKey: rosterKey, queryFn: () => api.get<RosterMonth>("/roster", { month }) });

  // ── Derived data ──────────────────────────────────────────────────
  const days: GridDay[] = useMemo(() => {
    const [year, m] = month.split("-").map(Number);
    const count = new Date(Date.UTC(year, m, 0)).getUTCDate();
    return Array.from({ length: count }, (_, i) => {
      const date = `${month}-${String(i + 1).padStart(2, "0")}`;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      return { date, day: i + 1, weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)).slice(0, 2), weekend: dow === 0 || dow === 6 };
    });
  }, [month]);
  const monthDates = useMemo(() => days.map((d) => d.date), [days]);

  const shifts = useMemo(() => new Map((roster.data?.entries ?? []).map((e) => [cellKey(e.employeeId, e.dutyDate), e.shiftCode])), [roster.data]);
  const allPeople = useMemo(() => employees.data ?? [], [employees.data]);
  const teams = useMemo(() => [...new Set(allPeople.map((p) => p.team))].sort(), [allPeople]);

  const issues = useMemo(() => {
    const result = new Map<string, RosterIssue[]>();
    const leaves = roster.data?.leaves ?? [];
    for (const person of allPeople) {
      const personal = new Map<string, string>();
      for (let i = -6; i < monthDates.length; i += 1) {
        const date = addDaysKey(monthDates[0], i);
        const code = shifts.get(cellKey(person.id, date));
        if (code) personal.set(date, code);
      }
      for (const [date, list] of employeeIssues(person.id, personal, monthDates, leaves)) result.set(cellKey(person.id, date), list);
    }
    return result;
  }, [allPeople, shifts, monthDates, roster.data]);

  const coverage = useMemo(
    () => monthDates.map((date) => dayCoverage(date, allPeople.map((p) => shifts.get(cellKey(p.id, date))), roster.data?.minStaffWeekday, roster.data?.minStaffWeekend)),
    [monthDates, allPeople, shifts, roster.data],
  );
  const summaries = useMemo(() => new Map(allPeople.map((p) => [p.id, summarise(monthDates.map((d) => shifts.get(cellKey(p.id, d))))])), [allPeople, monthDates, shifts]);

  const warningCount = useMemo(() => [...issues.values()].flat().filter((i) => i.severity === "warning").length, [issues]);
  const shortDays = coverage.filter((c) => c.short).length;
  const unplanned = [...summaries.values()].reduce((sum, s) => sum + s.unplanned, 0);
  const plannedHours = [...summaries.values()].reduce((sum, s) => sum + s.hours, 0);

  const people = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allPeople.filter((p) => {
      if (term && !`${p.name} ${p.employeeCode}`.toLowerCase().includes(term)) return false;
      if (team && p.team !== team) return false;
      if (onlyIssues && !monthDates.some((d) => issues.get(cellKey(p.id, d))?.some((i) => i.severity === "warning"))) return false;
      return true;
    });
  }, [allPeople, search, team, onlyIssues, monthDates, issues]);

  // ── Saving with optimistic updates and undo ───────────────────────
  const save = useMutation({
    mutationFn: (changes: Change[]) => api.put<{ updated: number }>("/roster/bulk", { changes }),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: rosterKey });
      const previous = queryClient.getQueryData<RosterMonth>(rosterKey);
      if (previous) {
        const map = new Map(previous.entries.map((e) => [cellKey(e.employeeId, e.dutyDate), e]));
        for (const c of changes) {
          const key = cellKey(c.employeeId, c.dutyDate);
          if (c.shiftCode === "-") map.delete(key);
          else map.set(key, { employeeId: c.employeeId, dutyDate: c.dutyDate, shiftCode: c.shiftCode } satisfies RosterEntry);
        }
        queryClient.setQueryData<RosterMonth>(rosterKey, { ...previous, entries: [...map.values()] });
      }
      return { previous };
    },
    onError: (error, _changes, context) => {
      if (context?.previous) queryClient.setQueryData(rosterKey, context.previous);
      toast.error("Could not save roster", { description: errorMessage(error) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["roster"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const applyCells = useCallback(
    (cells: Cell[], code: string) => {
      const isLeaveCode = SHIFT_BY_CODE.get(code)?.kind === "leave";
      let keptLeave = 0;
      const changes: Change[] = [];
      const previous: Change[] = [];
      for (const cell of cells) {
        const current = shifts.get(cellKey(cell.employeeId, cell.dutyDate));
        // Protect leave days from accidental bulk overwrites; a single cell is treated as deliberate.
        if (cells.length > 1 && current && SHIFT_BY_CODE.get(current)?.kind === "leave" && !isLeaveCode && code !== "-") {
          keptLeave += 1;
          continue;
        }
        if ((current ?? "-") === code) continue;
        changes.push({ ...cell, shiftCode: code });
        previous.push({ ...cell, shiftCode: current ?? "-" });
      }
      if (keptLeave) toast.info(`${keptLeave} leave day${keptLeave === 1 ? "" : "s"} kept unchanged`, { description: "Select a single leave cell to change it." });
      if (!changes.length) return;
      save.mutate(changes, {
        onSuccess: () => {
          setUndoStack((stack) => [...stack.slice(-19), previous]);
          if (changes.length > 1) toast.success(`${changes.length} cells updated`);
        },
      });
    },
    [shifts, save],
  );

  const undo = useCallback(() => {
    const last = undoStack[undoStack.length - 1];
    if (!last) return;
    save.mutate(last, {
      onSuccess: () => {
        setUndoStack((stack) => stack.slice(0, -1));
        toast.success("Change undone");
      },
    });
  }, [undoStack, save]);

  function changeMonth(next: string) {
    setMonth(next);
    setUndoStack([]);
  }

  // ── Other manager actions ─────────────────────────────────────────
  const publish = useApiMutation((body: { status?: "draft" | "published"; minStaffWeekday?: number; minStaffWeekend?: number }) => api.put<RosterMonth>(`/roster/months/${month}`, body), {
    invalidate: ["roster"],
    success: (_r, body) => (body.status === "published" ? `${monthLabel(month)} published — staff can now see it` : body.status === "draft" ? "Roster moved back to draft" : "Staffing rules saved"),
    errorTitle: "Could not update roster month",
  });
  const copy = useApiMutation(() => api.post<{ copied: number }>("/roster/copy", { fromMonth: shiftMonth(month, -1), toMonth: month }), {
    invalidate: ["roster"],
    success: (r) => `${r.copied} shift${r.copied === 1 ? "" : "s"} copied from ${monthLabel(shiftMonth(month, -1))}`,
    errorTitle: "Could not copy roster",
  });
  const pattern = useApiMutation((input: PatternInput) => api.post<{ applied: number }>("/roster/pattern", input), {
    invalidate: ["roster"],
    success: (r) => `Pattern applied to ${r.applied} day${r.applied === 1 ? "" : "s"}`,
    errorTitle: "Could not apply pattern",
  });

  function exportRoster() {
    const rows = people.map((p) => {
      const s = summaries.get(p.id);
      return [p.name, p.employeeCode, p.team, ...monthDates.map((d) => shifts.get(cellKey(p.id, d)) ?? ""), s?.workDays ?? 0, s?.hours ?? 0, s?.off ?? 0, s?.leave ?? 0];
    });
    rows.push(["Staff working", "", "", ...coverage.map((c) => c.working), "", "", "", ""]);
    downloadCsv(`infinity-duty-roster-${month}.csv`, ["Employee", "Employee ID", "Team", ...monthDates, "Work days", "Hours", "Off", "Leave"], rows);
    toast.success("Roster CSV downloaded");
  }

  const data = roster.data;
  const published = data?.status === "published";
  const loading = employees.isLoading || roster.isLoading;
  const failed = employees.error || roster.error;

  return (
    <div>
      <PageHeader
        eyebrow="Shift planning"
        title="Duty roster"
        description={isManager ? "Plan monthly shifts, check rest and coverage rules as you go, then publish to staff." : "Your shifts and your team's plan. Need a change? Request a swap with a colleague."}
        actions={<>
          <div className="flex items-center rounded-lg border border-[#d7dee8] bg-white">
            <Button variant="ghost" size="icon" aria-label="Previous month" onClick={() => changeMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <input aria-label="Roster month" type="month" className="h-10 w-36 border-x border-[#e4e9f0] bg-transparent px-2 text-center text-sm" value={month} onChange={(e) => e.target.value && changeMonth(e.target.value)} />
            <Button variant="ghost" size="icon" aria-label="Next month" onClick={() => changeMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
          </div>
          {month !== today.slice(0, 7) && <Button variant="ghost" onClick={() => changeMonth(today.slice(0, 7))}>This month</Button>}
          <div className="flex rounded-lg border border-[#d7dee8] bg-white p-0.5" role="tablist">
            <button role="tab" aria-selected={view === "grid"} onClick={() => setView("grid")} className={cn("flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium", view === "grid" ? "bg-[#edf5ff] text-[#0053bf]" : "text-[#667085]")}><Grid3x3 className="h-3.5 w-3.5" />Team</button>
            <button role="tab" aria-selected={view === "mine"} onClick={() => setView("mine")} className={cn("flex h-9 items-center gap-1.5 rounded-md px-3 text-xs font-medium", view === "mine" ? "bg-[#edf5ff] text-[#0053bf]" : "text-[#667085]")}><CalendarClock className="h-3.5 w-3.5" />My shifts</button>
          </div>
        </>}
      />

      {/* Month status + manager tools */}
      {data && (
        <div className="mb-5 flex flex-col gap-3 rounded-xl border border-[#e4e9f0] bg-white p-4 lg:flex-row lg:items-center">
          <div className="flex items-center gap-3">
            <StatusBadge status={published ? "Published" : "Draft"} />
            <div className="text-sm text-[#475467]">
              <span className="font-semibold text-[#1d2939]">{monthLabel(month)}</span>
              {published
                ? <span className="text-xs text-[#667085]"> · published{data.publishedByName ? ` by ${data.publishedByName}` : ""}{data.publishedAt ? ` on ${formatDateTime(data.publishedAt)}` : ""}</span>
                : <span className="text-xs text-[#667085]"> · {isManager ? "only managers can see this month" : "not published yet"}</span>}
            </div>
          </div>
          {isManager && (
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <Button variant="outline" size="sm" onClick={() => setPatternOpen(true)}><Wand2 className="h-3.5 w-3.5" />Weekly pattern</Button>
              <ConfirmButton title={`Copy ${monthLabel(shiftMonth(month, -1))} into ${monthLabel(month)}?`} description="Shifts are copied by day number. Days already planned in this month are kept; leave codes are not copied." confirmLabel="Copy shifts" onConfirm={() => copy.mutate(undefined)}>
                <Button variant="outline" size="sm" disabled={copy.isPending}><Copy className="h-3.5 w-3.5" />Copy last month</Button>
              </ConfirmButton>
              <StaffingRules key={month} weekday={data.minStaffWeekday} weekend={data.minStaffWeekend} saving={publish.isPending} onSave={(minStaffWeekday, minStaffWeekend) => publish.mutate({ minStaffWeekday, minStaffWeekend })} />
              <Button variant="outline" size="sm" onClick={exportRoster} disabled={!people.length}><Download className="h-3.5 w-3.5" />Export</Button>
              {published ? (
                <ConfirmButton title="Move back to draft?" description="Staff will no longer see this month until you publish it again." confirmLabel="Unpublish" onConfirm={() => publish.mutate({ status: "draft" })}>
                  <Button variant="outline" size="sm"><EyeOff className="h-3.5 w-3.5" />Unpublish</Button>
                </ConfirmButton>
              ) : (
                <ConfirmButton
                  title={`Publish ${monthLabel(month)}?`}
                  description={warningCount || shortDays ? `There are ${warningCount} rule warning${warningCount === 1 ? "" : "s"} and ${shortDays} short-staffed day${shortDays === 1 ? "" : "s"}. You can still publish and fix them later.` : "All staff will be able to see their shifts for this month."}
                  confirmLabel="Publish"
                  onConfirm={() => publish.mutate({ status: "published" })}
                >
                  <Button size="sm" disabled={publish.isPending}><Send className="h-3.5 w-3.5" />Publish</Button>
                </ConfirmButton>
              )}
            </div>
          )}
        </div>
      )}

      {loading ? <Panel><LoadingState label="Loading monthly duty roster…" /></Panel> : failed ? (
        <Panel><ErrorState message={failed.message} retry={() => { employees.refetch(); roster.refetch(); }} /></Panel>
      ) : data?.hidden ? (
        <Panel><EmptyState title={`${monthLabel(month)} is not published yet`} description="Your manager is still planning this month. You will see your shifts here once it is published." /></Panel>
      ) : view === "mine" ? (
        <MyShifts userId={user!.id} days={days} shifts={shifts} issues={issues} today={today} summary={summaries.get(user!.id)} />
      ) : (
        <>
          {isManager && (
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Insight icon={AlertTriangle} label="Rule warnings" value={warningCount} tone={warningCount ? "bad" : "good"} note="Rest gaps, 7+ days in a row, work on leave" onClick={() => setOnlyIssues((v) => !v)} active={onlyIssues} />
              <Insight icon={Users} label="Short-staffed days" value={shortDays} tone={shortDays ? "bad" : "good"} note={`Minimum ${data?.minStaffWeekday} weekday · ${data?.minStaffWeekend} weekend`} />
              <Insight icon={CalendarRange} label="Unplanned cells" value={unplanned} tone={unplanned ? "warn" : "good"} note="Staff-days with no shift yet" />
              <Insight icon={ListChecks} label="Planned hours" value={Math.round(plannedHours)} tone="neutral" note={`${allPeople.length} staff this month`} />
            </div>
          )}
          <Panel className="overflow-hidden">
            <PanelHeader
              title={monthLabel(month)}
              description={isManager ? "Hover a cell to see warnings. Red corner = rule warning · blue corner = pending leave." : "Your row is highlighted. Hover a cell for shift times."}
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#98a2b3]" /><input className="form-input h-10 w-48 pl-9" placeholder="Search staff" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                  {teams.length > 1 && <select aria-label="Filter team" className="form-input h-10 w-36" value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{teams.map((t) => <option key={t}>{t}</option>)}</select>}
                  {isManager && <label className="flex items-center gap-2 text-xs text-[#667085]"><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />Only staff with warnings</label>}
                </div>
              }
            />
            {people.length ? (
              <RosterGrid
                key={`${month}-${search}-${team}-${onlyIssues}`}
                people={people}
                days={days}
                shifts={shifts}
                issues={isManager ? issues : new Map()}
                coverage={coverage}
                summaries={summaries}
                editable={isManager}
                saving={save.isPending}
                today={today}
                currentUserId={user!.id}
                canUndo={undoStack.length > 0}
                onApply={applyCells}
                onUndo={undo}
              />
            ) : <EmptyState title="No staff match" description="Adjust the search or filters." />}
          </Panel>
          <Legend />
        </>
      )}

      {data && !data.hidden && (
        <SwapPanel
          userId={user!.id}
          isManager={isManager}
          isAdmin={isAdmin}
          people={allPeople}
          shifts={shifts}
          monthDates={monthDates}
          today={today}
          canRequest={published}
        />
      )}

      {isManager && data && (
        <PatternDialog
          key={`${month}-${patternOpen}`}
          open={patternOpen}
          onOpenChange={setPatternOpen}
          people={allPeople}
          monthStart={monthDates[0]}
          monthEnd={monthDates[monthDates.length - 1]}
          pending={pattern.isPending}
          onSubmit={(input) => pattern.mutate(input, { onSuccess: () => setPatternOpen(false) })}
        />
      )}
    </div>
  );
}

function Insight({ icon: Icon, label, value, note, tone, onClick, active }: { icon: typeof Users; label: string; value: number; note: string; tone: "good" | "bad" | "warn" | "neutral"; onClick?: () => void; active?: boolean }) {
  const color = { good: "text-[#157347]", bad: "text-[#b42318]", warn: "text-[#946200]", neutral: "text-[#101828]" }[tone];
  const body = (
    <div className={cn("h-full rounded-xl border bg-white p-4 text-left transition-colors", active ? "border-[#0064e6] ring-1 ring-[#0064e6]" : "border-[#e4e9f0]", onClick && "hover:border-[#b9d5fb]")}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-[#667085]">{label}</span><Icon className="h-4 w-4 text-[#98a2b3]" /></div>
      <div className={cn("mt-2 font-mono text-2xl font-medium", color)}>{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-[#98a2b3]">{note}</div>
    </div>
  );
  return onClick ? <button type="button" onClick={onClick} title="Show only staff with warnings">{body}</button> : body;
}

function StaffingRules({ weekday, weekend, saving, onSave }: { weekday: number; weekend: number; saving: boolean; onSave: (weekday: number, weekend: number) => void }) {
  const [open, setOpen] = useState(false);
  const [wd, setWd] = useState(weekday);
  const [we, setWe] = useState(weekend);
  return (
    <Popover open={open} onOpenChange={(value) => { setOpen(value); if (value) { setWd(weekday); setWe(weekend); } }}>
      <PopoverTrigger asChild><Button variant="outline" size="sm"><Settings2 className="h-3.5 w-3.5" />Staffing rules</Button></PopoverTrigger>
      <PopoverContent align="end" className="w-72">
        <div className="text-sm font-semibold text-[#1d2939]">Minimum staff per day</div>
        <p className="mt-1 text-xs text-[#667085]">Days below the minimum are highlighted red in the coverage row.</p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-[#475467]">Weekdays<input type="number" min={0} max={200} className="form-input mt-1 h-10" value={wd} onChange={(e) => setWd(Math.max(0, Number(e.target.value) || 0))} /></label>
          <label className="text-xs text-[#475467]">Weekends<input type="number" min={0} max={200} className="form-input mt-1 h-10" value={we} onChange={(e) => setWe(Math.max(0, Number(e.target.value) || 0))} /></label>
        </div>
        <Button size="sm" className="mt-3 w-full" disabled={saving} onClick={() => { onSave(wd, we); setOpen(false); }}>Save</Button>
      </PopoverContent>
    </Popover>
  );
}

function Legend() {
  return (
    <Panel className="mt-5">
      <PanelHeader title="Shift codes" description="Colours match the grid. Hours count toward each person's monthly total." />
      <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-7">
        {SHIFT_DEFS.map((def) => (
          <div key={def.code} className="flex items-center gap-2 rounded-lg border border-[#edf0f4] p-2">
            <span className="flex h-8 min-w-9 items-center justify-center rounded font-mono text-[11px] font-semibold" style={{ background: def.bg, color: def.fg }}>{def.code}</span>
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-[#344054]">{def.label}</div>
              <div className="font-mono text-[10px] text-[#98a2b3]">{def.start ? `${def.start}–${def.end}` : def.kind === "off" ? "Rest day" : "Leave"}</div>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MyShifts({ userId, days, shifts, issues, today, summary }: { userId: number; days: GridDay[]; shifts: Map<string, string>; issues: Map<string, RosterIssue[]>; today: string; summary?: ReturnType<typeof summarise> }) {
  const next = days.find((d) => d.date >= today && SHIFT_BY_CODE.get(shifts.get(cellKey(userId, d.date)) ?? "")?.kind === "work");
  const nextDef = next ? SHIFT_BY_CODE.get(shifts.get(cellKey(userId, next.date))!) : undefined;
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Panel>
        <PanelHeader title="My month" description="Your shift for every day of the month" />
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => {
            const code = shifts.get(cellKey(userId, day.date));
            const def = code ? SHIFT_BY_CODE.get(code) : undefined;
            const flagged = issues.get(cellKey(userId, day.date))?.some((i) => i.severity === "warning");
            return (
              <div
                key={day.date}
                className={cn("rounded-lg border p-3", day.date === today ? "border-[#0064e6] ring-1 ring-[#0064e6]" : "border-[#edf0f4]", day.date < today && "opacity-55")}
                style={def ? { background: def.bg } : undefined}
              >
                <div className="flex items-center justify-between font-mono text-[10px] uppercase text-[#667085]"><span>{formatDate(day.date, { weekday: "short" })}</span><span>{day.day}</span></div>
                <div className="mt-2 font-mono text-lg font-semibold" style={{ color: def?.fg ?? "#d0d5dd" }}>{code ?? "—"}{flagged && <AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-[#d92d20]" />}</div>
                <div className="mt-0.5 truncate text-[11px] text-[#667085]">{def ? (def.start ? `${def.start}–${def.end}` : def.label) : "Not planned"}</div>
              </div>
            );
          })}
        </div>
      </Panel>
      <aside className="space-y-5">
        <div className="rounded-xl bg-[#0e253f] p-5 text-white">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#9cc5f7]">Next shift</div>
          {next && nextDef ? (
            <>
              <div className="mt-3 font-condensed text-2xl font-semibold">{next.date === today ? "Today" : formatDate(next.date, { weekday: "long", day: "2-digit", month: "short" })}</div>
              <div className="mt-1 text-sm text-[#c9d8e8]">Shift {nextDef.code} · {nextDef.label} · {nextDef.start}–{nextDef.end}</div>
            </>
          ) : <div className="mt-3 text-sm text-[#c9d8e8]">No more working shifts planned this month.</div>}
        </div>
        {summary && (
          <Panel className="p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#667085]">This month</div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-xs text-[#667085]">Working days</dt><dd className="font-mono text-xl text-[#101828]">{summary.workDays}</dd></div>
              <div><dt className="text-xs text-[#667085]">Hours</dt><dd className="font-mono text-xl text-[#101828]">{Math.round(summary.hours * 10) / 10}</dd></div>
              <div><dt className="text-xs text-[#667085]">Weekly offs</dt><dd className="font-mono text-xl text-[#101828]">{summary.off}</dd></div>
              <div><dt className="text-xs text-[#667085]">Leave</dt><dd className="font-mono text-xl text-[#946200]">{summary.leave}</dd></div>
            </dl>
          </Panel>
        )}
      </aside>
    </div>
  );
}
