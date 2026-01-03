import { Member, TreeLayout } from '@/types/Family';

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
      if (r.type === 'spouse' || r.type === 'partner' || r.type === 'sibling') addSpouseEdge(m.id, r.targetId);
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
  const levelHeight = 220;
  const unitGap = 180; // Increased gap for complex spouse families
  const memberGap = 160;
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

  // Map child-unit -> parent-units to compute child centering.
  const parentUnitsOf = new Map<string, Set<string>>();
  // Map parent-unit -> child-units to keep parents near their children when they have no parents above them.
  const childUnitsOf = new Map<string, Set<string>>();
  children.forEach((kids, parentId) => {
    const pu = unitOf(parentId);
    kids.forEach((kidId) => {
      const cu = unitOf(kidId);
      if (pu === cu) return;
      const set = parentUnitsOf.get(cu) || new Set<string>();
      set.add(pu);
      parentUnitsOf.set(cu, set);

      const cset = childUnitsOf.get(pu) || new Set<string>();
      cset.add(cu);
      childUnitsOf.set(pu, cset);
    });
  });

  // Compute unit depths by traversing the unit parent graph so children always sit below parents.
  const allUnits = Array.from(compMembers.keys());
  const indegree = new Map<string, number>();
  allUnits.forEach((u) => indegree.set(u, 0));
  parentUnitsOf.forEach((ps, cu) => indegree.set(cu, ps.size));

  const unitDepth = new Map<string, number>();
  const queue: string[] = [];
  indegree.forEach((deg, u) => {
    if (deg === 0) queue.push(u);
  });
  while (queue.length) {
    const u = queue.shift()!;
    const d = unitDepth.get(u) ?? 0;
    const childrenUnits = Array.from(childUnitsOf.get(u) || []);
    childrenUnits.forEach((cu) => {
      const nextDepth = d + 1;
      const prev = unitDepth.get(cu);
      if (prev === undefined || nextDepth > prev) unitDepth.set(cu, nextDepth);
      indegree.set(cu, (indegree.get(cu) ?? 1) - 1);
      if ((indegree.get(cu) ?? 0) === 0) queue.push(cu);
    });
    if (!unitDepth.has(u)) unitDepth.set(u, d);
  }
  // Any remaining (cycles or disconnected) get depth 0
  allUnits.forEach((u) => {
    if (!unitDepth.has(u)) unitDepth.set(u, 0);
  });

  // Recompute member depths from unit depths for ordering helpers.
  const depthOfMember = new Map<string, number>();
  compMembers.forEach((ids, u) => {
    const d = unitDepth.get(u) ?? 0;
    ids.forEach((id) => depthOfMember.set(id, d));
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

  // Build unit layers from computed depths.
  const unitLayers: string[][] = [];
  allUnits.forEach((u) => {
    const d = unitDepth.get(u) ?? 0;
    while (unitLayers.length <= d) unitLayers.push([]);
    unitLayers[d].push(u);
  });

  // Barycentric ordering to minimize edge crossings
  // 1. Initial stable order for depth 0
  if (unitLayers[0]) {
    unitLayers[0].sort((a, b) => {
      const aa = getAnchorId(a);
      const bb = getAnchorId(b);
      return aa.localeCompare(bb);
    });
  }

  // 2. Top-down pass: order each layer by average parent position
  for (let d = 1; d < unitLayers.length; d++) {
    const layer = unitLayers[d];
    const prevLayer = unitLayers[d - 1];
    const prevOrder = new Map<string, number>();
    prevLayer.forEach((u, i) => prevOrder.set(u, i));

    layer.sort((a, b) => {
      const getAvgParentPos = (u: string) => {
        const ps = Array.from(parentUnitsOf.get(u) || []);
        if (ps.length === 0) return prevLayer.length; // Place unparented units at the end
        const sum = ps.reduce((acc, p) => acc + (prevOrder.get(p) ?? 0), 0);
        return sum / ps.length;
      };
      return getAvgParentPos(a) - getAvgParentPos(b);
    });
  }

  // 3. Bottom-up pass: refine parent order by average child position
  for (let d = unitLayers.length - 2; d >= 0; d--) {
    const layer = unitLayers[d];
    const nextLayer = unitLayers[d + 1];
    const nextOrder = new Map<string, number>();
    nextLayer.forEach((u, i) => nextOrder.set(u, i));

    layer.sort((a, b) => {
      const getAvgChildPos = (u: string) => {
        const cs = Array.from(childUnitsOf.get(u) || []);
        if (cs.length === 0) {
            // If no children, try to stay near siblings who have children
            return -1; 
        }
        const sum = cs.reduce((acc, c) => acc + (nextOrder.get(c) ?? 0), 0);
        return sum / cs.length;
      };
      const posA = getAvgChildPos(a);
      const posB = getAvgChildPos(b);
      if (posA === -1 && posB === -1) return a.localeCompare(b);
      if (posA === -1) return 1;
      if (posB === -1) return -1;
      return posA - posB;
    });
  }

  const unitCount = (u: string) => Math.max(1, compMembers.get(u)?.length ?? 1);
  const unitWidth = (u: string) => nodeWidth + (unitCount(u) - 1) * memberGap;

  // Recursive subtree width calculation to reserve enough space for all descendants
  const subtreeWidthCache = new Map<string, number>();
  const visiting = new Set<string>();
  const getSubtreeWidth = (u: string): number => {
    if (subtreeWidthCache.has(u)) return subtreeWidthCache.get(u)!;
    if (visiting.has(u)) return unitWidth(u); // Prevent infinite recursion
    
    visiting.add(u);
    const ownWidth = unitWidth(u);
    // Only consider children that are at a strictly greater depth
    const childrenUnits = Array.from(childUnitsOf.get(u) || [])
      .filter(cu => (unitDepth.get(cu) ?? 0) > (unitDepth.get(u) ?? 0));
    
    if (childrenUnits.length === 0) {
      visiting.delete(u);
      subtreeWidthCache.set(u, ownWidth);
      return ownWidth;
    }

    // Sum of children's subtree widths plus gaps
    const childrenTotalWidth = childrenUnits.reduce((sum, cu, i) => {
      return sum + getSubtreeWidth(cu) + (i < childrenUnits.length - 1 ? unitGap : 0);
    }, 0);

    const finalWidth = Math.max(ownWidth, childrenTotalWidth);
    visiting.delete(u);
    subtreeWidthCache.set(u, finalWidth);
    return finalWidth;
  };

  // Unit X coordinate is the left-x of the unit
  const unitX = new Map<string, number>();
  const unitOrderIndex = new Map<string, number>();
  unitLayers.forEach((layer) => layer?.forEach((u, idx) => unitOrderIndex.set(u, idx)));

  // Place units top-down: center children under the midpoint of their parents
  for (let depth = 0; depth < unitLayers.length; depth++) {
    const layer = unitLayers[depth] || [];
    if (!layer.length) continue;

    // Group units by their parent set to handle siblings as a block
    const siblingGroups = new Map<string, string[]>();
    layer.forEach(u => {
      const parents = Array.from(parentUnitsOf.get(u) || []).sort().join(':');
      const group = siblingGroups.get(parents) || [];
      group.push(u);
      siblingGroups.set(parents, group);
    });

    const targetX = new Map<string, number>();
    
    siblingGroups.forEach((siblings, parentKey) => {
      let groupCenter = 0;
      if (parentKey) {
        const parentUnits = parentKey.split(':');
        const xs = parentUnits
          .map(p => (unitX.get(p) ?? 0) + unitWidth(p) / 2)
          .filter(x => typeof x === 'number');
        if (xs.length) {
          groupCenter = xs.reduce((a, b) => a + b, 0) / xs.length;
        } else {
          groupCenter = layer.indexOf(siblings[0]) * (unitGap * 2);
        }
      } else {
        groupCenter = layer.indexOf(siblings[0]) * (unitGap * 2);
      }

      // Calculate total width of this sibling group based on SUBTREE widths
      const totalGroupSubtreeWidth = siblings.reduce((sum, u, i) => {
        return sum + getSubtreeWidth(u) + (i < siblings.length - 1 ? unitGap : 0);
      }, 0);

      // Start position for the first sibling in the group to center the whole group
      let currentSubtreeLeft = groupCenter - totalGroupSubtreeWidth / 2;
      siblings.forEach(u => {
        const sWidth = getSubtreeWidth(u);
        const uWidth = unitWidth(u);
        // Center the unit itself within its reserved subtree space
        const unitLeft = currentSubtreeLeft + (sWidth - uWidth) / 2;
        targetX.set(u, unitLeft);
        currentSubtreeLeft += sWidth + unitGap;
      });
    });

    // Sort by target position
    layer.sort((a, b) => (targetX.get(a) ?? 0) - (targetX.get(b) ?? 0));

    // Collision resolution: ensure subtrees don't overlap
    let prevSubtreeRight = -Infinity;
    layer.forEach((u) => {
      const uWidth = unitWidth(u);
      const sWidth = getSubtreeWidth(u);
      const desiredUnitLeft = targetX.get(u) ?? 0;
      const desiredSubtreeLeft = desiredUnitLeft - (sWidth - uWidth) / 2;
      
      const minAllowedSubtreeLeft = prevSubtreeRight === -Infinity ? desiredSubtreeLeft : prevSubtreeRight + unitGap;
      const finalSubtreeLeft = Math.max(desiredSubtreeLeft, minAllowedSubtreeLeft);
      
      const finalUnitLeft = finalSubtreeLeft + (sWidth - uWidth) / 2;
      unitX.set(u, finalUnitLeft);
      prevSubtreeRight = finalSubtreeLeft + sWidth;
    });
  }

  // Bottom-up pass to center parents over their children
  for (let depth = unitLayers.length - 2; depth >= 0; depth--) {
    const layer = unitLayers[depth] || [];
    layer.forEach(u => {
      const childrenUnits = Array.from(childUnitsOf.get(u) || []);
      if (childrenUnits.length > 0) {
        const childXs = childrenUnits.map(cu => (unitX.get(cu) ?? 0) + unitWidth(cu) / 2);
        const childrenCenter = childXs.reduce((a, b) => a + b, 0) / childXs.length;
        const desiredLeft = childrenCenter - unitWidth(u) / 2;
        unitX.set(u, desiredLeft);
      }
    });
    
    // Re-resolve collisions for this layer after moving parents, respecting SUBTREE widths
    let prevSubtreeRight = -Infinity;
    layer.sort((a, b) => (unitX.get(a) ?? 0) - (unitX.get(b) ?? 0));
    layer.forEach(u => {
      const uWidth = unitWidth(u);
      const sWidth = getSubtreeWidth(u);
      const currentUnitLeft = unitX.get(u) ?? 0;
      const currentSubtreeLeft = currentUnitLeft - (sWidth - uWidth) / 2;
      
      const minAllowedSubtreeLeft = prevSubtreeRight === -Infinity ? currentSubtreeLeft : prevSubtreeRight + unitGap;
      const finalSubtreeLeft = Math.max(currentSubtreeLeft, minAllowedSubtreeLeft);
      
      const finalUnitLeft = finalSubtreeLeft + (sWidth - uWidth) / 2;
      unitX.set(u, finalUnitLeft);
      prevSubtreeRight = finalSubtreeLeft + sWidth;
    });
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
    if (isFinite(minX) && minX < minLeft) {
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

  // Final layers should be based on unitLayers for consistency
  const finalLayers: string[][] = unitLayers.map(ul => 
    ul.flatMap(u => compMembers.get(u) || [])
  );

  return { layers: finalLayers, positions, edges: finalEdges, spouseEdges };
}
