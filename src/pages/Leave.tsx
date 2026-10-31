import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Check, Info, X } from "lucide-react";
import { LEAVE_STATUSES, LEAVE_TYPES, type LeaveStatus, type LeaveType } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { formatDate, todayInput } from "@/lib/operations";
import type { LeaveRequest } from "@/lib/types";
import { useAuth } from "@/providers/auth";

export default function Leave() {
  const { user, isManager } = useAuth();
  const employees = useEmployees();
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | "">("");
  const [form, setForm] = useState({ employeeId: user!.id, leaveType: "Annual leave" as LeaveType, startDate: todayInput(), endDate: todayInput(), reason: "" });
  const [decision, setDecision] = useState<{ leave: LeaveRequest; status: "Approved" | "Rejected" } | null>(null);
  const [note, setNote] = useState("");

  const leaves = useQuery({ queryKey: ["leave", statusFilter], queryFn: () => api.get<LeaveRequest[]>("/leave", { status: statusFilter }) });
  const create = useApiMutation((body: typeof form) => api.post("/leave", { ...body, employeeId: isManager ? body.employeeId : undefined }), {
    invalidate: ["leave"],
    success: "Leave application submitted",
    errorTitle: "Could not submit leave",
  });
  const decide = useApiMutation((input: { id: number; status: "Approved" | "Rejected"; managerNote?: string }) => api.patch(`/leave/${input.id}/decision`, input), {
    invalidate: ["leave", "roster"],
    success: (_r, input) => `Leave ${input.status.toLowerCase()}${input.status === "Approved" ? " — roster updated" : ""}`,
    errorTitle: "Could not record decision",
  });
  const cancel = useApiMutation((id: number) => api.post(`/leave/${id}/cancel`), { invalidate: ["leave"], success: "Leave application cancelled", errorTitle: "Could not cancel" });

  const days = form.endDate >= form.startDate ? Math.round((new Date(form.endDate).getTime() - new Date(form.startDate).getTime()) / 86400000) + 1 : 0;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    create.mutate(form, { onSuccess: () => setForm((current) => ({ ...current, reason: "" })) });
  }

  function confirmDecision() {
    if (!decision) return;
    decide.mutate({ id: decision.leave.id, status: decision.status, managerNote: note || undefined }, { onSuccess: () => { setDecision(null); setNote(""); } });
  }

  return (
    <div>
      <PageHeader eyebrow="People & availability" title="Leave application" description="Apply for annual or emergency leave. Managers review requests here, and approved leave is written to the duty roster automatically." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="New application" description="All requests start as pending until a manager reviews them" />
          <form onSubmit={submit} className="space-y-5 p-5">
            <Field label="Staff member">
              {isManager ? <select className="form-input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })}>{employees.data?.map((e) => <option value={e.id} key={e.id}>{e.name} · {e.employeeCode}</option>)}</select>
                : <input className="form-input bg-[#f8fafc]" disabled value={`${user!.name} · ${user!.employeeCode}`} />}
            </Field>
            <div>
              <span className="mb-2 block text-[13px] font-medium text-[#344054]">Leave type</span>
              <div className="grid grid-cols-2 gap-3">
                {LEAVE_TYPES.map((type) => (
                  <button type="button" key={type} onClick={() => setForm({ ...form, leaveType: type })} aria-pressed={form.leaveType === type} className={`flex min-h-16 items-center gap-3 rounded-lg border p-4 text-left transition-colors ${form.leaveType === type ? "border-[#0064e6] bg-[#f2f7ff] text-[#0053bf] ring-1 ring-[#0064e6]" : "border-[#d7dee8] bg-white text-[#475467] hover:border-[#9cc5f7]"}`}>
                    <CalendarDays className="h-5 w-5 shrink-0" /><span className="text-sm font-medium">{type}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date"><input required type="date" className="form-input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} /></Field>
              <Field label="End date" hint={days ? `${days} day${days === 1 ? "" : "s"}` : undefined}><input required type="date" className="form-input" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></Field>
            </div>
            <Field label="Reason" hint="Include handover or coverage information where relevant."><textarea required minLength={5} maxLength={2000} className="form-input" placeholder="Tell the manager why leave is needed" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></Field>
            <div className="flex justify-end"><Button type="submit" disabled={create.isPending || !days}>{create.isPending ? "Submitting…" : "Submit application"}</Button></div>
          </form>
        </Panel>
        <aside className="space-y-5">
          <div className="rounded-xl bg-[#0e253f] p-6 text-white">
            <Info className="h-5 w-5 text-[#9cc5f7]" />
            <h2 className="mt-4 font-condensed text-2xl font-semibold">Leave provision</h2>
            <p className="mt-3 text-sm leading-6 text-[#e4edf7]">Annual leave should be submitted in advance; emergency leave as soon as reasonably possible.</p>
            <p className="mt-3 text-sm leading-6 text-[#e4edf7]">Leave is confirmed only after a manager approves it. Overlapping requests are blocked automatically.</p>
          </div>
          <Panel className="p-5"><div className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#667085]">Application checklist</div><ul className="mt-4 space-y-3 text-sm leading-6 text-[#475467]"><li className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-[#157347]" />Select the correct leave type</li><li className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-[#157347]" />Confirm start and end dates</li><li className="flex gap-2"><Check className="mt-1 h-4 w-4 shrink-0 text-[#157347]" />Arrange shift handover</li></ul></Panel>
        </aside>
      </div>

      <Panel className="mt-5">
        <PanelHeader
          title={isManager ? "Leave register" : "My applications"}
          description="Applications and manager decisions"
          action={<select aria-label="Filter status" className="form-input h-10 w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as LeaveStatus | "")}><option value="">All statuses</option>{LEAVE_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>}
        />
        {leaves.isLoading ? <LoadingState /> : leaves.error ? <ErrorState message={leaves.error.message} retry={() => leaves.refetch()} /> : leaves.data?.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead><tr><th>Staff member</th><th>Type</th><th>Dates</th><th>Reason</th><th>Status</th><th className="text-right">Action</th></tr></thead>
              <tbody>{leaves.data.map((leave) => (
                <tr key={leave.id}>
                  <td><div className="font-medium text-[#1d2939]">{leave.employeeName}</div><div className="mt-0.5 font-mono text-[10px]">{leave.employeeCode}</div></td>
                  <td className="whitespace-nowrap">{leave.leaveType}</td>
                  <td className="whitespace-nowrap">{formatDate(leave.startDate, { day: "2-digit", month: "short" })} – {formatDate(leave.endDate)}<div className="mt-0.5 font-mono text-[10px] text-[#98a2b3]">{leave.days} day{leave.days === 1 ? "" : "s"}</div></td>
                  <td className="max-w-64"><div className="truncate" title={leave.reason}>{leave.reason}</div>{leave.managerNote && <div className="mt-0.5 truncate text-[11px] text-[#98a2b3]" title={leave.managerNote}>Note: {leave.managerNote}</div>}</td>
                  <td><StatusBadge status={leave.status} />{leave.reviewedByName && <div className="mt-1 text-[10px] text-[#98a2b3]">by {leave.reviewedByName}</div>}</td>
                  <td className="text-right">
                    {leave.status === "Pending" ? (
                      <div className="flex justify-end gap-2">
                        {isManager && (leave.employeeId !== user!.id || user!.role === "admin") && <>
                          <Button size="sm" variant="outline" onClick={() => setDecision({ leave, status: "Rejected" })}><X className="h-3.5 w-3.5" /> Reject</Button>
                          <Button size="sm" onClick={() => setDecision({ leave, status: "Approved" })}><Check className="h-3.5 w-3.5" /> Approve</Button>
                        </>}
                        {leave.employeeId === user!.id && (
                          <ConfirmButton title="Cancel this application?" description={`${leave.leaveType}, ${formatDate(leave.startDate)} – ${formatDate(leave.endDate)}.`} confirmLabel="Cancel application" onConfirm={() => cancel.mutate(leave.id)}>
                            <Button size="sm" variant="ghost">Cancel</Button>
                          </ConfirmButton>
                        )}
                      </div>
                    ) : <span className="text-xs text-[#98a2b3]">Decision recorded</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No leave applications" description="New annual and emergency leave applications will appear here." />}
      </Panel>

      <Dialog open={Boolean(decision)} onOpenChange={(value) => !value && setDecision(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{decision?.status === "Approved" ? "Approve leave" : "Reject leave"}</DialogTitle>
            <DialogDescription>{decision && `${decision.leave.employeeName} · ${decision.leave.leaveType} · ${formatDate(decision.leave.startDate)} – ${formatDate(decision.leave.endDate)}`}</DialogDescription>
          </DialogHeader>
          <Field label="Note to staff member (optional)" hint={decision?.status === "Approved" ? "The duty roster will be marked AL/EL for these dates." : undefined}>
            <textarea className="form-input" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button onClick={confirmDecision} disabled={decide.isPending} className={decision?.status === "Rejected" ? "bg-[#b42318] hover:bg-[#912018]" : undefined}>{decide.isPending ? "Saving…" : decision?.status === "Approved" ? "Approve" : "Reject"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
