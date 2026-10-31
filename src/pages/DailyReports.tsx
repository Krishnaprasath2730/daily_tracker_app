import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Account } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader } from "@/components/Workspace";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { useDebounced } from "@/hooks/use-debounced";
import { api } from "@/lib/api";
import { ACCOUNTS, SHIFTS, WORK_SHIFT_CODES, downloadCsv, formatDate, todayInput } from "@/lib/operations";
import type { DailyReport } from "@/lib/types";
import { useAuth } from "@/providers/auth";

type FormState = {
  employeeId: number;
  reportDate: string;
  account: Account;
  shiftCode: string;
  edrDrt: number;
  edrPmt: number;
  manDrt: number;
  manPmt: number;
  delayMinutes: number;
  extendedMinutes: number;
  notes: string;
};

const blankForm = (employeeId: number): FormState => ({
  employeeId,
  reportDate: todayInput(),
  account: ACCOUNTS[0],
  shiftCode: "1",
  edrDrt: 0,
  edrPmt: 0,
  manDrt: 0,
  manPmt: 0,
  delayMinutes: 0,
  extendedMinutes: 0,
  notes: "",
});

const NUMBER_FIELDS = ["edrDrt", "edrPmt", "manDrt", "manPmt", "delayMinutes", "extendedMinutes"] as const;

