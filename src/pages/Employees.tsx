import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Lock, Pencil, Plus, Search, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ROLES, type Role } from "@shared/constants";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { useApiMutation } from "@/hooks/use-data";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/operations";
import type { Employee } from "@/lib/types";
import { useAuth } from "@/providers/auth";

const ROLE_LABEL: Record<Role, string> = { admin: "Admin", manager: "Manager", employee: "Staff" };
const blank = { employeeCode: "", biometricId: "", name: "", email: "", team: "Support", role: "employee" as Role };

export default function Employees() {
  const { user } = useAuth();
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Employee | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const [secret, setSecret] = useState<{ name: string; password: string } | null>(null);

  const employees = useQuery({ queryKey: ["employees", "admin", showInactive], queryFn: () => api.get<Employee[]>("/employees", { includeInactive: showInactive }) });
  const create = useApiMutation((body: typeof form) => api.post<{ id: number; temporaryPassword?: string }>("/employees", { ...body, email: body.email || undefined, biometricId: body.biometricId || undefined }), {
    invalidate: ["employees"],
    success: "Employee created",
    errorTitle: "Could not create employee",
  });
  const update = useApiMutation((input: { id: number; body: Record<string, unknown> }) => api.patch(`/employees/${input.id}`, input.body), {
    invalidate: ["employees"],
    success: "Employee updated",
    errorTitle: "Could not update employee",
  });
  const reset = useApiMutation((id: number) => api.post<{ temporaryPassword: string }>(`/employees/${id}/reset-password`), {
    invalidate: ["employees"],
    errorTitle: "Could not reset password",
  });

  const term = search.toLowerCase();
  const rows = (employees.data ?? []).filter((e) => !term || `${e.name} ${e.employeeCode} ${e.biometricId ?? ""} ${e.email ?? ""} ${e.team}`.toLowerCase().includes(term));

  function openNew() {
    setEditing(null);
    setForm(blank);
    setOpen(true);
  }

  function openEdit(employee: Employee) {
    setEditing(employee);
    setForm({ employeeCode: employee.employeeCode, biometricId: employee.biometricId ?? "", name: employee.name, email: employee.email ?? "", team: employee.team, role: employee.role });
    setOpen(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (editing) {
      update.mutate({ id: editing.id, body: { name: form.name, email: form.email || null, team: form.team, role: form.role, biometricId: form.biometricId || null } }, { onSuccess: () => setOpen(false) });
    } else {
      create.mutate(form, {
        onSuccess: (result) => {
          setOpen(false);
          if (result.temporaryPassword) setSecret({ name: form.name, password: result.temporaryPassword });
        },
      });
    }
  }

  async function copySecret() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret.password);
      toast.success("Password copied");
    } catch {
      toast.error("Copy failed — select and copy it manually");
    }
  }

  const locked = (e: Employee) => e.isLocked;

  return (
    <div>
      <PageHeader eyebrow="Administration" title="Employees" description="Create staff accounts, assign roles, reset passwords and deactivate leavers. Every change is recorded in the audit log." actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Add employee</Button>} />
      <Panel>
        <PanelHeader
          title="Staff directory"
          description={`${rows.length} account${rows.length === 1 ? "" : "s"}`}
          action={<div className="flex flex-wrap items-center gap-3">
            <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-[#98a2b3]" /><input className="form-input h-10 w-56 pl-9" placeholder="Search name, ID, email" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <label className="flex items-center gap-2 text-xs text-[#667085]"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />Show inactive</label>
          </div>}
        />
        {employees.isLoading ? <LoadingState /> : employees.error ? <ErrorState message={employees.error.message} retry={() => employees.refetch()} /> : rows.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[980px]">
              <thead><tr><th>Employee</th><th>Machine ID</th><th>Team</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="text-right">Actions</th></tr></thead>
              <tbody>{rows.map((employee) => (
                <tr key={employee.id} className={employee.isActive ? "" : "opacity-60"}>
                  <td><div className="font-medium text-[#1d2939]">{employee.name}</div><div className="mt-0.5 font-mono text-[10px]">{employee.employeeCode}{employee.email ? ` · ${employee.email}` : ""}</div></td>
                  <td>{employee.biometricId ? <span className="font-mono text-xs font-medium text-[#344054]">{employee.biometricId}</span> : <span className="text-xs text-[#b54708]">Not set</span>}</td>
                  <td>{employee.team}</td>
                  <td><span className="font-mono text-xs font-medium uppercase text-[#0064e6]">{ROLE_LABEL[employee.role]}</span></td>
                  <td className="space-x-1 whitespace-nowrap">
                    <StatusBadge status={employee.isActive ? "Active" : "Inactive"} />
                    {locked(employee) && <StatusBadge status="Locked" />}
                    {employee.mustChangePassword && employee.isActive && <span className="text-[10px] text-[#98a2b3]">temp password</span>}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs">{formatDateTime(employee.lastLoginAt)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="icon" variant="ghost" aria-label="Edit" title="Edit" onClick={() => openEdit(employee)}><Pencil className="h-4 w-4" /></Button>
                      {locked(employee) && <Button size="icon" variant="ghost" aria-label="Unlock" title="Unlock account" onClick={() => update.mutate({ id: employee.id, body: { unlock: true } })}><Lock className="h-4 w-4" /></Button>}
                      <ConfirmButton title={`Reset password for ${employee.name}?`} description="A new temporary password is generated and all their sessions are signed out. They must change it at next sign-in." confirmLabel="Reset password" onConfirm={() => reset.mutate(employee.id, { onSuccess: (r) => setSecret({ name: employee.name, password: r.temporaryPassword }) })}>
                        <Button size="icon" variant="ghost" aria-label="Reset password" title="Reset password"><KeyRound className="h-4 w-4" /></Button>
                      </ConfirmButton>
                      {employee.id !== user!.id && (employee.isActive ? (
                        <ConfirmButton title={`Deactivate ${employee.name}?`} description="They will be signed out immediately and can no longer sign in. Their records are kept." confirmLabel="Deactivate" onConfirm={() => update.mutate({ id: employee.id, body: { isActive: false } })}>
                          <Button size="icon" variant="ghost" aria-label="Deactivate" title="Deactivate" className="text-[#b42318] hover:text-[#b42318]"><UserX className="h-4 w-4" /></Button>
                        </ConfirmButton>
                      ) : (
                        <Button size="icon" variant="ghost" aria-label="Reactivate" title="Reactivate" onClick={() => update.mutate({ id: employee.id, body: { isActive: true } })}><UserCheck className="h-4 w-4" /></Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No employees found" description="Adjust the search or add a new employee." />}
      </Panel>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit employee" : "Add employee"}</DialogTitle><DialogDescription>{editing ? "Role changes sign the person out so new permissions apply immediately." : "A temporary password is generated and shown once."}</DialogDescription></DialogHeader>
          <form onSubmit={submit} className="mt-2 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee ID"><input required disabled={Boolean(editing)} pattern="[A-Za-z0-9/_\-]+" maxLength={40} className="form-input font-mono" placeholder="IS/2026/1100" value={form.employeeCode} onChange={(e) => setForm({ ...form, employeeCode: e.target.value })} /></Field>
              <Field label="Machine ID (optional)" hint="Enrollment number on the biometric machine"><input pattern="[A-Za-z0-9]{1,20}" maxLength={20} className="form-input font-mono" placeholder="1100" value={form.biometricId} onChange={(e) => setForm({ ...form, biometricId: e.target.value.trim() })} /></Field>
              <Field label="Full name"><input required minLength={2} maxLength={120} className="form-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Email (optional)"><input type="email" maxLength={160} className="form-input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Team"><input required minLength={2} maxLength={80} className="form-input" value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} /></Field>
              <Field label="Role"><select className="form-input" disabled={editing?.id === user!.id} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></Field>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#edf0f4] pt-4"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending || update.isPending}>{editing ? "Save changes" : "Create employee"}</Button></div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Temporary password</DialogTitle><DialogDescription>Give this to {secret?.name} privately. It is shown only once and must be changed at first sign-in.</DialogDescription></DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-[#e4e9f0] bg-[#f8fafc] p-3">
            <code className="flex-1 select-all break-all font-mono text-sm text-[#1d2939]">{secret?.password}</code>
            <Button size="icon" variant="ghost" aria-label="Copy password" onClick={copySecret}><Copy className="h-4 w-4" /></Button>
          </div>
          <div className="flex justify-end pt-2"><Button onClick={() => setSecret(null)}>Done</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
