import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRight, Check, Repeat2, X } from "lucide-react";
import { SHIFT_BY_CODE } from "@shared/roster";
import { EmptyState, Field, LoadingState, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApiMutation } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/operations";
import type { EmployeeSummary, ShiftSwap } from "@/lib/types";
import { cellKey } from "./cells";

type Props = {
  userId: number;
  isManager: boolean;
  isAdmin: boolean;
  people: EmployeeSummary[];
  shifts: Map<string, string>;
  monthDates: string[];
  today: string;
  canRequest: boolean;
};

const ShiftChip = ({ code }: { code: string }) => {
  const def = SHIFT_BY_CODE.get(code);
  return <span className="inline-flex min-w-8 justify-center rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold" style={{ background: def?.bg ?? "#f2f4f7", color: def?.fg ?? "#475467" }} title={def ? `${def.label}${def.start ? ` ${def.start}–${def.end}` : ""}` : undefined}>{code}</span>;
};

export function SwapPanel({ userId, isManager, isAdmin, people, shifts, monthDates, today, canRequest }: Props) {
  const swaps = useQuery({ queryKey: ["roster", "swaps"], queryFn: () => api.get<ShiftSwap[]>("/roster/swaps") });
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [targetId, setTargetId] = useState(0);
  const [reason, setReason] = useState("");
  const [deciding, setDeciding] = useState<{ swap: ShiftSwap; status: "Approved" | "Rejected" } | null>(null);
  const [note, setNote] = useState("");

  const request = useApiMutation((body: { dutyDate: string; targetId: number; reason?: string }) => api.post("/roster/swaps", body), {
    invalidate: ["roster"],
    success: "Swap request sent to your colleague",
    errorTitle: "Could not request swap",
  });
  const respond = useApiMutation((input: { id: number; accept: boolean }) => api.post(`/roster/swaps/${input.id}/respond`, { accept: input.accept }), {
    invalidate: ["roster"],
    success: (_r, input) => (input.accept ? "Accepted — waiting for manager approval" : "Swap declined"),
    errorTitle: "Could not respond",
  });
  const cancel = useApiMutation((id: number) => api.post(`/roster/swaps/${id}/cancel`), { invalidate: ["roster"], success: "Swap request cancelled", errorTitle: "Could not cancel" });
  const decide = useApiMutation((input: { id: number; status: "Approved" | "Rejected"; managerNote?: string }) => api.patch(`/roster/swaps/${input.id}/decision`, input), {
    invalidate: ["roster"],
    success: (_r, input) => (input.status === "Approved" ? "Swap approved — roster updated" : "Swap rejected"),
    errorTitle: "Could not record decision",
  });

  // Dates I can offer: today or later, with a non-leave shift.
  const myDates = useMemo(
    () => monthDates.filter((d) => d >= today && shifts.get(cellKey(userId, d)) && SHIFT_BY_CODE.get(shifts.get(cellKey(userId, d))!)?.kind !== "leave"),
    [monthDates, today, shifts, userId],
  );
  const myShift = date ? shifts.get(cellKey(userId, date)) : undefined;
  const colleagues = useMemo(
    () =>
      date
        ? people
            .filter((p) => p.id !== userId)
            .map((p) => ({ ...p, shift: shifts.get(cellKey(p.id, date)) }))
            .filter((p) => p.shift && p.shift !== myShift && SHIFT_BY_CODE.get(p.shift)?.kind !== "leave")
        : [],
    [date, people, shifts, userId, myShift],
  );
  const targetShift = colleagues.find((c) => c.id === targetId)?.shift;

  function openRequest() {
    setDate(myDates[0] ?? "");
    setTargetId(0);
    setReason("");
    setOpen(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    request.mutate({ dutyDate: date, targetId, reason: reason || undefined }, { onSuccess: () => setOpen(false) });
  }

  const rows = swaps.data ?? [];
  const awaitingMe = rows.filter((s) => s.status === "Pending" && s.targetId === userId);
  const awaitingManager = rows.filter((s) => s.status === "Accepted");

  return (
    <Panel className="mt-5">
      <PanelHeader
        title="Shift swaps"
        description={isManager ? `${awaitingManager.length} waiting for approval · staff request, colleague accepts, manager approves` : "Ask a colleague to swap shifts. A manager approves before the roster changes."}
        action={canRequest ? <Button variant="outline" onClick={openRequest} disabled={!myDates.length}><Repeat2 className="h-4 w-4" />Request swap</Button> : undefined}
      />
      {swaps.isLoading ? <LoadingState /> : rows.length ? (
        <div className="overflow-x-auto">
          <table className="data-table min-w-[860px]">
            <thead><tr><th>Date</th><th>Swap</th><th>Reason</th><th>Status</th><th className="text-right">Action</th></tr></thead>
            <tbody>
              {rows.map((swap) => {
                const mineToAnswer = swap.status === "Pending" && swap.targetId === userId;
                const mineToCancel = (swap.status === "Pending" || swap.status === "Accepted") && swap.requesterId === userId;
                const involved = swap.requesterId === userId || swap.targetId === userId;
                const canDecide = isManager && swap.status === "Accepted" && (!involved || isAdmin);
                return (
                  <tr key={swap.id} className={mineToAnswer || canDecide ? "bg-[#fffaf0]" : undefined}>
                    <td className="whitespace-nowrap">{formatDate(swap.dutyDate, { weekday: "short", day: "2-digit", month: "short" })}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-medium text-[#1d2939]">{swap.requesterName}</span><ShiftChip code={swap.requesterShift} />
                        <ArrowLeftRight className="h-3.5 w-3.5 text-[#98a2b3]" />
                        <span className="font-medium text-[#1d2939]">{swap.targetName}</span><ShiftChip code={swap.targetShift} />
                      </div>
                    </td>
                    <td className="max-w-56"><div className="truncate" title={swap.reason ?? ""}>{swap.reason ?? "—"}</div>{swap.managerNote && <div className="truncate text-[11px] text-[#98a2b3]" title={swap.managerNote}>Note: {swap.managerNote}</div>}</td>
                    <td>
                      <StatusBadge status={swap.status === "Accepted" ? "Awaiting manager" : swap.status} />
                      {swap.decidedByName && <div className="mt-1 text-[10px] text-[#98a2b3]">by {swap.decidedByName}</div>}
                    </td>
                    <td>
                      <div className="flex justify-end gap-2">
                        {mineToAnswer && <>
                          <Button size="sm" variant="outline" disabled={respond.isPending} onClick={() => respond.mutate({ id: swap.id, accept: false })}><X className="h-3.5 w-3.5" />Decline</Button>
                          <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ id: swap.id, accept: true })}><Check className="h-3.5 w-3.5" />Accept</Button>
                        </>}
                        {canDecide && <>
                          <Button size="sm" variant="outline" onClick={() => setDeciding({ swap, status: "Rejected" })}><X className="h-3.5 w-3.5" />Reject</Button>
                          <Button size="sm" onClick={() => setDeciding({ swap, status: "Approved" })}><Check className="h-3.5 w-3.5" />Approve</Button>
                        </>}
                        {mineToCancel && <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(swap.id)}>Cancel</Button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="No swap requests" description={canRequest ? "Need to change a shift? Request a swap with a colleague." : "Swap requests from staff will appear here."} />}
      {awaitingMe.length > 0 && <div className="border-t border-[#f5e3b5] bg-[#fffaf0] px-5 py-3 text-xs text-[#7a4f00]">{awaitingMe.length} colleague{awaitingMe.length === 1 ? " is" : "s are"} waiting for your answer.</div>}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request a shift swap</DialogTitle><DialogDescription>Your colleague accepts first, then a manager approves. The roster changes only after approval.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Date">
              <select className="form-input" required value={date} onChange={(e) => { setDate(e.target.value); setTargetId(0); }}>
                {myDates.map((d) => <option key={d} value={d}>{formatDate(d, { weekday: "short", day: "2-digit", month: "short" })} · your shift {shifts.get(cellKey(userId, d))}</option>)}
              </select>
            </Field>
            <Field label="Swap with" hint={date && !colleagues.length ? "Nobody has a different shift you can swap with on this date." : undefined}>
              <select className="form-input" required value={targetId} onChange={(e) => setTargetId(Number(e.target.value))}>
                <option value={0} disabled>Choose a colleague</option>
                {colleagues.map((c) => <option key={c.id} value={c.id}>{c.name} · shift {c.shift}</option>)}
              </select>
            </Field>
            {myShift && targetShift && (
              <div className="flex items-center justify-center gap-3 rounded-lg bg-[#f8fafc] p-3 text-sm">
                <span>You</span><ShiftChip code={myShift} /><ArrowLeftRight className="h-4 w-4 text-[#98a2b3]" /><ShiftChip code={targetShift} /><span>{colleagues.find((c) => c.id === targetId)?.name.split(" ")[0]}</span>
              </div>
            )}
            <Field label="Reason (optional)"><textarea className="form-input" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={!date || !targetId || request.isPending}>{request.isPending ? "Sending…" : "Send request"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deciding)} onOpenChange={(value) => !value && setDeciding(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{deciding?.status === "Approved" ? "Approve swap" : "Reject swap"}</DialogTitle>
            <DialogDescription>{deciding && `${deciding.swap.requesterName} (${deciding.swap.requesterShift}) ⇄ ${deciding.swap.targetName} (${deciding.swap.targetShift}) on ${formatDate(deciding.swap.dutyDate)}`}</DialogDescription>
          </DialogHeader>
          <Field label="Note (optional)"><textarea className="form-input" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button
              disabled={decide.isPending}
              className={deciding?.status === "Rejected" ? "bg-[#b42318] hover:bg-[#912018]" : undefined}
              onClick={() => deciding && decide.mutate({ id: deciding.swap.id, status: deciding.status, managerNote: note || undefined }, { onSuccess: () => { setDeciding(null); setNote(""); } })}
            >
              {deciding?.status === "Approved" ? "Approve & update roster" : "Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
