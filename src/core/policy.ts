/**
 * Declarative guardrail / policy engine.
 *
 * ECC has a `security` rule file (prose). forge has an *enforceable* policy
 * engine: rules inspect a planned action (tool, command, path, content) and
 * return `deny`, `require-approval`, or allow. The engine, CLI (`forge policy`),
 * and `tool:pre` hook can all consult this before anything destructive runs.
 */

import type { Hooks } from "./hooks.ts";

export interface PolicyAction {
  /** Tool / operation name (e.g. "bash", "write", "edit"). */
  tool?: string;
  /** Shell command about to run (for tool=bash). */
  command?: string;
  /** File path about to be written/read. */
  path?: string;
  /** Content about to be written (used for secret / injection checks). */
  content?: string;
}

export type PolicyEffect = "deny" | "require-approval";

export interface PolicyMatch {
  /** Regex/string that must match the action's `tool`. */
  tool?: RegExp | string;
  /** Regex/string that must match `command`. */
  command?: RegExp | string;
  /** Regex/string that must match `path`. */
  path?: RegExp | string;
  /** Regex/string that must match `content`. */
  contains?: RegExp | string;
}

export interface PolicyRule {
  id: string;
  description: string;
  effect: PolicyEffect;
  /**
   * A rule FIRES when ANY provided matcher hits its field.
   * (Empty match `{}` matches everything — use for blanket rules.)
   */
  match?: PolicyMatch;
}

export interface PolicyVerdict {
  allowed: boolean;
  needsApproval: boolean;
  rule?: PolicyRule;
  reason?: string;
}

function toRegex(v: RegExp | string): RegExp {
  return v instanceof RegExp ? v : new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

function hits(pattern: RegExp | string | undefined, value: string | undefined): boolean {
  if (!pattern) return false;
  if (value === undefined) return false;
  return toRegex(pattern).test(value);
}

export class PolicyEngine {
  private readonly rules: PolicyRule[];

  constructor(rules?: PolicyRule[]) {
    this.rules = rules ?? PolicyEngine.defaults();
  }

  list(): PolicyRule[] {
    return [...this.rules];
  }

  /** Evaluate an action against every rule (first match wins). */
  evaluate(action: PolicyAction): PolicyVerdict {
    for (const rule of this.rules) {
      const m = rule.match ?? {};
      const anyMatcher = Boolean(m.tool || m.command || m.path || m.contains);
      let fired = false;
      if (!anyMatcher) {
        fired = true;
      } else {
        fired =
          hits(m.tool, action.tool) ||
          hits(m.command, action.command) ||
          hits(m.path, action.path) ||
          hits(m.contains, action.content);
      }
      if (fired) {
        const deny = rule.effect === "deny";
        return {
          allowed: !deny,
          needsApproval: !deny,
          rule,
          reason: `${deny ? "denied" : "requires approval"} by policy '${rule.id}': ${rule.description}`,
        };
      }
    }
    return { allowed: true, needsApproval: false };
  }

  /** Sensible out-of-the-box guardrails. */
  static defaults(): PolicyRule[] {
    return [
      {
        id: "no-recursive-root-delete",
        description: "Never run a recursive force-delete from a root/home path.",
        effect: "deny",
        match: { command: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\s+(\/|~|\/\*|~\/)/i },
      },
      {
        id: "no-pipe-to-shell",
        description: "Downloading and piping a script straight into a shell is blocked.",
        effect: "deny",
        match: { command: /(curl|wget)[^\n|]*\|\s*(ba|z|k|da)?sh/i },
      },
      {
        id: "no-credential-dirs",
        description: "Do not read/write SSH keys or credential stores.",
        effect: "deny",
        match: { path: /(^|[\\/])\.ssh[\\/]|id_(rsa|ed25519)|\.aws[\\/]|\.gnupg[\\/]/i },
      },
      {
        id: "no-prod-mutation",
        description: "Production mutations need a human in the loop.",
        effect: "require-approval",
        match: { command: /\b(kubectl|terraform|helm)\b.*(prod|production)|\bdeploy\s+--?env[= ]prod/i },
      },
      {
        id: "no-secrets-in-content",
        description: "Refuse to write obvious secrets (API keys, private keys, tokens) to disk.",
        effect: "deny",
        match: {
          contains: /(-----BEGIN [A-Z ]*PRIVATE KEY-----)|(sk-[A-Za-z0-9]{20,})|(AKIA[0-9A-Z]{16})|(ghp_[A-Za-z0-9]{36})|(xox[baprs]-[A-Za-z0-9-]{10,})/i,
        },
      },
      {
        id: "no-git-force-push",
        description: "Force-pushing (especially to main) is an approval-gated action.",
        effect: "require-approval",
        match: { command: /\bgit\s+push\b[^\n]*\s(--force|-f)\b/i },
      },
      {
        id: "no-nuke-node-modules-shell",
        description: "Deleting dependency lockfiles is approval-gated.",
        effect: "require-approval",
        match: { path: "(package-lock.json|pnpm-lock.yaml|yarn.lock|Cargo.lock|go.sum)$" },
      },
    ];
  }
}

/**
 * Wire a PolicyEngine into a Hooks registry as a `tool:pre` guard.
 *
 * Any action the policy denies is blocked. Actions that merely require
 * approval are also blocked by default (the engine has no interactive
 * approval channel) — pass `blockOnApproval: false` to let them through and
 * merely tag them.
 */
export function guardWithPolicy(
  hooks: Hooks,
  policy: PolicyEngine,
  opts: { priority?: number; blockOnApproval?: boolean } = {},
): void {
  const priority = opts.priority ?? -100;
  const blockOnApproval = opts.blockOnApproval ?? true;
  hooks.on(
    "tool:pre",
    "policy-guard",
    (event) => {
      const action = (event.data?.action ?? {}) as PolicyAction;
      const verdict = policy.evaluate(action);
      if (!verdict.allowed) return { block: true, reason: verdict.reason };
      if (verdict.needsApproval && blockOnApproval) {
        return { block: true, reason: verdict.reason ?? "policy requires approval" };
      }
      if (verdict.needsApproval) {
        return { meta: { policyApproval: verdict.rule?.id } };
      }
      return undefined;
    },
    priority,
  );
}
