import { ExternalLink, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOURCE_CATEGORY_LABELS, type EvidenceItem } from "@/lib/voiceclaim/types";

const RELATION_STYLE = {
  supports: "text-verdict-supported border-verdict-supported/40",
  contradicts: "text-verdict-contradicted border-verdict-contradicted/40",
  contextual: "text-muted-foreground border-border",
} as const;

const RELATION_LABEL = {
  supports: "Supports",
  contradicts: "Contradicts",
  contextual: "Contextual",
} as const;

export function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <article className="rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-semibold tracking-wide uppercase",
            RELATION_STYLE[item.relation],
          )}
        >
          {RELATION_LABEL[item.relation]}
        </span>
        <span className="text-muted-foreground">{SOURCE_CATEGORY_LABELS[item.category]}</span>
        {item.tier && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {item.tier.replace(/_/g, " ")}
            </span>
          </>
        )}
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">Authority: {item.authority}</span>
        {item.quantityCheck && item.quantityCheck !== "not_applicable" && (
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              item.quantityCheck === "match"
                ? "bg-verdict-supported/10 text-verdict-supported"
                : item.quantityCheck === "within_tolerance"
                  ? "bg-verdict-mostly/10 text-verdict-mostly"
                  : "bg-verdict-contradicted/10 text-verdict-contradicted",
            )}
          >
            Qty: {item.quantityCheck.replace(/_/g, " ")}
          </span>
        )}
        {item.verifier && (
          <span className="text-[10px] text-muted-foreground/80 font-mono">
            E: {Math.round(item.verifier.entail * 100)}% C: {Math.round(item.verifier.contradict * 100)}%
          </span>
        )}
        {!item.independent && (
          <span className="inline-flex items-center gap-1 text-verdict-mixed">
            <Link2Off className="size-3" />
            Not independent
          </span>
        )}
      </div>

      <h4 className="mt-2.5 font-display text-sm leading-snug font-semibold">{item.title}</h4>
      <p className="mt-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
        {item.excerpt}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          {item.domain}
          <ExternalLink className="size-3" />
        </a>
        {item.publishedAt && <span>Published {item.publishedAt}</span>}
        <span>Retrieved {new Date(item.retrievedAt).toLocaleTimeString()}</span>
        {item.upstreamOf && <span>Repeats: {item.upstreamOf}</span>}
      </div>
    </article>
  );
}
