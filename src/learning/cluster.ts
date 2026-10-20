/**
 * Clustering of similar corrections / candidates.
 *
 * The extractor pulls individual signatures out of session logs; clustering
 * groups *near-duplicate* ones (e.g. "don't use console.log" and "avoid
 * console.log calls") so a single skill proposal can cover a family of
 * corrections instead of emitting ten near-identical ones.
 */

export interface ClusterItem {
  id: string;
  text: string;
}

export interface Cluster {
  /** The first item that formed the cluster (acts as the representative). */
  representative: ClusterItem;
  members: ClusterItem[];
  size: number;
  /** Mean pairwise Jaccard similarity of members to the representative. */
  cohesion: number;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length > 2),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Greedy single-pass clustering: an item joins the first cluster whose
 * representative is at least `threshold` similar, else it starts a new cluster.
 * Deterministic (input order) — no randomness.
 */
export function clusterBySimilarity(items: ClusterItem[], threshold = 0.4): Cluster[] {
  const clusters: { rep: ClusterItem; repTokens: Set<string>; members: ClusterItem[]; tokenSets: Set<string>[] }[] = [];

  for (const item of items) {
    const toks = tokenize(item.text);
    let placed = false;
    for (const c of clusters) {
      if (jaccard(c.repTokens, toks) >= threshold) {
        c.members.push(item);
        c.tokenSets.push(toks);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({ rep: item, repTokens: toks, members: [item], tokenSets: [toks] });
    }
  }

  return clusters.map((c) => {
    const sims = c.tokenSets.map((t) => jaccard(c.repTokens, t));
    const cohesion = sims.length ? sims.reduce((a, b) => a + b, 0) / sims.length : 1;
    return { representative: c.rep, members: [...c.members], size: c.members.length, cohesion };
  });
}

/** Convenience: total items that were grouped into multi-member clusters. */
export function redundantCount(clusters: Cluster[]): number {
  return clusters.reduce((acc, c) => acc + (c.size > 1 ? c.size - 1 : 0), 0);
}
