import { cn } from "@/lib/utils";
import type { EvidenceConfidence, QualitativeLevel } from "@/lib/voiceclaim/types";

const LEVEL_LABEL: Record<QualitativeLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const LEVEL_WIDTH: Record<QualitativeLevel, string> = {
  low: "w-1/4",
  medium: "w-2/3",
  high: "w-full",
};

function Dimension({
  label,
  level,
  invert,
}: {
  label: string;
  level: QualitativeLevel;
  invert?: boolean;
}) {
  const good = invert ? level === "low" : level === "high";
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="font-display text-xs font-semibold">{LEVEL_LABEL[level]}</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            LEVEL_WIDTH[level],
            good ? "bg-verdict-supported" : "bg-muted-foreground",
          )}
        />
      </div>
    </div>
  );
}

export function ConfidenceMeter({
  confidence,
  compact,
}: {
  confidence: EvidenceConfidence;
  compact?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
            Evidence Confidence
          </div>
          {!compact && (
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              Confidence in this verdict given the evidence retrieved — not a probability that the
              claim is true.
            </p>
          )}
        </div>
        <div className="tabular font-display text-3xl leading-none font-semibold">
          {confidence.score}
          <span className="text-base text-muted-foreground">%</span>
        </div>
      </div>
      <div className={cn("grid gap-3", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
        <Dimension label="Evidence strength" level={confidence.evidenceStrength} />
        <Dimension label="Contradiction" level={confidence.contradiction} invert />
        <Dimension label="Freshness" level={confidence.freshness} />
      </div>
    </div>
  );
}
