import { cn } from "@/lib/utils";
import { isTerminal, type ClaimState } from "@/lib/voiceclaim/types";

const STAGES: { state: ClaimState; label: string }[] = [
  { state: "DETECTED", label: "Detected" },
  { state: "QUEUED", label: "Queued" },
  { state: "RESEARCHING", label: "Evidence" },
  { state: "CHALLENGING", label: "Challenge" },
  { state: "SYNTHESIZING", label: "Verdict" },
];

export function StageRail({ state }: { state: ClaimState }) {
  const done = isTerminal(state);
  const activeIndex = done ? STAGES.length : STAGES.findIndex((stage) => stage.state === state);
  const failed = state === "VERIFICATION_ERROR";

  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((stage, index) => {
        const reached = index <= activeIndex;
        const current = index === activeIndex && !done;
        return (
          <div key={stage.state} className="flex flex-1 flex-col gap-1.5">
            <div
              className={cn(
                "h-[3px] rounded-full transition-colors",
                failed && reached ? "bg-verdict-error" : reached ? "bg-live" : "bg-muted",
                current && "animate-pulse",
              )}
            />
            <span
              className={cn(
                "text-[10px] tracking-wide uppercase",
                current ? "text-foreground" : "text-muted-foreground/70",
              )}
            >
              {stage.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
