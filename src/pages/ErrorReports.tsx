import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CircleAlert, Download, Plus, Search } from "lucide-react";
import { ERROR_STATUSES, ERROR_TYPES, SEVERITIES, type Account, type ErrorStatus, type Severity } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import { ACCOUNTS, downloadCsv, formatDate, todayInput } from "@/lib/operations";
import type { ErrorReport } from "@/lib/types";
import { useAuth } from "@/providers/auth";

const blankForm = (employeeId: number) => ({
  employeeId,
  reportDate: todayInput(),
  account: ACCOUNTS[0] as Account,
  errorType: ERROR_TYPES[0] as string,
  reference: "",
  description: "",
  severity: "Medium" as Severity,
  correctiveAction: "",
});

export default function ErrorReports() {
  const { user, isManager } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankForm(user!.id));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ErrorStatus | "">("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const debouncedSearch = useDebounced(search, 300);
  const employees = useEmployees();

  const all = useQuery({ queryKey: ["errors", "all"], queryFn: () => api.get<ErrorReport[]>("/errors") });
  const filters = { search: debouncedSearch, status, severity };
  const errors = useQuery({
    queryKey: ["errors", filters],
    queryFn: () => api.get<ErrorReport[]>("/errors", filters),
    placeholderData: keepPreviousData,
  });

  const create = useApiMutation((body: typeof form) => api.post("/errors", { ...body, reference: body.reference || undefined, correctiveAction: body.correctiveAction || undefined }), {
    invalidate: ["errors"],
    success: "Error report logged",
    errorTitle: "Could not log error",
  });
  const update = useApiMutation((input: { id: number; status: ErrorStatus }) => api.patch(`/errors/${input.id}`, { status: input.status }), {
    invalidate: ["errors"],
    success: (_r, input) => `Error marked ${input.status.toLowerCase()}`,
    errorTitle: "Could not update status",
  });

  const rows = errors.data ?? [];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    create.mutate(form, { onSuccess: () => { setOpen(false); setForm(blankForm(user!.id)); } });
  }

  function exportRows() {
    downloadCsv(`infinity-error-reports-${todayInput()}.csv`, ["Date", "Employee", "Employee ID", "Account", "Type", "Reference", "Severity", "Status", "Description", "Corrective action", "Reported by"],
      rows.map((r) => [r.reportDate, r.employeeName, r.employeeCode, r.account, r.errorType, r.reference, r.severity, r.status, r.description, r.correctiveAction, r.reportedByName]));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Quality & exceptions"
        title="Error report"
        description="Log operational issues, record corrective action and track each case through review to resolution."
        actions={<><Button variant="outline" onClick={exportRows} disabled={!rows.length}><Download className="h-4 w-4" /> Export</Button><Button onClick={() => { setForm(blankForm(user!.id)); setOpen(true); }}><Plus className="h-4 w-4" /> Log error</Button></>}
      />
      <div className="mb-5 grid grid-cols-3 gap-3">
        {ERROR_STATUSES.map((item) => (
          <button key={item} onClick={() => setStatus(status === item ? "" : item)} className={`rounded-xl border bg-white p-4 text-left transition-colors ${status === item ? "border-[#0064e6] ring-1 ring-[#0064e6]" : "border-[#e4e9f0] hover:border-[#b9d5fb]"}`}>
            <div className="flex items-center justify-between"><span className="text-xs font-medium text-[#667085]">{item}</span><CircleAlert className="h-4 w-4 text-[#98a2b3]" /></div>
            <div className="mt-2 font-mono text-2xl font-medium text-[#101828]">{(all.data ?? []).filter((e) => e.status === item).length}</div>
          </button>
        ))}
      </div>
      <Panel>
        <PanelHeader
          title="Exception register"
          description={`${rows.length} case${rows.length === 1 ? "" : "s"} shown`}
          action={
            <div className="flex flex-wrap gap-2">
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#98a2b3]" /><input className="form-input h-10 w-56 pl-9" placeholder="Search cases" maxLength={80} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
              <select aria-label="Filter status" className="form-input h-10 w-36" value={status} onChange={(e) => setStatus(e.target.value as ErrorStatus | "")}><option value="">All statuses</option>{ERROR_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              <select aria-label="Filter severity" className="form-input h-10 w-36" value={severity} onChange={(e) => setSeverity(e.target.value as Severity | "")}><option value="">All severities</option>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
          }
        />
        {errors.isLoading ? <LoadingState /> : errors.error ? <ErrorState message={errors.error.message} retry={() => errors.refetch()} /> : rows.length ? (
          <div className="divide-y divide-[#edf0f4]">
            {rows.map((error) => (
              <article key={error.id} className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_220px]">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge status={error.severity} /><span className="font-mono text-[10px] uppercase tracking-wider text-[#667085]">{error.account}</span><span className="text-xs text-[#98a2b3]">·</span><span className="text-xs text-[#667085]">{error.errorType}</span></div>
                  <p className="mt-3 max-w-4xl whitespace-pre-line text-sm leading-6 text-[#344054]">{error.description}</p>
                  {error.correctiveAction && <div className="mt-3 border-l-2 border-[#b9d5fb] pl-3 text-xs leading-5 text-[#667085]"><span className="font-medium text-[#344054]">Corrective action: </span>{error.correctiveAction}</div>}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-[#98a2b3]"><span>{error.employeeName}</span><span>{formatDate(error.reportDate)}</span>{error.reference && <span>REF {error.reference}</span>}{error.reportedByName && <span>Logged by {error.reportedByName}</span>}</div>
                </div>
                <div className="flex items-center justify-start lg:justify-end">
                  {isManager ? (
                    <label className="flex items-center gap-2 text-xs text-[#667085]"><span>Status</span>
                      <select aria-label={`Status for error ${error.id}`} className="form-input h-10 w-36" value={error.status} disabled={update.isPending} onChange={(e) => update.mutate({ id: error.id, status: e.target.value as ErrorStatus })}>{ERROR_STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
                    </label>
                  ) : <StatusBadge status={error.status} />}
                </div>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No matching error reports" description="Adjust the filters or log a new operational exception." />}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>Log an error</DialogTitle><DialogDescription>Provide enough detail for review and corrective action.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="mt-2 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee">
                {isManager ? <select className="form-input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })}>{employees.data?.map((e) => <option value={e.id} key={e.id}>{e.name}</option>)}</select>
                  : <input className="form-input bg-[#f8fafc]" disabled value={user!.name} />}
              </Field>
              <Field label="Date"><input required type="date" className="form-input" max={todayInput()} value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} /></Field>
              <Field label="Account"><select className="form-input" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value as Account })}>{ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Error type"><select className="form-input" value={form.errorType} onChange={(e) => setForm({ ...form, errorType: e.target.value })}>{ERROR_TYPES.map((t) => <option key={t}>{t}</option>)}</select></Field>
              <Field label="Reference (optional)"><input className="form-input" maxLength={100} placeholder="AWB, job or entry reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></Field>
              <Field label="Severity"><select className="form-input" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })}>{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            </div>
            <Field label="What happened?"><textarea required minLength={5} maxLength={3000} className="form-input" placeholder="Describe the issue and where it occurred" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <Field label="Immediate corrective action (optional)"><textarea maxLength={3000} className="form-input" placeholder="Action already taken or next verification step" value={form.correctiveAction} onChange={(e) => setForm({ ...form, correctiveAction: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 border-t border-[#edf0f4] pt-4"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>{create.isPending ? "Logging…" : "Log error"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
