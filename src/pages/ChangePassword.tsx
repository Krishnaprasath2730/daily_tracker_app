import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, KeyRound, LogOut, X } from "lucide-react";
import { toast } from "sonner";
import { passwordProblems, PASSWORD_RULES } from "@shared/constants";
import { Brand } from "@/components/Brand";
import { Field, PageHeader, Panel, PanelHeader } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/operations";
import { useAuth } from "@/providers/auth";

const CHECKS = [
  { label: `${PASSWORD_RULES.minLength}+ characters`, test: (p: string) => p.length >= PASSWORD_RULES.minLength },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Number", test: (p: string) => /[0-9]/.test(p) },
  { label: "Symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { user, refresh, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const problems = passwordProblems(next);
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (problems.length) return setError(problems.join(". "));
    if (next !== confirm) return setError("The new passwords do not match");
    setPending(true);
    try {
      await api.post("/auth/change-password", { currentPassword: current, newPassword: next });
      toast.success("Password updated", { description: "Other devices have been signed out." });
      setCurrent(""); setNext(""); setConfirm("");
      await refresh();
      if (!forced) navigate("/");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const form = (
    <form onSubmit={submit} className="space-y-5 p-5 md:p-6">
      <Field label="Current password"><input className="form-input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>
      <Field label="New password"><input className="form-input" type="password" autoComplete="new-password" required maxLength={PASSWORD_RULES.maxLength} value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <ul className="grid grid-cols-2 gap-2 text-xs" aria-label="Password requirements">
        {CHECKS.map((check) => {
          const ok = check.test(next);
          return <li key={check.label} className={`flex items-center gap-1.5 ${ok ? "text-[#157347]" : "text-[#98a2b3]"}`}>{ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{check.label}</li>;
        })}
      </ul>
      <Field label="Confirm new password"><input className="form-input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
      {mismatch && <p className="text-xs text-[#b42318]">Passwords do not match.</p>}
      {error && <div role="alert" className="rounded-lg border border-[#f0d9d5] bg-[#fffafa] px-3 py-2.5 text-sm text-[#b42318]">{error}</div>}
      <div className="flex justify-end gap-2 border-t border-[#edf0f4] pt-5">
        {forced && <Button type="button" variant="outline" onClick={() => logout()}><LogOut className="h-4 w-4" />Sign out</Button>}
        <Button type="submit" disabled={pending || !current || problems.length > 0 || next !== confirm}><KeyRound className="h-4 w-4" />{pending ? "Saving…" : "Update password"}</Button>
      </div>
    </form>
  );

  if (forced) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f6f8fb] p-4">
        <div className="w-full max-w-md">
          <Brand className="mb-8" />
          <Panel>
            <PanelHeader title={`Welcome, ${user?.name ?? ""}`} description="For security, set your own password before continuing." />
            {form}
          </Panel>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader eyebrow="Account security" title="Change password" description="Choose a strong password you do not use anywhere else. Changing it signs out your other devices." />
      <Panel>{form}</Panel>
    </div>
  );
}
