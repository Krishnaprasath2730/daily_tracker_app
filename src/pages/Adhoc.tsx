import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3, Play, Square, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader } from "@/components/Workspace";
import { useApiMutation } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { formatDate, formatMinutes, formatTime, minutesBetween } from "@/lib/operations";
import type { AdhocResponse } from "@/lib/types";
import { useAuth } from "@/providers/auth";

function elapsed(start: string, now: number) {
  const totalSeconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export default function Adhoc() {
  const { user, isManager } = useAuth();
  const [task, setTask] = useState("");
  const [notes, setNotes] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Timer uses server time so a wrong PC clock does not change displayed durations.
  const data = useQuery({
    queryKey: ["adhoc"],
    queryFn: async () => {
      const result = await api.get<AdhocResponse>("/adhoc");
      return { ...result, clockOffset: new Date(result.serverTime).getTime() - Date.now() };
    },
    refetchInterval: 60_000,
  });
  const offset = data.data?.clockOffset ?? 0;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const serverNow = now + offset;

  const start = useApiMutation((body: { task: string; notes?: string }) => api.post("/adhoc/start", body), { invalidate: ["adhoc"], success: "Ad-hoc session started", errorTitle: "Could not start session" });
  const end = useApiMutation((id: number) => api.post(`/adhoc/${id}/end`), { invalidate: ["adhoc", "attendance"], success: "Ad-hoc session ended — hours saved", errorTitle: "Could not end session" });

  const active = useMemo(() => data.data?.active.find((s) => s.employeeId === user!.id), [data.data, user]);
  const teamActive = data.data?.active ?? [];
  const sessions = data.data?.sessions ?? [];

  function startSession(event: React.FormEvent) {
    event.preventDefault();
    start.mutate({ task, notes: notes || undefined }, { onSuccess: () => { setTask(""); setNotes(""); } });
  }

  return (
    <div>
      <PageHeader eyebrow="Support time capture" title="Ad-hoc process" description="Click Start when support work begins and End when it is completed. The server records both timestamps and calculates the working hours." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel className="overflow-hidden">
          {data.isLoading ? <LoadingState /> : data.error ? <ErrorState message={data.error.message} retry={() => data.refetch()} /> : active ? (
            <div className="bg-[#0e253f] p-6 text-white md:p-8">
              <div className="flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#9cc5f7]"><span className="h-2 w-2 animate-pulse rounded-full bg-[#6ee7b7]" />Session in progress</div>
              <div className="mt-8 font-mono text-[46px] font-medium leading-none tracking-[-0.06em] sm:text-[64px]" aria-live="off">{elapsed(active.startTime, serverNow)}</div>
              <h2 className="mt-6 max-w-2xl font-condensed text-2xl font-semibold">{active.task}</h2>
              <p className="mt-2 text-sm text-[#b8c9da]">{active.employeeName} · Started at {formatTime(active.startTime)}</p>
              <Button variant="secondary" size="lg" className="mt-8" disabled={end.isPending} onClick={() => end.mutate(active.id)}><Square className="h-4 w-4 fill-current" />{end.isPending ? "Ending…" : "End session"}</Button>
            </div>
          ) : (
            <>
              <PanelHeader title="Start support work" description="The server time is used when you click Start" />
              <form onSubmit={startSession} className="space-y-5 p-5 md:p-6">
                <Field label="Work description"><input required minLength={3} maxLength={180} className="form-input" placeholder="e.g. Urgent shipment exception support" value={task} onChange={(e) => setTask(e.target.value)} /></Field>
                <Field label="Notes (optional)"><textarea maxLength={2000} className="form-input" placeholder="Account, reference or handover context" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
                <div className="flex flex-col justify-between gap-4 border-t border-[#edf0f4] pt-5 sm:flex-row sm:items-center">
                  <span className="text-xs leading-5 text-[#667085]">Only one active session is allowed per staff member.</span>
                  <Button type="submit" size="lg" disabled={start.isPending || task.trim().length < 3}><Play className="h-4 w-4 fill-current" />{start.isPending ? "Starting…" : "Start session"}</Button>
                </div>
              </form>
            </>
          )}
        </Panel>
        <aside className="space-y-5">
          <Panel>
            <PanelHeader title="Team sessions running" description={`${teamActive.length} active now`} />
            <div className="divide-y divide-[#edf0f4]">
              {teamActive.length ? teamActive.map((session) => (
                <div key={session.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-[#344054]">{session.employeeName}</span><span className="font-mono text-xs text-[#0064e6]">{elapsed(session.startTime, serverNow)}</span></div>
                  <p className="mt-1.5 truncate text-xs text-[#667085]" title={session.task}>{session.task}</p>
                  {isManager && session.employeeId !== user!.id && <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" disabled={end.isPending} onClick={() => end.mutate(session.id)}>End for {session.employeeName.split(" ")[0]}</Button>}
                </div>
              )) : <div className="p-5 text-sm text-[#667085]">No active team sessions.</div>}
            </div>
          </Panel>
          <Panel className="p-5"><TimerReset className="h-5 w-5 text-[#0064e6]" /><h2 className="mt-4 text-sm font-semibold text-[#344054]">Attendance rule</h2><p className="mt-2 text-sm leading-6 text-[#667085]">System start and end times are matched with the first IN and last OUT biometric punch for the same staff member and work date.</p></Panel>
        </aside>
      </div>

      <Panel className="mt-5">
        <PanelHeader title={isManager ? "Ad-hoc work history" : "My ad-hoc history"} description="Saved support sessions and calculated hours" />
        {data.isLoading ? <LoadingState /> : sessions.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[840px]">
              <thead><tr><th>Staff member</th><th>Work</th><th>Date</th><th>Start</th><th>End</th><th className="text-right">Duration</th></tr></thead>
              <tbody>{sessions.map((session) => (
                <tr key={session.id}>
                  <td><div className="font-medium text-[#1d2939]">{session.employeeName}</div><div className="mt-0.5 font-mono text-[10px]">{session.employeeCode}</div></td>
                  <td className="max-w-64"><div className="truncate text-[#344054]" title={session.task}>{session.task}</div></td>
                  <td className="whitespace-nowrap">{formatDate(session.startTime)}</td>
                  <td className="font-mono">{formatTime(session.startTime)}</td>
                  <td className="font-mono">{formatTime(session.endTime)}</td>
                  <td className="text-right font-mono font-medium text-[#1d2939]">{session.endTime ? formatMinutes(minutesBetween(session.startTime, session.endTime)) : <span className="text-[#157347]">Running</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No ad-hoc sessions" description="Start a support session to record working time." />}
      </Panel>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#dbe8f7] bg-[#f2f7ff] p-4 text-sm leading-6 text-[#36516f]"><Clock3 className="mt-1 h-4 w-4 shrink-0 text-[#0064e6]" /><p>Always end the session when the work finishes. Saved sessions feed the attendance matching screen; they do not replace the biometric punch record.</p></div>
    </div>
  );
}
