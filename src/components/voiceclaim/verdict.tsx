import { cn } from "@/lib/utils";
import { VERDICT_LABELS, type ClaimState, type Verdict } from "@/lib/voiceclaim/types";

const VERDICT_STYLES: Record<Verdict, string> = {
  supported: "text-verdict-supported border-verdict-supported/40 bg-verdict-supported/10",
  mostly_supported: "text-verdict-mostly border-verdict-mostly/40 bg-verdict-mostly/10",
  mixed: "text-verdict-mixed border-verdict-mixed/40 bg-verdict-mixed/10",
  misleading: "text-verdict-misleading border-verdict-misleading/40 bg-verdict-misleading/10",
  contradicted:
    "text-verdict-contradicted border-verdict-contradicted/40 bg-verdict-contradicted/10",
  insufficient_evidence:
    "text-verdict-insufficient border-verdict-insufficient/40 bg-verdict-insufficient/10",
};

export function verdictAccent(verdict?: Verdict, state?: ClaimState) {
  if (state === "VERIFICATION_ERROR") return "bg-verdict-error";
  if (!verdict) return "bg-live";
  return {
    supported: "bg-verdict-supported",
    mostly_supported: "bg-verdict-mostly",
    mixed: "bg-verdict-mixed",
    misleading: "bg-verdict-misleading",
    contradicted: "bg-verdict-contradicted",
    insufficient_evidence: "bg-verdict-insufficient",
  }[verdict];
}

export function VerdictBadge({
  verdict,
  state,
  className,
}: {
  verdict?: Verdict | undefined;
  state?: ClaimState | undefined;
  className?: string | undefined;
}) {
  if (state === "VERIFICATION_ERROR") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-1 font-display text-[11px] font-semibold tracking-[0.14em] uppercase",
          "text-verdict-error border-verdict-error/40 bg-verdict-error/10",
          className,
        )}
      >
        Verification Error
      </span>
    );
  }
  if (!verdict) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 font-display text-[11px] font-semibold tracking-[0.14em] uppercase",
        VERDICT_STYLES[verdict],
        className,
      )}
    >
      {VERDICT_LABELS[verdict]}
    </span>
  );
}
