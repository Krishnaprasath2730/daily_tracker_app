import type { ReactNode } from "react";
import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-5 md:flex-row md:items-end">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#0064e6]">{eyebrow}</div>}
        <h1 className="font-condensed text-[34px] font-semibold leading-[1.05] tracking-[-0.025em] text-[#101828] md:text-[42px]">{title}</h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-6 text-[#667085]">{description}</p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl border border-[#e4e9f0] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.025)]", className)}>{children}</section>;
}

export function PanelHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-[68px] flex-col justify-between gap-3 border-b border-[#edf0f4] px-5 py-4 sm:flex-row sm:items-center">
      <div>
        <h2 className="text-[15px] font-semibold text-[#1d2939]">{title}</h2>
        {description && <p className="mt-1 text-xs leading-5 text-[#667085]">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style =
    {
      Approved: "bg-[#ecf8f1] text-[#157347]",
      Matched: "bg-[#ecf8f1] text-[#157347]",
      Resolved: "bg-[#ecf8f1] text-[#157347]",
      Pending: "bg-[#fff5df] text-[#946200]",
      Review: "bg-[#fff5df] text-[#946200]",
      "In review": "bg-[#fff5df] text-[#946200]",
      Open: "bg-[#fff0ee] text-[#b42318]",
      Rejected: "bg-[#fff0ee] text-[#b42318]",
      Missing: "bg-[#fff0ee] text-[#b42318]",
      Critical: "bg-[#fff0ee] text-[#b42318]",
      High: "bg-[#fff0ee] text-[#b42318]",
      Medium: "bg-[#fff5df] text-[#946200]",
      Low: "bg-[#eef4ff] text-[#175cd3]",
      Active: "bg-[#ecf8f1] text-[#157347]",
      Inactive: "bg-[#f2f4f7] text-[#475467]",
      Locked: "bg-[#fff0ee] text-[#b42318]",
      Cancelled: "bg-[#f2f4f7] text-[#475467]",
      Declined: "bg-[#fff0ee] text-[#b42318]",
      "Awaiting manager": "bg-[#eef4ff] text-[#175cd3]",
      Published: "bg-[#ecf8f1] text-[#157347]",
      Draft: "bg-[#fff5df] text-[#946200]",
      Absent: "bg-[#fff0ee] text-[#b42318]",
      "On duty": "bg-[#eef4ff] text-[#175cd3]",
      Disabled: "bg-[#f2f4f7] text-[#475467]",
      Queued: "bg-[#fff5df] text-[#946200]",
      Sent: "bg-[#eef4ff] text-[#175cd3]",
      Done: "bg-[#ecf8f1] text-[#157347]",
      Failed: "bg-[#fff0ee] text-[#b42318]",
    }[status] ?? "bg-[#f2f4f7] text-[#475467]";
  return <span className={cn("inline-flex whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.06em]", style)}>{status}</span>;
}

export function LoadingState({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="flex min-h-64 items-center justify-center gap-3 text-sm text-[#667085]" role="status">
      <LoaderCircle className="h-5 w-5 animate-spin text-[#0064e6]" /> {label}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-[#f0d9d5] bg-[#fffafa] p-8 text-center">
      <AlertCircle className="h-6 w-6 text-[#b42318]" />
      <p className="text-sm font-medium text-[#7a271a]">{message}</p>
      {retry && <Button variant="outline" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-48 flex-col items-center justify-center p-8 text-center">
      <Inbox className="mb-3 h-6 w-6 text-[#98a2b3]" />
      <p className="text-sm font-semibold text-[#344054]">{title}</p>
      <p className="mt-1 max-w-sm text-sm leading-6 text-[#667085]">{description}</p>
    </div>
  );
}

/** Wraps a trigger button with a confirmation dialog for destructive actions. */
export function ConfirmButton({
  children,
  title,
  description,
  confirmLabel = "Confirm",
  onConfirm,
}: {
  children: ReactNode;
  title: string;
  description: string;
  confirmLabel?: string;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-[#b42318] hover:bg-[#912018]">{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-[#344054]">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-5 text-[#667085]">{hint}</span>}
    </label>
  );
}
