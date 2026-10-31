import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Fingerprint, Link2, Pencil, Plus, RefreshCw, Router, Search, ShieldCheck, Sparkles, Trash2, Unlink, Upload, XCircle, Zap } from "lucide-react";
import { ConfirmButton, EmptyState, ErrorState, Field, LoadingState, PageHeader, Panel, PanelHeader, StatusBadge } from "@/components/Workspace";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useApiMutation, useEmployees } from "@/hooks/use-data";
import { useDebounced } from "@/hooks/use-debounced";
import { api, ApiError } from "@/lib/api";
import { addDaysKey } from "@shared/roster";
import { errorMessage, formatDateTime, todayInput } from "@/lib/operations";
import type { BiometricDevice, BiometricLog, DeviceSetup, DeviceTestResult, DeviceTotals, ImportResult, MachineUser, SyncResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth";
import { toast } from "sonner";

type DeviceForm = { name: string; ipAddress: string; port: string; commKey: string; location: string; isActive: boolean };
const EMPTY_FORM: DeviceForm = { name: "", ipAddress: "", port: "4370", commKey: "0", location: "", isActive: true };

export default function BiometricDevices() {
  const { isAdmin } = useAuth();
  const devices = useQuery({ queryKey: ["biometric", "devices"], queryFn: () => api.get<{ items: BiometricDevice[]; totals: DeviceTotals }>("/biometric/devices"), refetchInterval: 60_000 });
  const logs = useQuery({ queryKey: ["biometric", "logs"], queryFn: () => api.get<BiometricLog[]>("/biometric/logs", { limit: 50 }), refetchInterval: 60_000 });

  const [editing, setEditing] = useState<BiometricDevice | "new" | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [testResult, setTestResult] = useState<{ name: string; result: DeviceTestResult } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const remove = useApiMutation((id: number) => api.delete(`/biometric/devices/${id}`), { invalidate: ["biometric"], success: "Machine removed (its punches are kept)", errorTitle: "Could not remove machine" });
  const setup = useQuery({ queryKey: ["biometric", "setup"], queryFn: () => api.get<DeviceSetup>("/biometric/setup"), staleTime: 30_000, refetchInterval: 60_000 });
  const sync = useApiMutation((id: number | null) => api.post<SyncResult | { queued: number; mode: "agent" }>(id ? `/biometric/devices/${id}/sync` : "/biometric/sync"), {
    invalidate: ["biometric", "attendance", "employees"],
    errorTitle: "Sync failed",
  });

  async function runSync(device?: BiometricDevice) {
    setBusy(device ? `sync-${device.id}` : "sync-all");
    sync.mutate(device?.id ?? null, {
      onSuccess: (result) => {
        // Agent mode: the office agent picks up the request on its next check-in (within a minute).
        if ("queued" in result) toast.success("Sync requested", { description: `The office agent will read ${result.queued === 1 ? "the machine" : `${result.queued} machines`} within about a minute. Refresh to see the result.` });
        else setSyncResult(result);
      },
      onError: (error) => {
        // A failed sync still returns per-machine details.
        if (error instanceof ApiError && error.details && typeof error.details === "object" && "devices" in error.details) setSyncResult(error.details as SyncResult);
      },
      onSettled: () => setBusy(null),
    });
  }

  async function runTest(device: BiometricDevice) {
    setBusy(`test-${device.id}`);
    try {
      const result = await api.post<DeviceTestResult>(`/biometric/devices/${device.id}/test`);
      setTestResult({ name: device.name, result });
    } catch (error) {
      toast.error(`Could not connect to ${device.name}`, { description: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    if (fileRef.current) fileRef.current.value = "";
    if (file.size > 8 * 1024 * 1024) return void toast.error("File is larger than 8 MB");
    setBusy("import");
    try {
      const result = await api.post<ImportResult>("/biometric/import", { fileName: file.name, content: await file.text() });
      setImportResult(result);
      void devices.refetch();
      void logs.refetch();
    } catch (error) {
      toast.error("Import failed", { description: errorMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  const items = devices.data?.items ?? [];
  const totals = devices.data?.totals;
  const active = items.filter((d) => d.isActive);
  const failing = active.filter((d) => d.lastSyncStatus === "FAILED");
  const serverIp = setup.data?.serverAddresses[0];
  const agentMode = setup.data?.mode === "agent";
  const agent = setup.data?.agents[0];

  return (
    <div>
      <PageHeader
        eyebrow="Time & attendance"
        title="Biometric devices"
        description="eSSL / ZKTeco fingerprint machines are read over the office network (port 4370), the same way as the HRMS portal. Nothing on the machine is changed or deleted."
        actions={<>
          <input ref={fileRef} type="file" accept=".dat,.txt,.csv,.log" className="hidden" onChange={(e) => importFile(e.target.files?.[0])} />
          <Button variant="outline" disabled={busy === "import"} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" />{busy === "import" ? "Loading…" : "Load USB file"}</Button>
          <Button disabled={!active.length || Boolean(busy)} onClick={() => runSync()}><RefreshCw className={cn("h-4 w-4", busy === "sync-all" && "animate-spin")} />{busy === "sync-all" ? "Syncing…" : "Sync all machines"}</Button>
        </>}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active machines" value={active.length} note={failing.length ? `${failing.length} failed last sync` : "All synced OK"} tone={failing.length ? "bad" : "good"} />
        <Stat label="Punches today" value={totals?.punchesToday ?? 0} note={`${totals?.punches ?? 0} stored in total`} tone="neutral" />
        <Stat label="Machine users" value={totals?.users ?? 0} note={totals?.unlinkedUsers ? `${totals.unlinkedUsers} not linked to an employee` : "All linked"} tone={totals?.unlinkedUsers ? "warn" : "good"} />
        {agentMode ? (
          <Stat
            label="Office agent"
            value={agent ? (agent.online ? "Online" : "Offline") : "Not set up"}
            note={agent ? `${agent.name} · last contact ${formatDateTime(agent.lastSeenAt)}${agent.lastError ? ` · ${agent.lastError}` : ""}` : "Install the agent on an office PC (see How to connect)"}
            tone={agent?.online ? "good" : "bad"}
          />
        ) : (
          <Stat label="Automatic sync" value={setup.data?.autoSyncMinutes ? `${setup.data.autoSyncMinutes} min` : "Off"} note={setup.data?.autoSyncMinutes ? "New punches are pulled in the background" : "Click Sync to pull punches"} tone="neutral" />
        )}
      </div>

      <Panel className="mb-5">
        <PanelHeader
          title="Machines"
          description="Add each machine once with its IP address. Sync pulls new punches and updates attendance."
          action={isAdmin ? <Button size="sm" onClick={() => setEditing("new")}><Plus className="h-3.5 w-3.5" />Add machine</Button> : undefined}
        />
        {devices.isLoading ? <LoadingState /> : devices.error ? <ErrorState message={devices.error.message} retry={() => devices.refetch()} /> : items.length ? (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1040px]">
              <thead><tr><th>Machine</th><th>Address</th><th>Last sync</th><th>On the machine</th><th className="text-right">Today</th><th className="text-right">Actions</th></tr></thead>
              <tbody>{items.map((device) => (
                <tr key={device.id} className={device.isActive ? undefined : "opacity-60"}>
                  <td>
                    <div className="flex items-center gap-2 font-medium text-[#1d2939]"><Router className="h-4 w-4 text-[#98a2b3]" />{device.name}{!device.isActive && <StatusBadge status="Inactive" />}</div>
                    {device.location && <div className="mt-0.5 text-[11px] text-[#98a2b3]">{device.location}</div>}
                  </td>
                  <td className="font-mono text-xs">{device.ipAddress}:{device.port}</td>
                  <td className="max-w-72">
                    {device.lastSyncAt ? (
                      <>
                        <span className={cn("inline-flex items-center gap-1 text-xs font-medium", device.lastSyncStatus === "OK" ? "text-[#157347]" : "text-[#b42318]")}>
                          {device.lastSyncStatus === "OK" ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{formatDateTime(device.lastSyncAt)}
                        </span>
                        {device.lastSyncNote && <div className="mt-0.5 text-[11px] leading-4 text-[#667085]">{device.lastSyncNote}</div>}
                      </>
                    ) : <span className="text-xs text-[#98a2b3]">Never synced</span>}
                  </td>
                  <td className="text-xs">
                    {device.userCount !== null ? (
                      <>
                        <div>{device.userCount} users · {device.logCount} punches</div>
                        {device.logCapacity ? (
                          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-[#f0f3f7]" title={`${device.logCount} of ${device.logCapacity} log slots used`}>
                            <div className={cn("h-full", (device.logCount ?? 0) / device.logCapacity > 0.85 ? "bg-[#d92d20]" : "bg-[#0064e6]")} style={{ width: `${Math.min(100, ((device.logCount ?? 0) / device.logCapacity) * 100)}%` }} />
                          </div>
                        ) : null}
                      </>
                    ) : <span className="text-[#98a2b3]">—</span>}
                  </td>
                  <td className="text-right font-mono">{device.punchesToday}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <Button size="sm" disabled={!device.isActive || Boolean(busy)} onClick={() => runSync(device)}><RefreshCw className={cn("h-3.5 w-3.5", busy === `sync-${device.id}` && "animate-spin")} />{busy === `sync-${device.id}` ? "Syncing…" : "Sync"}</Button>
                      {!agentMode && <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => runTest(device)}><Zap className="h-3.5 w-3.5" />{busy === `test-${device.id}` ? "Testing…" : "Test"}</Button>}
                      {isAdmin && <Button size="icon" variant="ghost" aria-label="Edit machine" onClick={() => setEditing(device)}><Pencil className="h-4 w-4" /></Button>}
                      {isAdmin && (
                        <ConfirmButton title={`Remove ${device.name}?`} description="The machine is removed from this app. Punches already pulled from it are kept. Nothing on the machine itself is changed." confirmLabel="Remove" onConfirm={() => remove.mutate(device.id)}>
                          <Button size="icon" variant="ghost" aria-label="Remove machine" className="text-[#b42318] hover:text-[#b42318]"><Trash2 className="h-4 w-4" /></Button>
                        </ConfirmButton>
                      )}
                    </div>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No machines added yet" description={isAdmin ? "Click Add machine and enter the machine's IP address. Follow the steps below." : "Ask an administrator to add the fingerprint machine."} />}
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <MachineUsers canLink={isAdmin} />
        <aside className="space-y-5">
          <Panel>
            <PanelHeader title="How to connect" description={agentMode ? "This app is online, so an office PC reads the machine and sends punches here" : "One-time setup, about 5 minutes"} />
            {agentMode ? (
              <ol className="space-y-4 p-5 text-sm leading-6 text-[#475467]">
                <Step n={1} title="Machine on the office network">On the machine: <b>Menu → Comm. → Ethernet</b> — give it a fixed IP. <b>Comm Key = 0</b> (Menu → Comm. → Security).</Step>
                <Step n={2} title="Add it here">Click <b>Add machine</b> with that IP and port <b>4370</b>.</Step>
                <Step n={3} title="Install the office agent">On one office PC that stays on (same network as the machine): install Node.js 20+, copy <span className="font-mono">infinity-agent.mjs</span> and create <span className="font-mono">agent.env</span> with this site's address and the agent key. Run <span className="font-mono">node infinity-agent.mjs</span>.</Step>
                <Step n={4} title="Check it">The agent shows as <b>online</b> above within a minute and syncs every {setup.data?.autoSyncMinutes ?? 15} minutes. Click <b>Sync</b> to ask it to sync now.</Step>
                <Step n={5} title="Link staff">Machine users are linked automatically when the ID matches (e.g. 1033 ↔ IS/2026/1033); link the rest under Machine users.</Step>
              </ol>
            ) : (
            <ol className="space-y-4 p-5 text-sm leading-6 text-[#475467]">
              <Step n={1} title="Same network">Connect the machine to the office LAN or Wi-Fi — the same network as this computer{serverIp ? <> (<span className="font-mono">{serverIp}</span>)</> : null}.</Step>
              <Step n={2} title="Note the machine's IP">On the machine: <b>Menu → Comm. → Ethernet</b> (or Wireless Network). Turn DHCP off and give it a fixed IP so it never changes.</Step>
              <Step n={3} title="Comm Key = 0">On the machine: <b>Menu → Comm. → Security / Comm Key</b> → <b>0</b>.</Step>
              <Step n={4} title="Add and test">Click <b>Add machine</b>, enter the IP and port <b>4370</b>, then <b>Test connection</b>. You should see its user and punch counts.</Step>
              <Step n={5} title="Sync and link">Click <b>Sync</b>. Machine users are linked to employees automatically when the ID matches (e.g. 1033 ↔ IS/2026/1033); link the rest by hand. First punch of a day = IN, last = OUT.</Step>
            </ol>
            )}
            <div className="flex items-start gap-2 border-t border-[#edf0f4] px-5 py-3 text-xs text-[#667085]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#157347]" />Read-only: the app never clears or edits the machine. Machines can only be added with an office-network IP ({setup.data?.allowList ?? "private LAN"}).</div>
          </Panel>
          <Reprocess />
        </aside>
      </div>

      <Panel>
        <PanelHeader title="Latest punches" description="Most recent 50 punches pulled from machines or USB files" />
        {logs.isLoading ? <LoadingState /> : logs.data?.length ? (
          <div className="max-h-[440px] overflow-auto">
            <table className="data-table min-w-[640px]">
              <thead className="sticky top-0"><tr><th>Time</th><th>Person</th><th>Machine ID</th><th>From</th></tr></thead>
              <tbody>{logs.data.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap font-mono text-xs">{formatDateTime(log.punchTime)}</td>
                  <td>{log.employeeName ? <span className="font-medium text-[#1d2939]">{log.employeeName}</span> : <span className="font-medium text-[#b54708]">Not linked{log.machineUserName ? ` (“${log.machineUserName}”)` : ""}</span>}</td>
                  <td className="font-mono text-xs">{log.pin}</td>
                  <td className="text-xs">{log.deviceName}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyState title="No punches yet" description="Sync a machine or load a USB log file." />}
      </Panel>

      {editing && <DeviceDialog device={editing === "new" ? null : editing} agentMode={agentMode} onClose={() => setEditing(null)} />}
      <SyncResultDialog result={syncResult} onClose={() => setSyncResult(null)} />
      <ImportResultDialog result={importResult} onClose={() => setImportResult(null)} />
      <Dialog open={Boolean(testResult)} onOpenChange={(open) => !open && setTestResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Connected to {testResult?.name}</DialogTitle><DialogDescription>The machine answered on the network.</DialogDescription></DialogHeader>
          {testResult && <TestInfo result={testResult.result} />}
          <div className="flex justify-end"><Button onClick={() => setTestResult(null)}>Done</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number | string; note: string; tone: "good" | "bad" | "warn" | "neutral" }) {
  const color = { good: "text-[#157347]", bad: "text-[#b42318]", warn: "text-[#946200]", neutral: "text-[#101828]" }[tone];
  return (
    <div className="rounded-xl border border-[#e4e9f0] bg-white p-4">
      <div className="text-xs font-medium text-[#667085]">{label}</div>
      <div className={cn("mt-2 font-mono text-2xl font-medium", color)}>{value}</div>
      <div className="mt-1 text-[11px] leading-4 text-[#98a2b3]">{note}</div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#edf5ff] font-mono text-xs font-semibold text-[#0053bf]">{n}</span>
      <div><div className="font-medium text-[#1d2939]">{title}</div><div className="mt-0.5">{children}</div></div>
    </li>
  );
}

function TestInfo({ result }: { result: DeviceTestResult }) {
  const drift = result.clockDriftMinutes;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Users", result.info.userCount], ["Punches", result.info.logCount], ["Capacity", result.info.logCapacity || "—"]].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[#f8fafc] p-3"><div className="font-mono text-xl font-medium text-[#101828]">{value}</div><div className="text-[11px] text-[#667085]">{label}</div></div>
        ))}
      </div>
      {result.info.deviceTime && (
        <div className={cn("rounded-lg p-3 text-xs", drift !== null && Math.abs(drift) > 5 ? "bg-[#fff5df] text-[#7a4f00]" : "bg-[#ecf8f1] text-[#157347]")}>
          Machine clock: <span className="font-mono">{result.info.deviceTime}</span>
          {drift !== null && Math.abs(drift) > 5 ? <> — <b>{Math.abs(drift)} min {drift > 0 ? "ahead" : "behind"}</b>. Correct the time on the machine, or late/early will be wrong.</> : " — matches this computer."}
        </div>
      )}
    </div>
  );
}

function DeviceDialog({ device, agentMode, onClose }: { device: BiometricDevice | null; agentMode: boolean; onClose: () => void }) {
  const [form, setForm] = useState<DeviceForm>(
    device ? { name: device.name, ipAddress: device.ipAddress, port: String(device.port), commKey: String(device.commKey), location: device.location ?? "", isActive: device.isActive } : EMPTY_FORM,
  );
  const [test, setTest] = useState<DeviceTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const body = { name: form.name.trim(), ipAddress: form.ipAddress.trim(), port: Number(form.port) || 4370, commKey: Number(form.commKey) || 0, location: form.location.trim() || null, isActive: form.isActive };
  const save = useApiMutation(() => (device ? api.put(`/biometric/devices/${device.id}`, body) : api.post("/biometric/devices", body)), {
    invalidate: ["biometric"],
    success: device ? "Machine updated" : "Machine added — click Sync to pull its punches",
    errorTitle: "Could not save machine",
  });

  async function testConnection() {
    setTesting(true);
    setTest(null);
    try {
      setTest(await api.post<DeviceTestResult>("/biometric/devices/test", { ipAddress: body.ipAddress, port: body.port }));
    } catch (error) {
      toast.error("Could not connect", { description: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>{device ? "Edit machine" : "Add fingerprint machine"}</DialogTitle><DialogDescription>eSSL / ZKTeco machine on the office network. Port 4370, Comm Key 0.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate(undefined, { onSuccess: onClose }); }}>
          <Field label="Name"><input required minLength={2} maxLength={80} className="form-input" placeholder="e.g. Main entrance" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label="IP address" hint="Menu → Comm. → Ethernet on the machine"><input required inputMode="decimal" pattern="\d{1,3}(\.\d{1,3}){3}" className="form-input font-mono" placeholder="192.168.1.201" value={form.ipAddress} onChange={(e) => { setForm({ ...form, ipAddress: e.target.value }); setTest(null); }} /></Field>
            <Field label="Port" hint="Default 4370"><input required type="number" min={1} max={65535} className="form-input font-mono" value={form.port} onChange={(e) => { setForm({ ...form, port: e.target.value }); setTest(null); }} /></Field>
          </div>
          <div className="grid grid-cols-[110px_1fr] gap-3">
            <Field label="Comm Key" hint="Keep 0"><input type="number" min={0} max={999999} className="form-input font-mono" value={form.commKey} onChange={(e) => setForm({ ...form, commKey: e.target.value })} /></Field>
            <Field label="Location (optional)"><input maxLength={120} className="form-input" placeholder="Ground floor reception" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
          </div>
          {Number(form.commKey) > 0 && <p className="flex items-start gap-1.5 text-xs text-[#946200]"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />The connection library cannot use a Comm Key. Set it to 0 on the machine (Menu → Comm. → Security), as with HRMS.</p>}
          <label className="flex items-center gap-2 text-sm text-[#475467]"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Active (included in “Sync all” and automatic sync)</label>
          {test && <TestInfo result={test} />}
          <div className="flex flex-wrap justify-between gap-2 border-t border-[#edf0f4] pt-4">
            {agentMode ? <span className="self-center text-xs text-[#667085]">The office agent connects after you save.</span> : <Button type="button" variant="outline" disabled={testing || !form.ipAddress.trim()} onClick={testConnection}><Zap className="h-4 w-4" />{testing ? "Testing…" : "Test connection"}</Button>}
            <div className="flex gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" disabled={save.isPending}>{device ? "Save" : "Add machine"}</Button></div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MachineUsers({ canLink }: { canLink: boolean }) {
  const [filter, setFilter] = useState<"all" | "unlinked" | "linked">("unlinked");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, 300);
  const users = useQuery({ queryKey: ["biometric", "users", filter, q], queryFn: () => api.get<MachineUser[]>("/biometric/users", { filter, q }) });
  const employees = useEmployees();
  const [choice, setChoice] = useState<Record<string, number>>({});
  const link = useApiMutation((input: { pin: string; employeeId: number | null }) => api.put<{ converted?: number }>(`/biometric/users/${encodeURIComponent(input.pin)}/link`, { employeeId: input.employeeId }), {
    invalidate: ["biometric", "attendance", "employees"],
    success: (r, input) => (input.employeeId ? `Linked — ${r?.converted ?? 0} punch${r?.converted === 1 ? "" : "es"} added to attendance` : "Unlinked — those punches were removed from attendance"),
    errorTitle: "Could not update link",
  });
  const autoLink = useApiMutation(() => api.post<{ linked: unknown[] }>("/biometric/users/auto-link"), {
    invalidate: ["biometric", "attendance", "employees"],
    success: (r) => (r.linked.length ? `Linked ${r.linked.length} machine user${r.linked.length === 1 ? "" : "s"} automatically` : "No new automatic matches found"),
    errorTitle: "Auto-link failed",
  });
  const available = (employees.data ?? []).filter((e) => !e.biometricId);

  return (
    <Panel>
      <PanelHeader
        title="Machine users"
        description="People enrolled on the machines. Each machine user ID must be linked to one employee."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#d7dee8] p-0.5">
              {(["unlinked", "linked", "all"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={cn("h-8 rounded-md px-3 text-xs font-medium capitalize", filter === f ? "bg-[#edf5ff] text-[#0053bf]" : "text-[#667085]")}>{f}</button>
              ))}
            </div>
            <div className="relative"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[#98a2b3]" /><input className="form-input h-9 w-40 pl-8 text-xs" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            {canLink && <Button size="sm" variant="outline" disabled={autoLink.isPending} onClick={() => autoLink.mutate(undefined)}><Sparkles className="h-3.5 w-3.5" />Auto-link</Button>}
          </div>
        }
      />
      {users.isLoading ? <LoadingState /> : users.data?.length ? (
        <div className="max-h-[520px] overflow-auto">
          <table className="data-table min-w-[760px]">
            <thead className="sticky top-0"><tr><th>Machine ID</th><th>Name on machine</th><th className="text-right">Punches</th><th>Employee</th></tr></thead>
            <tbody>{users.data.map((user) => (
              <tr key={user.pin}>
                <td><span className="flex items-center gap-1.5 font-mono text-sm font-semibold text-[#1d2939]"><Fingerprint className="h-3.5 w-3.5 text-[#98a2b3]" />{user.pin}</span>{user.cardNo && <div className="font-mono text-[10px] text-[#98a2b3]">card {user.cardNo}</div>}</td>
                <td className="text-xs">{user.machineName ?? "—"}{user.deviceName && <div className="text-[10px] text-[#98a2b3]">{user.deviceName}</div>}</td>
                <td className="text-right font-mono text-xs">{user.punches}<div className="text-[10px] text-[#98a2b3]">{user.lastPunchAt ? formatDateTime(user.lastPunchAt) : ""}</div></td>
                <td>
                  {user.employeeId ? (
                    <div className="flex items-center justify-between gap-2">
                      <div><div className="font-medium text-[#1d2939]">{user.employeeName}</div><div className="font-mono text-[10px]">{user.employeeCode}</div></div>
                      {canLink && (
                        <ConfirmButton title={`Unlink machine ID ${user.pin}?`} description={`${user.employeeName}'s punches from this ID will be taken out of attendance until it is linked again.`} confirmLabel="Unlink" onConfirm={() => link.mutate({ pin: user.pin, employeeId: null })}>
                          <Button size="icon" variant="ghost" aria-label="Unlink" title="Unlink"><Unlink className="h-4 w-4" /></Button>
                        </ConfirmButton>
                      )}
                    </div>
                  ) : canLink ? (
                    <div className="flex gap-2">
                      <select aria-label={`Employee for machine ID ${user.pin}`} className="form-input h-9 w-52 text-xs" value={choice[user.pin] ?? 0} onChange={(e) => setChoice({ ...choice, [user.pin]: Number(e.target.value) })}>
                        <option value={0} disabled>Choose employee</option>
                        {available.map((e) => <option key={e.id} value={e.id}>{e.name} · {e.employeeCode}</option>)}
                      </select>
                      <Button size="sm" disabled={!choice[user.pin] || link.isPending} onClick={() => link.mutate({ pin: user.pin, employeeId: choice[user.pin] })}><Link2 className="h-3.5 w-3.5" />Link</Button>
                    </div>
                  ) : <span className="text-xs text-[#b54708]">Not linked</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <EmptyState title={filter === "unlinked" ? "Everyone is linked" : "No machine users yet"} description="Sync a machine or load a USB log file; the people enrolled on it appear here." />}
    </Panel>
  );
}

function Reprocess() {
  const today = todayInput();
  const [from, setFrom] = useState(addDaysKey(today, -6));
  const [to, setTo] = useState(today);
  const run = useApiMutation(() => api.post<{ days: number; records: number }>("/biometric/reprocess", { from, to }), {
    invalidate: ["attendance"],
    success: (r) => `Attendance recalculated for ${r.days} day${r.days === 1 ? "" : "s"}`,
    errorTitle: "Could not re-process",
  });
  return (
    <Panel>
      <PanelHeader title="Re-process attendance" description="After linking users or changing the roster, recalculate a period from the stored punches." />
      <div className="space-y-3 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" className="form-input" max={to} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="form-input" min={from} max={today} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Button variant="outline" className="w-full" disabled={run.isPending || !from || !to} onClick={() => run.mutate(undefined)}><RefreshCw className="h-4 w-4" />{run.isPending ? "Re-processing…" : "Re-process"}</Button>
      </div>
    </Panel>
  );
}

function SyncResultDialog({ result, onClose }: { result: SyncResult | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Sync finished</DialogTitle><DialogDescription>{result ? `${result.converted} punch${result.converted === 1 ? "" : "es"} added to attendance · ${result.days} day${result.days === 1 ? "" : "s"} recalculated` : ""}</DialogDescription></DialogHeader>
        {result && (
          <div className="space-y-3 text-sm">
            {result.devices.map((d) => (
              <div key={d.deviceId} className={cn("rounded-lg border p-3", d.ok ? "border-[#cfe9da] bg-[#f5fbf7]" : "border-[#f0d9d5] bg-[#fffafa]")}>
                <div className="flex items-center gap-2 font-medium">{d.ok ? <CheckCircle2 className="h-4 w-4 text-[#157347]" /> : <XCircle className="h-4 w-4 text-[#b42318]" />}{d.name}</div>
                <div className="mt-1 text-xs text-[#475467]">
                  {d.ok ? `${d.newPunches} new of ${d.punchesOnDevice} punches on the machine · ${d.users} users · ${d.seconds}s` : d.error}
                  {d.ok && d.clockDriftMinutes !== null && d.clockDriftMinutes !== undefined && Math.abs(d.clockDriftMinutes) > 5 && <div className="mt-1 text-[#946200]">Machine clock is {Math.abs(d.clockDriftMinutes)} min {d.clockDriftMinutes > 0 ? "ahead" : "behind"} — correct it on the machine.</div>}
                </div>
              </div>
            ))}
            {result.autoLinked.length > 0 && <div className="rounded-lg bg-[#eef4ff] p-3 text-xs text-[#175cd3]"><b>Linked automatically:</b> {result.autoLinked.map((l) => `${l.pin} → ${l.employeeName}`).join(", ")}</div>}
            {result.unlinkedUsers > 0 && <div className="rounded-lg bg-[#fff5df] p-3 text-xs text-[#7a4f00]">{result.unlinkedUsers} machine user{result.unlinkedUsers === 1 ? " is" : "s are"} not linked to an employee. Link them under Machine users so their punches count.</div>}
          </div>
        )}
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function ImportResultDialog({ result, onClose }: { result: ImportResult | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(result)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>USB file loaded</DialogTitle><DialogDescription>{result?.format}</DialogDescription></DialogHeader>
        {result && (
          <ul className="space-y-1.5 text-sm text-[#475467]">
            <li><b>{result.read}</b> punches read{result.unreadableLines ? `, ${result.unreadableLines} lines could not be read` : ""}</li>
            <li><b>{result.newPunches}</b> new · {result.duplicates} already stored</li>
            <li><b>{result.converted}</b> added to attendance · {result.days} days recalculated</li>
            {result.autoLinked.length > 0 && <li>Linked automatically: {result.autoLinked.map((l) => `${l.pin} → ${l.employeeName}`).join(", ")}</li>}
          </ul>
        )}
        <div className="flex justify-end"><Button onClick={onClose}>Done</Button></div>
      </DialogContent>
    </Dialog>
  );
}
