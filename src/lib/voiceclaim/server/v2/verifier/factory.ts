import type { Verifier } from "./types";
import { LlmVerifier } from "./llm-verifier";
import { NliVerifier } from "./nli-verifier";
import { HybridVerifier } from "./hybrid-verifier";
import { getServerConfig } from "../../config.server";

export function createVerifier(providerOverride?: "llm" | "nli" | "hybrid"): Verifier {
  const config = getServerConfig();
  const provider = providerOverride ?? config.verifierProvider ?? "llm";

  switch (provider) {
    case "nli":
      return new NliVerifier();
    case "hybrid":
      return new HybridVerifier();
    case "llm":
    default:
      return new LlmVerifier();
  }
}
