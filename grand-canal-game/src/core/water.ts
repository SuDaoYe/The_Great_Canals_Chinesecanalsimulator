import { TICKS_PER_YEAR } from './calendar';
import type {
  EntityId, GameState, WaterEdge, WaterNode,
} from './types';

// Water ledger invariant (architecture 7.1): opening + incoming
// === closing + outgoing(boundary) + consumed(evaporation + irrigation).
// Internal node-to-node transfers cancel out of the aggregate and are never
// double-counted as both consumption and a downstream gain. Overflow is always
// pushed along an explicit outlet; it is never silently truncated to capacity.

export interface IrrigationRecord { requested: number; delivered: number }

export interface WaterContext {
  storage: Map<string, number>;
  edgeRemaining: Map<string, number>;
  incoming: number;
  consumed: number;
  outgoing: number;
  irrigationByRegion: Map<string, IrrigationRecord>;
}

export interface WaterSettlement {
  nodes: readonly WaterNode[];
  opening: number;
  incoming: number;
  consumed: number;
  outgoing: number;
  closing: number;
  irrigationByRegion: ReadonlyMap<string, IrrigationRecord>;
}

function nodeById(nodes: readonly WaterNode[], id: EntityId): WaterNode {
  const node = nodes.find(candidate => candidate.id === id);
  if (node === undefined) throw new Error(`Unknown water node ${id}`);
  return node;
}

// Phase 1: external inflow, evaporation and irrigation are settled before
// transport, so gate releases always draw from real remaining storage.
export function beginWater(state: GameState, nextTick: number): WaterContext {
  // Settlement k-1 -> k lives through period k-1 (tick 0 is the first period).
  const periodOfYear = (nextTick - 1) % TICKS_PER_YEAR;
  const storage = new Map(state.waterNodes.map(node => [node.id, node.storage]));
  const closedCuts = new Set(state.reaches.filter(r => r.status === 'candidate' || r.status === 'retired').flatMap(r => r.waterEdgeIds));
  const edgeRemaining = new Map(state.waterEdges.map(edge => [edge.id, closedCuts.has(edge.id) ? 0 : edge.capacity]));
  const irrigationByRegion = new Map<string, IrrigationRecord>();
  let incoming = 0;
  let consumed = 0;
  for (const node of state.waterNodes) {
    const inflow = node.seasonalInflow[periodOfYear] ?? 0;
    storage.set(node.id, (storage.get(node.id) ?? 0) + inflow);
    incoming += inflow;
    const evaporation = Math.min(node.evaporation, storage.get(node.id) ?? 0);
    storage.set(node.id, (storage.get(node.id) ?? 0) - evaporation);
    consumed += evaporation;
    const shareBp = state.parameters.water.irrigationPriorityBp[node.policy];
    const available = storage.get(node.id) ?? 0;
    const irrigated = Math.min(node.irrigationRequest,
      Math.floor(available * shareBp / 10000));
    storage.set(node.id, available - irrigated);
    consumed += irrigated;
    const region = irrigationByRegion.get(node.regionId) ?? { requested: 0, delivered: 0 };
    irrigationByRegion.set(node.regionId, {
      requested: region.requested + node.irrigationRequest,
      delivered: region.delivered + irrigated,
    });
  }
  return { storage, edgeRemaining, incoming, consumed, outgoing: 0, irrigationByRegion };
}

export function storageOf(ctx: WaterContext, nodeId: EntityId): number {
  return ctx.storage.get(nodeId) ?? 0;
}

// Maximum water releasable through this edge in the current tick, regardless of
// why it is released (lock passage or overflow). Navigation eligibility (level,
// availability, control) is checked by the caller.
export function releaseBudget(ctx: WaterContext, edge: WaterEdge): number {
  return Math.min(ctx.edgeRemaining.get(edge.id) ?? 0, ctx.storage.get(edge.fromNodeId) ?? 0);
}

// Move water along an edge. Returns the amount actually released; internal
// transfers stay in the aggregate, boundary outlets leave the network.
export function releaseThrough(ctx: WaterContext, edge: WaterEdge, amount: number): number {
  const budget = releaseBudget(ctx, edge);
  const released = Math.min(Math.max(0, amount), budget);
  if (released <= 0) return 0;
  ctx.storage.set(edge.fromNodeId, (ctx.storage.get(edge.fromNodeId) ?? 0) - released);
  ctx.edgeRemaining.set(edge.id, (ctx.edgeRemaining.get(edge.id) ?? 0) - released);
  if (edge.toNodeId === null) {
    ctx.outgoing += released;
  } else {
    ctx.storage.set(edge.toNodeId, (ctx.storage.get(edge.toNodeId) ?? 0) + released);
  }
  return released;
}

function topoOrder(state: GameState): readonly WaterNode[] {
  const indegree = new Map<string, number>(state.waterNodes.map(node => [node.id, 0]));
  const adjacency = new Map<string, string[]>(state.waterNodes.map(node => [node.id, []]));
  for (const edge of state.waterEdges) {
    if (edge.toNodeId === null) continue;
    adjacency.get(edge.fromNodeId)!.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }
  const queue = state.waterNodes.map(node => node.id)
    .filter(id => (indegree.get(id) ?? 0) === 0).sort();
  const order: WaterNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(nodeById(state.waterNodes, id));
    for (const next of [...(adjacency.get(id) ?? [])].sort()) {
      const degree = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }
  return order;
}

// Phase 2: overflow. After inflow, withdrawal and gate releases, any node above
// its capacity spills along its outlets (topological order, stable edge id). A
// node that still overflows with no outlet capacity is a scenario error, not a
// silent truncation.
export function finishWater(state: GameState, ctx: WaterContext): WaterSettlement {
  const opening = state.ledger.water.closing;
  const order = topoOrder(state);
  const outlets = new Map<string, WaterEdge[]>();
  for (const edge of state.waterEdges) {
    const list = outlets.get(edge.fromNodeId) ?? [];
    list.push(edge);
    outlets.set(edge.fromNodeId, list);
  }
  for (const node of order) {
    const capacity = node.capacity;
    let excess = (ctx.storage.get(node.id) ?? 0) - capacity;
    if (excess <= 0) continue;
    const edges = [...(outlets.get(node.id) ?? [])].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    for (const edge of edges) {
      if (excess <= 0) break;
      const released = releaseThrough(ctx, edge, excess);
      excess -= released;
    }
    if (excess > 0) {
      throw new Error(`Water overflow at ${node.id} has no remaining outlet capacity`);
    }
  }
  let closing = 0;
  const nodes = state.waterNodes.map(node => {
    const storage = Math.min(node.capacity, ctx.storage.get(node.id) ?? 0);
    closing += storage;
    return { ...node, storage };
  });
  return {
    nodes,
    opening,
    incoming: ctx.incoming,
    consumed: ctx.consumed,
    outgoing: ctx.outgoing,
    closing,
    irrigationByRegion: ctx.irrigationByRegion,
  };
}

// Region irrigation fulfillment, 0..10000 basis points, used by agriculture.
export function irrigationFulfillmentBp(
  settlement: WaterSettlement, regionId: EntityId,
): number {
  const record = settlement.irrigationByRegion.get(regionId);
  if (record === undefined || record.requested <= 0) return 10000;
  return Math.floor(record.delivered * 10000 / record.requested);
}
