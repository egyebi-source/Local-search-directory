import { cn } from "@/lib/utils";

/** Wordmark: a gold gauge with its needle swinging up; "Torque" in ink, "Rank" in rose. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <svg viewBox="0 0 32 32" aria-hidden="true" className="h-7 w-7">
        <rect width="32" height="32" rx="8" className="fill-gold-500" />
        <path d="M7 21a9 9 0 0 1 18 0" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-white" />
        <path d="M16 21l6-7" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-rose-700" />
        <circle cx="16" cy="21" r="2" className="fill-rose-700" />
      </svg>
      <span>
        <span className="text-slate-900">Torque</span><span className="text-rose-600">Rank</span>
      </span>
    </span>
  );
}
