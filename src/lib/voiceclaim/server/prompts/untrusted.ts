export function sanitizeUntrustedText(text: string): string {
  if (!text) return "";
  // Strip any delimiter tokens to prevent prompt injection escapes
  return text
    .replace(/<<<\s*BEGIN\s+UNTRUSTED[^>]*>>>/gi, "[STRIPPED_DELIMITER]")
    .replace(/<<<\s*END\s+UNTRUSTED\s*>>>/gi, "[STRIPPED_DELIMITER]");
}

export function wrapUntrusted(label: string, text: string, id?: string): string {
  const safeText = sanitizeUntrustedText(text);
  const idAttr = id ? ` id=${id}` : "";
  return `<<<BEGIN UNTRUSTED ${label}${idAttr}>>>\n${safeText}\n<<<END UNTRUSTED>>>`;
}
