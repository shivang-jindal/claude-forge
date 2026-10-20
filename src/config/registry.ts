/**
 * Plugin registry — activation + dependency ordering.
 *
 * Holds loaded agents/skills/commands/rules, resolves them by kind+name, and
 * produces a dependency-first activation order (so a skill that builds on
 * another is loaded after its base).
 */

import type { Plugin, PluginKind } from "./loader.ts";

export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();

  constructor(plugins: Plugin[] = []) {
    for (const p of plugins) this.add(p);
  }

  add(p: Plugin): void {
    this.plugins.set(`${p.kind}:${p.name}`, p);
  }

  find(kind: PluginKind, name: string): Plugin | undefined {
    return this.plugins.get(`${kind}:${name}`);
  }

  /** Find by name across kinds (agent wins ties). */
  byName(name: string): Plugin | undefined {
    return (
      this.find("agent", name) ??
      this.find("skill", name) ??
      this.find("command", name) ??
      this.find("rule", name)
    );
  }

  list(kind?: PluginKind): Plugin[] {
    const all = [...this.plugins.values()];
    return kind ? all.filter((p) => p.kind === kind) : all;
  }

  /**
   * Return the named plugins (and their transitive deps) in dependency-first
   * order. Throws on missing deps or cycles.
   */
  activationOrder(names: string[]): Plugin[] {
    const ordered: Plugin[] = [];
    const state = new Map<string, "visiting" | "done">();

    const visit = (name: string, chain: string[]): void => {
      const p = this.byName(name);
      if (!p) throw new Error(`Unknown plugin: ${name} (chain: ${chain.join(" → ")})`);
      const key = `${p.kind}:${p.name}`;
      const st = state.get(key);
      if (st === "done") return;
      if (st === "visiting") throw new Error(`Dependency cycle: ${[...chain, name].join(" → ")}`);
      state.set(key, "visiting");
      for (const dep of p.dependsOn ?? []) visit(dep, [...chain, name]);
      state.set(key, "done");
      ordered.push(p);
    };

    for (const n of names) visit(n, []);
    return ordered;
  }
}
