import { useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/Brand";
import { Field } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/operations";
import { useAuth } from "@/providers/auth";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      await login(identifier.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      // Only follow internal paths to avoid open-redirects.
      navigate(from && from.startsWith("/") && !from.startsWith("//") && from !== "/login" ? from : "/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPassword("");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid min-h-dvh bg-[#f6f8fb] lg:grid-cols-[1fr_520px]">
      <div className="relative hidden overflow-hidden bg-[#0e253f] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#9cc5f7]">Infinity Solutions · Operations</div>
        <div className="max-w-xl">
          <h1 className="font-condensed text-5xl font-semibold leading-[1.05] tracking-[-0.02em]">Production, people and shift compliance in one workspace.</h1>
          <p className="mt-5 text-[15px] leading-7 text-[#c9d8e8]">Daily reports, error tracking, duty roster, ad-hoc time capture, leave and biometric punch matching for every account.</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[#9cc5f7]"><ShieldCheck className="h-4 w-4" />Sessions are encrypted, time-limited and every change is audited.</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <Brand className="mb-10" />
          <h2 className="font-condensed text-3xl font-semibold text-[#101828]">Sign in</h2>
          <p className="mt-2 text-sm text-[#667085]">Use your employee ID (for example IS/2026/1033) or work email.</p>

          <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
            <Field label="Employee ID or email">
              <input
                className="form-input"
                autoComplete="username"
                autoFocus
                required
                maxLength={160}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </Field>
            <Field label="Password">
              <div className="relative">
                <input
                  className="form-input pr-11"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" className="absolute right-2 top-2 rounded p-1.5 text-[#667085] hover:text-[#344054]" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            {error && <div role="alert" className="rounded-lg border border-[#f0d9d5] bg-[#fffafa] px-3 py-2.5 text-sm text-[#b42318]">{error}</div>}
            <Button type="submit" size="lg" className="w-full" disabled={pending || !identifier || !password}>
              <LockKeyhole className="h-4 w-4" />{pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
          <p className="mt-8 text-xs leading-5 text-[#98a2b3]">Forgot your password? Ask an administrator to reset it. Accounts lock for a short time after repeated failed attempts.</p>
        </div>
      </div>
    </div>
  );
}
