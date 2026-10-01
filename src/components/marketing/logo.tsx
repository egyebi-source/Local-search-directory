import { cn } from "@/lib/utils";

/** Wordmark: a gauge needle swinging into the red — "torque" + "rank". */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
        <rect width="32" height="32" rx="8" className="fill-amber-500" />
        <path d="M7 21a9 9 0 0 1 18 0" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-slate-950" />
        <path d="M16 21l6-7" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-slate-950" />
        <circle cx="16" cy="21" r="2" className="fill-slate-950" />
      </svg>
      <span>
        Torque<span className="text-amber-500">Rank</span>
      </span>
    </span>
  );
}
