/**
 * geometry.js — network structure: nodes, edges, connected components.
 *
 * Pure graph utilities over a derived network (contrasts.deriveNetwork output). Used
 * for the network geometry plot, connectivity checks (NMA estimates are only
 * identifiable within a connected component), and edge/node evidence summaries.
 */

/** Union–find connected components over the direct-comparison graph. */
export function connectedComponents(treatments, edges) {
  const parent = {}; treatments.forEach((t) => { parent[t] = t; });
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  edges.forEach((e) => { if (parent[e.t1] != null && parent[e.t2] != null) union(e.t1, e.t2); });
  const groups = {};
  treatments.forEach((t) => { const r = find(t); (groups[r] = groups[r] || []).push(t); });
  return Object.values(groups).map((g) => g.sort());
}

/** Are treatments a and b in the same connected component of `edges`? */
export function isConnected(a, b, treatments, edges) {
  const comps = connectedComponents(treatments, edges);
  return comps.some((c) => c.includes(a) && c.includes(b));
}

/**
 * networkGeometry(network) → {
 *   nodes:[{ id, studies, participants, events }],
 *   edges:[{ t1, t2, studies, participants, directComparisons }],
 *   components:[[ids]], connected:boolean, nComponents,
 * }
 * Node size defaults to total participants; edge width to number of studies.
 */
export function networkGeometry(network) {
  const treatments = network.treatments;
  const nodeAgg = {}; treatments.forEach((t) => { nodeAgg[t] = { id: t, studies: new Set(), participants: 0, events: 0 }; });
  const edgeAgg = {};

  for (const s of network.studies) {
    // Participants/events per arm (when arm-level data is present).
    for (const a of (s.arms || [])) {
      const n = Number(a.raw?.n); const ev = Number(a.raw?.events);
      if (nodeAgg[a.treatment]) {
        nodeAgg[a.treatment].studies.add(s.id);
        if (Number.isFinite(n)) nodeAgg[a.treatment].participants += n;
        if (Number.isFinite(ev)) nodeAgg[a.treatment].events += ev;
      }
    }
    // Edges from every within-study direct comparison (all unordered arm pairs).
    const arms = (s.arms && s.arms.length ? s.arms.map((a) => a.treatment) : s.treatments) || [];
    for (let i = 0; i < arms.length; i++) for (let j = i + 1; j < arms.length; j++) {
      const [t1, t2] = [arms[i], arms[j]].sort();
      const key = `${t1}|${t2}`;
      const e = edgeAgg[key] || (edgeAgg[key] = { t1, t2, studies: new Set(), participants: 0 });
      e.studies.add(s.id);
      const a1 = (s.arms || []).find((a) => a.treatment === t1);
      const a2 = (s.arms || []).find((a) => a.treatment === t2);
      if (a1 && Number.isFinite(Number(a1.raw?.n))) e.participants += Number(a1.raw.n);
      if (a2 && Number.isFinite(Number(a2.raw?.n))) e.participants += Number(a2.raw.n);
    }
  }

  const edges = Object.values(edgeAgg).map((e) => ({
    t1: e.t1, t2: e.t2, studies: e.studies.size, participants: e.participants,
  }));
  const nodes = treatments.map((t) => ({
    id: t, studies: nodeAgg[t].studies.size, participants: nodeAgg[t].participants, events: nodeAgg[t].events,
  }));
  const components = connectedComponents(treatments, edges);

  return {
    nodes, edges, components,
    nComponents: components.length,
    connected: components.length <= 1,
  };
}