export default function DailyReports() {
  const { user, isManager } = useAuth();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<DailyReport | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm(user!.id));
  const [search, setSearch] = useState("");
  const [account, setAccount] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [employeeFilter, setEmployeeFilter] = useState("");
  const debouncedSearch = useDebounced(search, 300);
  const employees = useEmployees();

  const filters = { search: debouncedSearch, account, from, to, employeeId: employeeFilter };
  const reports = useQuery({
    queryKey: ["reports", filters],
    queryFn: () => api.get<DailyReport[]>("/reports", filters),
    placeholderData: keepPreviousData,
  });

  // Open the form directly from the dashboard ("New daily report").
  useEffect(() => {
    if (params.get("new") === "1") {
      startNew();
      setParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const save = useApiMutation(
    (input: { id?: number; body: FormState }) => {
      const body = { ...input.body, notes: input.body.notes || undefined, employeeId: isManager ? input.body.employeeId : undefined };
      return input.id ? api.put(`/reports/${input.id}`, body) : api.post("/reports", body);
    },
    { invalidate: ["reports"], success: (_r, input) => (input.id ? "Report updated" : "Daily report submitted"), errorTitle: "Could not save report" },
  );
  const remove = useApiMutation((id: number) => api.delete(`/reports/${id}`), { invalidate: ["reports"], success: "Report deleted", errorTitle: "Could not delete report" });

  const rows = useMemo(() => reports.data ?? [], [reports.data]);
  const totals = useMemo(
    () => rows.reduce((sum, r) => ({ drt: sum.drt + r.edrDrt + r.manDrt, pmt: sum.pmt + r.edrPmt + r.manPmt }), { drt: 0, pmt: 0 }),
    [rows],
  );

  function startNew() {
    setEditing(null);
    setForm(blankForm(user!.id));
    setOpen(true);
  }

  function startEdit(report: DailyReport) {
    setEditing(report);
    setForm({
      employeeId: report.employeeId,
      reportDate: report.reportDate,
      account: report.account,
      shiftCode: report.shiftCode,
      edrDrt: report.edrDrt,
      edrPmt: report.edrPmt,
      manDrt: report.manDrt,
      manPmt: report.manPmt,
      delayMinutes: report.delayMinutes,
      extendedMinutes: report.extendedMinutes,
      notes: report.notes ?? "",
    });
    setOpen(true);
  }

  const canEdit = (report: DailyReport) =>
    isManager || (report.employeeId === user!.id && Date.now() - new Date(report.createdAt).getTime() < 24 * 3600_000);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    save.mutate({ id: editing?.id, body: form }, { onSuccess: () => setOpen(false) });
  }

  function exportRows() {
    downloadCsv(
      `infinity-daily-reports-${todayInput()}.csv`,
      ["Employee", "Employee ID", "Date", "Account", "Shift", "EDR DRT", "EDR PMT", "MAN DRT", "MAN PMT", "Delay minutes", "Extended minutes", "Notes"],
      rows.map((r) => [r.employeeName, r.employeeCode, r.reportDate, r.account, r.shiftCode, r.edrDrt, r.edrPmt, r.manDrt, r.manPmt, r.delayMinutes, r.extendedMinutes, r.notes]),
    );
    toast.success("CSV export downloaded");
  }

  const hasFilters = Boolean(search || account || from || to || employeeFilter);

  return (
    <div>
      <PageHeader
        eyebrow="Production register"
        title="Daily report"
        description="Capture EDR and MAN production by account, with DRT/PMT split, shift delays and extended hours."
        actions={<><Button variant="outline" onClick={exportRows} disabled={!rows.length}><Download className="h-4 w-4" /> Export CSV</Button><Button onClick={startNew}><Plus className="h-4 w-4" /> New report</Button></>}
      />

      <Panel>
        <PanelHeader
          title="Report register"
          description={`${rows.length} submission${rows.length === 1 ? "" : "s"} · ${totals.drt} DRT · ${totals.pmt} PMT`}
          action={
            <div className="flex flex-wrap gap-2">
              <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#98a2b3]" /><input className="form-input h-10 w-48 pl-9" placeholder="Search staff or notes" value={search} onChange={(e) => setSearch(e.target.value)} maxLength={80} /></div>
              {isManager && (
                <select aria-label="Filter by employee" className="form-input h-10 w-44" value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}>
                  <option value="">All staff</option>
                  {employees.data?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              )}
              <select aria-label="Filter by account" className="form-input h-10 w-44" value={account} onChange={(e) => setAccount(e.target.value)}><option value="">All accounts</option>{ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select>
              <input aria-label="From date" type="date" className="form-input h-10 w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <input aria-label="To date" type="date" className="form-input h-10 w-36" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              {hasFilters && <Button variant="ghost" className="h-10" onClick={() => { setSearch(""); setAccount(""); setFrom(""); setTo(""); setEmployeeFilter(""); }}>Clear</Button>}
            </div>
          }
        />
        {reports.isLoading ? <LoadingState /> : reports.error ? <ErrorState message={reports.error.message} retry={() => reports.refetch()} /> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1140px]">
              <thead><tr><th>Employee</th><th>Date</th><th>Account</th><th>Shift</th><th className="text-right">EDR DRT</th><th className="text-right">EDR PMT</th><th className="text-right">MAN DRT</th><th className="text-right">MAN PMT</th><th className="text-right">Total</th><th className="text-right">Delay / Ext.</th><th className="w-24" /></tr></thead>
              <tbody>{rows.map((report) => (
                <tr key={report.id}>
                  <td><div className="font-medium text-[#1d2939]">{report.employeeName}</div><div className="mt-0.5 font-mono text-[10px]">{report.employeeCode}</div></td>
                  <td className="whitespace-nowrap">{formatDate(report.reportDate)}</td>
                  <td className="max-w-48 truncate text-xs" title={report.account}>{report.account}</td>
                  <td><span className="font-mono font-medium text-[#0064e6]">{report.shiftCode}</span><div className="mt-0.5 whitespace-nowrap text-[10px] text-[#98a2b3]">{SHIFTS[report.shiftCode] ?? ""}</div></td>
                  <td className="text-right font-mono">{report.edrDrt}</td><td className="text-right font-mono">{report.edrPmt}</td><td className="text-right font-mono">{report.manDrt}</td><td className="text-right font-mono">{report.manPmt}</td>
                  <td className="text-right font-mono font-semibold text-[#1d2939]">{report.edrDrt + report.edrPmt + report.manDrt + report.manPmt}</td>
                  <td className="whitespace-nowrap text-right font-mono text-xs">{report.delayMinutes}m / {report.extendedMinutes}m</td>
                  <td className="text-right">
                    {canEdit(report) && (
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" aria-label="Edit report" onClick={() => startEdit(report)}><Pencil className="h-4 w-4" /></Button>
                        <ConfirmButton title="Delete this report?" description={`${report.employeeName} · ${formatDate(report.reportDate)} · ${report.account}. This cannot be undone.`} confirmLabel="Delete" onConfirm={() => remove.mutate(report.id)}>
                          <Button size="icon" variant="ghost" aria-label="Delete report" className="text-[#b42318] hover:text-[#b42318]"><Trash2 className="h-4 w-4" /></Button>
                        </ConfirmButton>
                      </div>
                    )}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No matching reports" description="Adjust the filters or submit a new daily report." />}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? "Edit daily report" : "New daily report"}</DialogTitle><DialogDescription>Record one employee’s production for an account and shift.</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="mt-2 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee">
                {isManager ? (
                  <select required className="form-input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: Number(e.target.value) })}>{employees.data?.map((e) => <option value={e.id} key={e.id}>{e.name} · {e.employeeCode}</option>)}</select>
                ) : <input className="form-input bg-[#f8fafc]" disabled value={`${user!.name} · ${user!.employeeCode}`} />}
              </Field>
              <Field label="Report date"><input required type="date" className="form-input" max={isManager ? undefined : todayInput()} value={form.reportDate} onChange={(e) => setForm({ ...form, reportDate: e.target.value })} /></Field>
              <Field label="Account"><select className="form-input" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value as Account })}>{ACCOUNTS.map((item) => <option key={item}>{item}</option>)}</select></Field>
              <Field label="Shift"><select className="form-input" value={form.shiftCode} onChange={(e) => setForm({ ...form, shiftCode: e.target.value })}>{WORK_SHIFT_CODES.map((code) => <option value={code} key={code}>{code} · {SHIFTS[code]}</option>)}</select></Field>
            </div>
            <div className="rounded-lg border border-[#e4e9f0] bg-[#f8fafc] p-4">
              <div className="mb-4 font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#667085]">Production count</div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(["edrDrt", "edrPmt", "manDrt", "manPmt"] as const).map((key) => (
                  <Field key={key} label={`${key.startsWith("edr") ? "EDR" : "MAN"} · ${key.endsWith("Drt") ? "DRT" : "PMT"}`}>
                    <NumberInput value={form[key]} max={100000} onChange={(value) => setForm({ ...form, [key]: value })} />
                  </Field>
                ))}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {NUMBER_FIELDS.slice(4).map((key) => (
                <Field key={key} label={key === "delayMinutes" ? "Delay duration (minutes)" : "Extended hours (minutes)"}>
                  <NumberInput value={form[key]} max={1440} onChange={(value) => setForm({ ...form, [key]: value })} />
                </Field>
              ))}
            </div>
            <Field label="Shift notes (optional)"><textarea className="form-input" maxLength={2000} placeholder="Handover notes, exceptions, or production context" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div className="flex justify-end gap-2 border-t border-[#edf0f4] pt-4"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Submit report"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NumberInput({ value, max, onChange }: { value: number; max: number; onChange: (value: number) => void }) {
  return (
    <input
      required
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      className="form-input font-mono"
      value={value}
      onChange={(e) => onChange(Math.min(max, Math.max(0, Math.floor(Number(e.target.value) || 0))))}
    />
  );
}
