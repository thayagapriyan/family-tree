export type RelationType = 'parent' | 'child' | 'spouse' | 'sibling' | 'partner' | 'other';

export interface Relation {
  type: string;
  targetId: string;
}

export interface Member {
  id: string;
  name: string;
  email?: string;
  dob?: string;
  dod?: string;
  sex?: string;
  age?: number;
  photo?: string;
  relations?: Relation[];
}

export interface TreeLayout {
  layers: string[][];
  positions: Record<string, { x: number; y: number }>;
  edges: Array<{ from: string; to: string; isJoint?: boolean; parent2?: string }>;
  spouseEdges: Array<{ from: string; to: string }>;
}
