import { Member, TreeLayout } from '@/types/family';

export function calculateTreeLayout(members: Member[], screenWidth: number): TreeLayout {
  const map = new Map<string, Member>();
  members.forEach((m) => map.set(m.id, m));

  // Build adjacency for children (parent -> [children])
  const children = new Map<string, string[]>();
  const parentChildNodes = new Set<string>();
  members.forEach((m) => {
    const rels = m.relations || [];
    rels.forEach((r) => {
      if (r.type === 'parent') {
        // targetId is parent of m
        const arr = children.get(r.targetId) || [];
        if (!arr.includes(m.id)) arr.push(m.id);
        children.set(r.targetId, arr);
        parentChildNodes.add(r.targetId);
        parentChildNodes.add(m.id);
      }
      if (r.type === 'child') {
        // m is parent of targetId
        const arr = children.get(m.id) || [];
        if (!arr.includes(r.targetId)) arr.push(r.targetId);
        children.set(m.id, arr);
        parentChildNodes.add(m.id);
        parentChildNodes.add(r.targetId);
      }
    });
  });

  // Find roots: nodes not child of anyone
  const allIds = new Set(members.map((m) => m.id));
  const childSet = new Set<string>();
  children.forEach((vals) => vals.forEach((id) => childSet.add(id)));
  const roots = Array.from(allIds).filter((id) => !childSet.has(id));
  if (roots.length === 0 && members.length > 0) roots.push(members[0].id);

  // Build spouse/partner adjacency (undirected)
  const spouseAdj = new Map<string, Set<string>>();
  const addSpouseEdge = (a: string, b: string) => {
    if (!a || !b || a === b) return;
    if (!spouseAdj.has(a)) spouseAdj.set(a, new Set());
    if (!spouseAdj.has(b)) spouseAdj.set(b, new Set());
    spouseAdj.get(a)!.add(b);
    spouseAdj.get(b)!.add(a);
  };
  members.forEach((m) => {
    (m.relations || []).forEach((r: any) => {
      if (r.type === 'spouse' || r.type === 'partner') addSpouseEdge(m.id, r.targetId);
    });
  });

  // BFS to assign generations based on parent/child relations
  const layers: string[][] = [];
  const visited = new Set<string>();
  const visitedByParentChild = new Set<string>();
  roots.forEach((r) => {
    if (visited.has(r)) return;
    const queue = [{ id: r, depth: 0 }];
    while (queue.length) {
      const node = queue.shift()!;
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (parentChildNodes.has(node.id)) visitedByParentChild.add(node.id);
      if (!layers[node.depth]) layers[node.depth] = [];
      layers[node.depth].push(node.id);
      const kids = children.get(node.id) || [];
      kids.forEach((c) => queue.push({ id: c, depth: node.depth + 1 }));
    }
  });

  // Add unvisited as separate roots
  members.forEach((m) => {
    if (!visited.has(m.id)) {
      layers[0] = layers[0] || [];
      layers[0].push(m.id);
      visited.add(m.id);
    }
  });

  // Align spouse/partner nodes to the same generation when possible.
  // If a spouse component contains any node connected via parent/child traversal,
  // place the whole component at that component's anchored depth.
  const depthOf = new Map<string, number>();
  layers.forEach((ids, depth) => ids.forEach((id) => depthOf.set(id, depth)));

  // Union-Find for spouse components
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) {
      parent.set(x, x);
      return x;
    }
    const root = find(p);
    parent.set(x, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  Array.from(map.keys()).forEach((id) => parent.set(id, id));
  spouseAdj.forEach((set, a) => set.forEach((b) => union(a, b)));

  const compMembers = new Map<string, string[]>();
  Array.from(map.keys()).forEach((id) => {
    const root = find(id);
    const arr = compMembers.get(root) || [];
    arr.push(id);
    compMembers.set(root, arr);
  });

  const alignedDepth = new Map<string, number>();
  compMembers.forEach((ids) => {
    const anchoredDepths = ids
      .filter((id) => visitedByParentChild.has(id))
      .map((id) => depthOf.get(id))
      .filter((d): d is number => typeof d === 'number');

    // If any member in the component is a child of someone, anchor to those depths first
    // so a "free" spouse with no parents cannot pull the component up to depth 0.
    const anchoredChildDepths = ids
      .filter((id) => visitedByParentChild.has(id) && childSet.has(id))
      .map((id) => depthOf.get(id))
      .filter((d): d is number => typeof d === 'number');

    const depthSource = anchoredChildDepths.length ? anchoredChildDepths : anchoredDepths;
    if (depthSource.length === 0) return;
    const targetDepth = Math.min(...depthSource);
    ids.forEach((id) => alignedDepth.set(id, targetDepth));
  });

  if (alignedDepth.size > 0) {
    const nextLayers: string[][] = [];
    const placed = new Set<string>();
    Array.from(map.keys()).forEach((id) => {
      const depth = alignedDepth.get(id) ?? depthOf.get(id) ?? 0;
      if (!nextLayers[depth]) nextLayers[depth] = [];
      if (!placed.has(id)) {
        nextLayers[depth].push(id);
        placed.add(id);
      }
    });
    // Replace layers with aligned layers
    layers.length = 0;
    nextLayers.forEach((col, idx) => {
      if (col && col.length) layers[idx] = col;
    });
  }

  // Position nodes
  const positions: Record<string, { x: number; y: number }> = {};
  const levelHeight = 190;
  const unitGap = 240;
  const memberGap = 185;
  const minLeft = 40;
  const nodeWidth = 140;
  const nodeHeight = 100;

  const unitOf = (id: string) => find(id);

  // parent map (child -> parent) to keep siblings together
  const parentOf = new Map<string, string>();
  children.forEach((kids, parentId) => {
    kids.forEach((k) => {
      if (!parentOf.has(k)) parentOf.set(k, parentId);
    });
  });

  // Recompute depth map after spouse alignment.
  const depthOfMember = new Map<string, number>();
  layers.forEach((ids, depth) => ids.forEach((id) => depthOfMember.set(id, depth)));

  // Build unit depth (spouse-group depth) and unit layers (ordered).
  const unitDepth = new Map<string, number>();
  compMembers.forEach((ids, root) => {
    const depths = ids
      .map((id) => depthOfMember.get(id))
      .filter((d): d is number => typeof d === 'number');
    unitDepth.set(root, depths.length ? Math.min(...depths) : 0);
  });

  // Stable anchor chooser for a spouse unit: prefer members connected via parent/child traversal,
  // then deterministic id order. Used both for ordering units and for positioning.
  const getAnchorId = (u: string): string => {
    const all = (compMembers.get(u) || []).slice();
    const preferred = all
      .filter((id) => visitedByParentChild.has(id))
      .sort((a, b) => {
        const da = depthOfMember.get(a) ?? 0;
        const db = depthOfMember.get(b) ?? 0;
        if (da !== db) return da - db;
        return a.localeCompare(b);
      });
    if (preferred[0]) return preferred[0];
    return all.sort((a, b) => a.localeCompare(b))[0] ?? '';
  };

  const unitLayers: string[][] = [];
  layers.forEach((col, depth) => {
    const units = Array.from(new Set(col.map((id) => unitOf(id))));
    const ordered = units
      .slice()
      .sort((a, b) => {
        const aa = getAnchorId(a);
        const bb = getAnchorId(b);
        if (aa && bb && aa !== bb) return aa.localeCompare(bb);
        return a.localeCompare(b);
      });
    if (!unitLayers[depth]) unitLayers[depth] = [];
    ordered.forEach((u) => {
      if (!unitLayers[depth].includes(u)) unitLayers[depth].push(u);
    });
  });
  compMembers.forEach((_ids, u) => {
    const d = unitDepth.get(u) ?? 0;
    const already = unitLayers.some((layer) => layer?.includes(u));
    if (!already) {
      if (!unitLayers[d]) unitLayers[d] = [];
      unitLayers[d].push(u);
    }
  });

  // Map child-unit -> parent-units to compute child centering.
  const parentUnitsOf = new Map<string, Set<string>>();
  children.forEach((kids, parentId) => {
    const pu = unitOf(parentId);
    kids.forEach((kidId) => {
      const cu = unitOf(kidId);
      if (pu === cu) return;
      const set = parentUnitsOf.get(cu) || new Set<string>();
      set.add(pu);
      parentUnitsOf.set(cu, set);
    });
  });

  const unitCount = (u: string) => Math.max(1, compMembers.get(u)?.length ?? 1);
  // Unit X coordinate is the left-x of the "anchor" member within the unit.
  // Additional spouses/partners are placed to the right so the anchor doesn't jump when a spouse is added.
  const unitBounds = (u: string, anchorLeftX: number) => {
    const n = unitCount(u);
    const left = anchorLeftX;
    const right = anchorLeftX + (n - 1) * memberGap + nodeWidth;
    return { left, right };
  };
  const unitMidX = (u: string) => {
    const x = unitX.get(u) ?? 0;
    // Anchor mid (first member), so adding a spouse does not change the child's alignment.
    return x + nodeWidth / 2;
  };

  const unitX = new Map<string, number>();
  const unitOrderIndex = new Map<string, number>();
  unitLayers.forEach((layer) => layer?.forEach((u, idx) => unitOrderIndex.set(u, idx)));

  // Place units top-down: center children under the midpoint of their parents (joint parents supported).
  for (let depth = 0; depth < unitLayers.length; depth++) {
    const layer = unitLayers[depth] || [];
    if (!layer.length) continue;

    const targetX = new Map<string, number>();
    layer.forEach((u, idx) => {
      const parents = parentUnitsOf.get(u);
      if (parents && parents.size) {
        const xs = Array.from(parents)
          .map((p) => unitMidX(p))
          .filter((x): x is number => typeof x === 'number');
        if (xs.length) {
          // Convert desired center into desired anchor-left.
          const center = xs.reduce((a, b) => a + b, 0) / xs.length;
          // Align the anchor (first node) to the center of the parents.
          // This ensures the child node stays under the parent, and spouses are added to the side.
          targetX.set(u, center - nodeWidth / 2);
          return;
        }
      }
      targetX.set(u, idx * unitGap);
    });

    // Sort by target position (and stable fallback to previous order).
    layer.sort((a, b) => {
      const da = targetX.get(a) ?? 0;
      const db = targetX.get(b) ?? 0;
      if (da !== db) return da - db;
      return (unitOrderIndex.get(a) ?? 0) - (unitOrderIndex.get(b) ?? 0);
    });

    // Collision resolution within the layer, using full unit bounds (not symmetric half-width).
    const minGap = 110;
    let prevRight = -Infinity;
    layer.forEach((u) => {
      const desiredAnchorLeft = targetX.get(u) ?? 0;
      const bounds = unitBounds(u, desiredAnchorLeft);
      const minAllowedLeft = prevRight === -Infinity ? bounds.left : prevRight + minGap;
      const finalLeft = Math.max(bounds.left, minAllowedLeft);
      unitX.set(u, finalLeft);
      prevRight = unitBounds(u, finalLeft).right;
    });

    // Avoid re-centering layers to screen width (reduces large jumps when a spouse is added).
    // Only ensure a minimum left padding.
    const minX = Math.min(...layer.map((u) => unitX.get(u) ?? 0));
    if (minX < minLeft) {
      const shift = minLeft - minX;
      layer.forEach((u) => unitX.set(u, (unitX.get(u) ?? 0) + shift));
    }
  }

  // Finally, place individual members within each spouse-unit side-by-side.
  for (let depth = 0; depth < unitLayers.length; depth++) {
    const y = depth * levelHeight + 100;
    const layer = unitLayers[depth] || [];
    layer.forEach((u) => {
      const baseX = unitX.get(u) ?? 0;
      const all = (compMembers.get(u) || []).slice();

      // Pick a stable "anchor" member that keeps its x when spouses are added.
      const anchorId = getAnchorId(u);

      const rest = all
        .filter((id) => id !== anchorId)
        .sort((a, b) => {
          // Keep spouses deterministic and loosely aligned by parent grouping.
          const pa = parentOf.get(a) || '';
          const pb = parentOf.get(b) || '';
          const prevLayer = depth > 0 ? layers[depth - 1] : undefined;
          const paIdx = prevLayer ? prevLayer.indexOf(pa) : -1;
          const pbIdx = prevLayer ? prevLayer.indexOf(pb) : -1;
          if (paIdx !== pbIdx) return (paIdx === -1 ? 9999 : paIdx) - (pbIdx === -1 ? 9999 : pbIdx);
          return a.localeCompare(b);
        });

      const ids = anchorId ? [anchorId, ...rest] : rest;
      ids.forEach((id, i) => {
        positions[id] = { x: baseX + i * memberGap, y };
      });
    });
  }

  // Ensure we don't return an empty layout bounding box.
  // (Tree screen measures extents from positions.)
  void nodeHeight;

  // Normalize so the left-most node is always visible (prevents negative x clipping on big trees).
  const allPos = Object.values(positions);
  if (allPos.length) {
    const minX = Math.min(...allPos.map((p) => p.x));
    if (minX < minLeft) {
      const dx = minLeft - minX;
      Object.keys(positions).forEach((id) => {
        positions[id] = { x: positions[id].x + dx, y: positions[id].y };
      });
    }
  }

  // Edges (Parent -> Child)
  const edges: { from: string; to: string; isJoint?: boolean; parent2?: string }[] = [];
  
  // Group children by parent set
  const parentSets = new Map<string, string[]>(); // "p1:p2" -> [childIds]
  
  children.forEach((kids, parentId) => {
    kids.forEach((childId) => {
      // Check if this child has another parent who is a spouse of parentId
      const otherParent = members.find(m => {
          if (m.id === parentId) return false;
          // Check if m is spouse of parentId
          const isSpouse = m.relations?.some(r => r.targetId === parentId && (r.type === 'spouse' || r.type === 'partner'));
          // Check if m is also parent of childId
          const mKids = children.get(m.id) || [];
          return isSpouse && mKids.includes(childId);
      });

      if (otherParent) {
          // Joint parentage
          const p1 = parentId < otherParent.id ? parentId : otherParent.id;
          const p2 = parentId < otherParent.id ? otherParent.id : parentId;
          const key = `${p1}:${p2}`;
          const set = parentSets.get(key) || [];
          if (!set.includes(childId)) {
              set.push(childId);
              parentSets.set(key, set);
          }
      } else {
          edges.push({ from: parentId, to: childId });
      }
    });
  });

  // Add joint edges
  parentSets.forEach((kids, key) => {
      const [p1, p2] = key.split(':');
      kids.forEach(childId => {
          edges.push({ from: p1, to: childId, isJoint: true, parent2: p2 });
      });
  });

  // Filter out single edges that are covered by joint edges
  const finalEdges = edges.filter(e => {
      if (e.isJoint) return true;
      const isCovered = Array.from(parentSets.entries()).some(([key, kids]) => {
          const [p1, p2] = key.split(':');
          return (p1 === e.from || p2 === e.from) && kids.includes(e.to);
      });
      return !isCovered;
  });

  // Spouse Edges
  const spouseEdges: { from: string; to: string }[] = [];
  const processedPairs = new Set<string>();
  members.forEach(m => {
      m.relations?.forEach(r => {
          if (r.type === 'spouse' || r.type === 'partner') {
              const pair = [m.id, r.targetId].sort().join(':');
              if (!processedPairs.has(pair)) {
                  spouseEdges.push({ from: m.id, to: r.targetId });
                  processedPairs.add(pair);
              }
          }
      });
  });

  return { layers, positions, edges: finalEdges, spouseEdges };
}
