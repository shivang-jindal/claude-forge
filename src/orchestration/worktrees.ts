/**
 * Git worktree orchestration.
 *
 * Spin up N isolated checkouts of the repo so parallel runs (same workflow,
 * different branches/shards) never contend for the working tree. Clean them up
 * when done. Signature capability #2.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { log } from "../core/logger.ts";
import { STATE_DIR } from "../core/store.ts";

const execFileAsync = promisify(execFile);

export interface WorktreeOptions {
  /** Repo root (where .git lives). */
  root: string;
  /** Directory to place worktrees in (must be gitignored). Default `<root>/.forge/worktrees`. */  baseDir?: string;
  /** Branch base. Default: current HEAD. */
  base?: string;
  /** Branch name prefix. Default "forge". */
  prefix?: string;
}

export class WorktreeManager {
  private readonly root: string;
  private readonly baseDir: string;
  private readonly base?: string;
  private readonly prefix: string;

  constructor(opts: WorktreeOptions) {
    this.root = resolve(opts.root);
    this.baseDir = opts.baseDir ?? join(this.root, STATE_DIR, "worktrees");
    this.base = opts.base;
    this.prefix = opts.prefix ?? "forge";
  }

  private async git(args: string[], cwd = this.root): Promise<string> {
    const { stdout } = await execFileAsync("git", args, { cwd });
    return stdout.trim();
  }

  /** Create `count` worktrees, each on its own branch. Returns their paths. */
  async create(count: number): Promise<string[]> {
    const sha = (await this.git(["rev-parse", this.base ?? "HEAD"])).slice(0, 8);
    const paths: string[] = [];
    for (let i = 0; i < count; i++) {
      const branch = `${this.prefix}-${sha}-${i}`;
      const path = join(this.baseDir, `${branch}`);
      // Create a new branch from base and attach a worktree at `path`.
      await this.git(["worktree", "add", "-b", branch, path, this.base ?? "HEAD"]);
      paths.push(path);
      log.debug(`worktree: created ${branch} → ${path}`);
    }
    return paths;
  }

  /** Run a task in each worktree (bounded), then optionally remove them. */
  async map<T>(
    count: number,
    fn: (path: string, index: number) => Promise<T>,
    opts: { cleanup?: boolean; concurrency?: number } = {},
  ): Promise<Array<{ path: string; ok: boolean; value?: T; error?: string }>> {
    const paths = await this.create(count);
    const concurrency = opts.concurrency ?? count;
    const results: Array<{ path: string; ok: boolean; value?: T; error?: string }> = [];
    let next = 0;
    const workers = Array.from({ length: Math.min(concurrency, paths.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= paths.length) return;
        try {
          const value = await fn(paths[i], i);
          results[i] = { path: paths[i], ok: true, value };
        } catch (err) {
          results[i] = { path: paths[i], ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
    });
    await Promise.all(workers);
    if (opts.cleanup !== false) await this.cleanup(paths);
    return results;
  }

  /** Remove specific worktrees. */
  async cleanup(paths: string[]): Promise<void> {
    for (const p of paths) {
      try {
        await this.git(["worktree", "remove", "--force", p]);
      } catch (err) {
        log.warn(`worktree: failed to remove ${p}: ${err instanceof Error ? err.message : err}`);
      }
    }
    try {
      await this.git(["worktree", "prune"]);
    } catch {
      /* ignore */
    }
  }
}
