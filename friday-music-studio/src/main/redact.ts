// Scrubs anything that looks like a credential before text reaches the
// renderer, a log line or a diagnostic export.

const PATTERNS: Array<[RegExp, string]> = [
  [/(authorization\s*[:=]\s*)(bearer|basic)?\s*[^\s,;"']+/gi, '$1[REDACTED]'],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]'],
  [/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|secret|password|token|code_verifier|code)(["']?\s*[:=]\s*["']?)[^\s&"',;]+/gi, '$1$2[REDACTED]'],
  [/\bya29\.[A-Za-z0-9._-]+/g, '[REDACTED]'],
  [/\b1\/\/[A-Za-z0-9._-]{20,}/g, '[REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]'],
];

export function redact(text: string): string {
  let out = text;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redactError(err: unknown): string {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : 'Unknown error';
  return redact(msg).slice(0, 2000);
}
