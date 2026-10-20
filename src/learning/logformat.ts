/**
 * Session-log schema + JSONL parser.
 *
 * forge reads Claude Code–style JSONL session logs (one event per line).
 * We only require a small common core so logs from many tools parse cleanly.
 */

export type EventType =
  | "message"
  | "tool_use"
  | "tool_result"
  | "correction"
  | "system";

export interface LogEvent {
  type: EventType;
  role?: "user" | "assistant" | "system";
  content?: string;
  tool?: string;
  input?: unknown;
  output?: string;
  timestamp?: string;
}

/** Parse a JSONL string into events, skipping malformed lines. */
export function parseJsonl(text: string): LogEvent[] {
  const events: LogEvent[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as Partial<LogEvent>;
      if (!obj.type) continue;
      events.push({
        type: obj.type,
        role: obj.role,
        content: typeof obj.content === "string" ? obj.content : undefined,
        tool: obj.tool,
        input: obj.input,
        output: obj.output,
        timestamp: obj.timestamp,
      });
    } catch {
      // Skip unparseable lines rather than failing the whole log.
    }
  }
  return events;
}

/** Normalize free text into a comparable "signature" for repeat detection. */
export function signature(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[a-z]:\\[^\s]+|\/(?:home|Users|var|tmp)\/[^\s]+/g, "<path>")
    .replace(/\b\d{2}:\d{2}(:\d{2})?\b/g, "<time>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/[^a-z<>\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
