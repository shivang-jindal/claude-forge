/** Structured, level-aware logger. Silent unless FORGE_LOG is set (or in tests). */

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const env = process.env.FORGE_LOG ?? (process.env.NODE_ENV === "test" ? "silent" : "info");
  if (env === "silent") return Infinity;
  return LEVEL_ORDER[env as Level] ?? 20;
}

// Textual ANSI escapes (avoid raw control bytes in source).
const ESC = "\x1b";
const COLORS: Record<Level, string> = {
  debug: ESC + "[2m",
  info: ESC + "[36m",
  warn: ESC + "[33m",
  error: ESC + "[31m",
};
const RESET = ESC + "[0m";

function emit(level: Level, msg: string, extra?: unknown): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const useColor = Boolean(process.stdout.isTTY);
  const tag = useColor ? COLORS[level] + "[" + level + "]" + RESET : "[" + level + "]";
  const line = tag + " " + msg;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(extra !== undefined ? line + " " + JSON.stringify(extra) + "\n" : line + "\n");
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
