import type { AtomicClaim, ConversationContextSnapshot, ConversationEntity, ConversationTurn, TranscriptSegment } from "../types";

const MAX_TURNS = 8;
const MAX_TOKENS = 600;
const MAX_CLAIMS = 20;
const MAX_ENTITIES = 32;
const STALE_ENTITY_MS = 120_000;

const countTokens = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

/** Deterministic, bounded context that survives transcript chunk flushes. */
export class RollingConversationMemory {
  private turns: ConversationTurn[] = [];
  private entities = new Map<string, ConversationEntity>();
  private claims: Array<Pick<AtomicClaim, "id" | "normalizedClaim" | "sourceSegmentIds">> = [];

  addSegment(segment: TranscriptSegment) {
    if (segment.interim || !segment.text.trim()) return;
    const turn: ConversationTurn = { segmentId: segment.id, text: segment.text.trim(), startMs: segment.startMs, endMs: segment.endMs };
    const index = this.turns.findIndex((item) => item.segmentId === turn.segmentId);
    if (index >= 0) this.turns[index] = turn;
    else this.turns.push(turn);
    this.turns.sort((a, b) => a.startMs - b.startMs);
    this.prune(turn.endMs);
  }

  recordEntities(entities: ConversationEntity[]) {
    for (const entity of entities) {
      const name = entity.name.trim();
      if (!name || !entity.sourceSegmentId) continue;
      const key = name.toLocaleLowerCase("en-US");
      const current = this.entities.get(key);
      if (!current || current.lastMentionedMs <= entity.lastMentionedMs) this.entities.set(key, { ...entity, name });
    }
    this.prune(this.turns.at(-1)?.endMs ?? 0);
  }

  recordClaim(claim: AtomicClaim) {
    this.claims = [...this.claims.filter((item) => item.id !== claim.id), {
      id: claim.id,
      normalizedClaim: claim.normalizedClaim,
      sourceSegmentIds: [...claim.sourceSegmentIds],
    }].slice(-MAX_CLAIMS);
  }

  getSnapshot(): ConversationContextSnapshot {
    const turns = this.turns.slice(-MAX_TURNS);
    const entities = [...this.entities.values()].sort((a, b) => b.lastMentionedMs - a.lastMentionedMs).slice(0, MAX_ENTITIES);
    const claims = this.claims.slice(-MAX_CLAIMS);
    const count = () => [...turns.map((turn) => turn.text), ...entities.map((entity) => entity.name), ...claims.map((claim) => claim.normalizedClaim)].reduce((total, text) => total + countTokens(text), 0);
    while (count() > MAX_TOKENS && turns.length) turns.shift();
    while (count() > MAX_TOKENS && claims.length) claims.shift();
    while (count() > MAX_TOKENS && entities.length) entities.pop();
    return { recentTurns: turns, activeEntities: entities, recentClaims: claims, tokenCount: count() };
  }

  private prune(nowMs: number) {
    this.turns = this.turns.slice(-MAX_TURNS);
    for (const [key, entity] of this.entities) if (nowMs - entity.lastMentionedMs > STALE_ENTITY_MS) this.entities.delete(key);
  }
}
