import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} aria-label="Infinity Solutions">
      <svg viewBox="0 0 28 24" className="h-8 w-9 shrink-0 text-[#0064e6]" fill="none" aria-hidden="true">
        <path
          d="M6 19C2.7 19 1 16.3 1 12s1.7-7 5-7c5.2 0 7.8 14 13 14 3.3 0 5-2.7 5-7s-1.7-7-5-7C13.8 5 11.2 19 6 19Z"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          transform="translate(1 0) scale(.93 1)"
        />
      </svg>
      {!compact && (
        <div className="leading-none">
          <div className="text-[22px] font-semibold tracking-[-0.045em] text-[#101828]">infinity</div>
          <div className="mt-1 font-mono text-[9px] font-medium uppercase tracking-[0.25em] text-[#667085]">Solutions</div>
        </div>
      )}
    </div>
  );
}
