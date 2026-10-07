import type { Passage, VerifierOutput } from "../types";

export interface Verifier {
  id: string;
  verify(
    input: { hypothesis: string; passages: Passage[] },
    signal?: AbortSignal,
  ): Promise<VerifierOutput[]>;
}
