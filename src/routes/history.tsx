import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClaimCard } from "@/components/voiceclaim/claim-card";
import { ClaimDetailPanel } from "@/components/voiceclaim/claim-detail";
import { localHistory } from "@/lib/voiceclaim/history";
import { MODE_LABELS, formatTimestamp, type Session } from "@/lib/voiceclaim/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Session history — Fact Lens" },
      {
        name: "description",
        content:
          "Revisit past verification sessions, their claims and evidence. Stored only on this device.",
      },
      { property: "og:title", content: "Session history — Fact Lens" },
      {
        property: "og:description",
        content: "Locally stored verification sessions, claims and evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HistoryPage,
});

function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);

  useEffect(() => {
    void localHistory.list().then(setSessions);
  }, []);

  const refresh = () => void localHistory.list().then(setSessions);
  const selected = sessions.find((s) => s.id === selectedId) ?? sessions[0];
  const openClaim = selected?.claims.find((c) => c.id === openClaimId);

  return (
    <main className="mx-auto w-full max-w-[1400px] flex-1 px-5 py-12 sm:px-8 sm:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            Local archive
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">Session history</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Stored in this browser only. No account, no cloud copy.
          </p>
        </div>
        {sessions.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void localHistory.clear().then(refresh);
            }}
          >
            <Trash2 className="size-3.5" /> Clear all
          </Button>
        )}
      </div>

      {sessions.length === 0 ? (
        <p className="mt-16 text-center text-sm text-muted-foreground">
          No saved sessions yet. Finish a session and it will appear here.
        </p>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-2">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="editorial-card rounded-xl p-4 transition-all hover:-translate-y-px hover:border-foreground/20 hover:shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className="w-full cursor-pointer text-left"
                >
                  <p className="font-display text-sm font-semibold">{session.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(session.startedAt).toLocaleString()} ·{" "}
                    {MODE_LABELS[session.settings.mode]} · {formatTimestamp(session.durationMs)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {session.claims.length} claims
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void localHistory.remove(session.id).then(refresh);
                  }}
                  className="mt-2 cursor-pointer text-[11px] text-muted-foreground hover:text-destructive"
                >
                  Delete
                </button>
              </div>
            ))}
          </aside>

          <section className="space-y-3">
            {selected?.claims.map((claim) => (
              <ClaimCard key={claim.id} claim={claim} onOpen={() => setOpenClaimId(claim.id)} />
            ))}
          </section>
        </div>
      )}

      <ClaimDetailPanel
        claim={openClaim}
        open={Boolean(openClaim)}
        onOpenChange={(open) => {
          if (!open) setOpenClaimId(null);
        }}
      />
    </main>
  );
}
