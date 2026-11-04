import { loadRank } from './invariants';
import { TICKS_PER_YEAR } from './calendar';
import type { ActivityDemand } from './actors';
import type { WaterContext } from './water';
import { releaseBudget, releaseThrough } from './water';
import type {
  ActorState, CanalReachState, Demand, EntityId, GameState, Inventory, LaborAllocation,
  LoadClass, Purpose, ShipmentBatch, TransportEdge, TransportNode,
} from './types';

// Auto logistics (FR-08): demand -> deterministic route -> aggregate batches.
// A demand dispatches at most requested - fulfilled - reservedInTransit -
// cancelled; travel advances by real ticks (no same-tick arrival); shared edge
// and node capacity, lock water, and the shared labor budget are all decremented
// on actual departure. Cancelled/expired goods reach the next safe node and are
// returned to the owner's inventory, never dropped.

export interface TransportResult {
  demands: readonly Demand[];
  inTransit: readonly ShipmentBatch[];
  inventories: readonly Inventory[];
  actors: readonly ActorState[];
  cargoLoss: number;
}

interface Capacity {
  edgeRemaining: Map<string, number>;
  nodeRemaining: Map<string, number>;
  laborLoads: Map<string, number>;
}

function byId<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function nodeRegion(nodes: readonly TransportNode[], id: EntityId): EntityId {
  const node = nodes.find(candidate => candidate.id === id);
  if (node === undefined) throw new Error(`Unknown transport node ${id}`);
  return node.regionId;
}

// Transport labor is an estimate fed into the same shared labor budget before
// movement actually happens; actual loads moved can never exceed allocation.
export function transportLaborDemands(state: GameState): readonly ActivityDemand[] {
  const perLoad = state.parameters.transport.transitLaborPerLoad;
  if (perLoad <= 0) return [];
  const loadsByRegion = new Map<string, number>();
  const add = (regionId: string, loads: number): void => {
    if (loads > 0) loadsByRegion.set(regionId, (loadsByRegion.get(regionId) ?? 0) + loads);
  };
  // Loading labor is attributed to the origin region once at dispatch. The
  // estimate covers the whole outstanding demand (requested - fulfilled -
  // cancelled), which includes goods still in transit that may need loss
  // replenishment, so a same-tick replenish never lacks its labor budget.
  for (const demand of state.demands) {
    if (demand.status !== 'active') continue;
    const outstanding = demand.requested - demand.fulfilled - demand.cancelled;
    add(nodeRegion(state.transportNodes, demand.fromNodeId), outstanding);
  }
  const actorOf = new Map(state.regions.map(region => [region.id, region.actorId]));
  return [...loadsByRegion.entries()].map(([regionId, loads]) => ({
    regionId,
    actorId: actorOf.get(regionId) ?? '',
    activityId: `transport:${regionId}`,
    tier: 3 as const,
    requested: loads * perLoad,
    weight: 1,
  })).sort((a, b) => a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0);
}

function reachByTransportEdge(state: GameState): Map<string, CanalReachState> {
  const map = new Map<string, CanalReachState>();
  for (const reach of state.reaches) for (const edgeId of reach.transportEdgeIds) map.set(edgeId, reach);
  return map;
}

function edgeUsable(
  edge: TransportEdge, reach: CanalReachState | undefined,
  nextTick: number, purpose: Purpose, loadClass: LoadClass,
): boolean {
  if (!edge.available) return false;
  const period = (nextTick - 1) % TICKS_PER_YEAR;
  if (!edge.openPeriods.includes(period)) return false;
  if (loadRank(loadClass) > loadRank(edge.maxLoadClass)) return false;
  if (reach !== undefined) {
    if (reach.status !== 'active' || reach.silt >= 10000 || reach.damage >= 10000) return false;
    if (reach.closedUntil !== null && nextTick < reach.closedUntil) return false;
    if (!reach.schedule[purpose].includes(period)) return false;
    if (loadRank(loadClass) > loadRank(reach.maxLoadClass)) return false;
  }
  return true;
}

function pathKey(path: readonly string[]): string { return path.join(','); }

// Lowest combined cost route; ties resolve lexicographically so content order
// never decides a path.
function findRoute(
  edges: readonly TransportEdge[], reachByEdge: Map<string, CanalReachState>,
  fromId: EntityId, toId: EntityId, nextTick: number, purpose: Purpose, loadClass: LoadClass,
): readonly string[] | null {
  const outgoing = new Map<string, TransportEdge[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.fromNodeId) ?? [];
    list.push(edge);
    outgoing.set(edge.fromNodeId, list);
  }
  const best = new Map<string, { cost: number; path: string[] }>();
  best.set(fromId, { cost: 0, path: [] });
  const settled = new Set<string>();
  for (;;) {
    let current: string | null = null;
    for (const [id, entry] of best) {
      if (settled.has(id)) continue;
      const better = current === null
        || entry.cost < best.get(current)!.cost
        || (entry.cost === best.get(current)!.cost && pathKey(entry.path) < pathKey(best.get(current)!.path));
      if (better) current = id;
    }
    if (current === null) return null;
    settled.add(current);
    if (current === toId) return best.get(current)!.path;
    for (const edge of byId(outgoing.get(current) ?? [])) {
      const reach = reachByEdge.get(edge.id);
      if (!edgeUsable(edge, reach, nextTick, purpose, loadClass)) continue;
      const candidate = {
        cost: best.get(current)!.cost + edge.costPerLoad,
        path: [...best.get(current)!.path, edge.id],
      };
      const existing = best.get(edge.toNodeId);
      if (existing === undefined || candidate.cost < existing.cost
          || (candidate.cost === existing.cost && pathKey(candidate.path) < pathKey(existing.path))) {
        best.set(edge.toNodeId, candidate);
      }
    }
  }
}

function tighterLoadClass(a: LoadClass, b: LoadClass): LoadClass {
  return loadRank(a) <= loadRank(b) ? a : b;
}

export function settleTransport(
  state: GameState, nextTick: number, labor: readonly LaborAllocation[], water: WaterContext,
  actors: Map<string, ActorState>,
): TransportResult {
  const perLoad = state.parameters.transport.transitLaborPerLoad;
  const navMinLevel = state.parameters.water.navigationMinLevel;
  const maxBatch = state.parameters.transport.maxBatchSizeByClass;

  const demands = new Map(state.demands.map(demand => [demand.id, demand]));
  const inTransit = new Map(state.inTransit.map(batch => [batch.id, batch]));
  const inventories = new Map(state.inventories.map(inventory => [inventory.id, inventory]));

  const edgeById = new Map(state.transportEdges.map(edge => [edge.id, edge]));
  const nodeById = new Map(state.transportNodes.map(node => [node.id, node]));
  const waterEdgeById = new Map(state.waterEdges.map(edge => [edge.id, edge]));
  const reachByEdge = reachByTransportEdge(state);
  const regionActor = new Map(state.regions.map(region => [region.id, region.actorId]));

  const capacity: Capacity = {
    edgeRemaining: new Map(state.transportEdges.map(edge => {
      const reach = reachByEdge.get(edge.id);
      const condition = reach === undefined ? 1
        : (10000 - reach.silt) * (10000 - reach.damage) / 100000000;
      return [edge.id, Math.floor(edge.capacity * condition * (reach?.grade === 'heavy' ? 1.6 : reach?.grade === 'standard' ? 1.25 : 1))];
    })),
    nodeRemaining: new Map(state.transportNodes.map(node => [node.id, node.transferCapacity])),
    laborLoads: new Map(state.regions.map(region => [region.id, Number.POSITIVE_INFINITY])),
  };
  for (const region of state.regions) {
    const allocated = labor.filter(row => row.activityId === `transport:${region.id}`)
      .reduce((sum, row) => sum + row.allocated, 0);
    capacity.laborLoads.set(region.id,
      perLoad > 0 ? Math.floor(allocated / perLoad) : Number.POSITIVE_INFINITY);
  }

  let cargoLoss = 0;

  const adjustInventory = (inventoryId: string, cargo: 'grain' | 'materials' | 'goods', delta: number): void => {
    const inventory = inventories.get(inventoryId);
    if (inventory === undefined) throw new Error(`Unknown inventory ${inventoryId}`);
    inventories.set(inventoryId, {
      ...inventory, [cargo]: Math.max(0, (inventory[cargo]??0) + delta),
    });
  };

  // Cancelled/expired goods finish the current edge to the next safe node, then
  // return to that node's inventory only when it is owned by the demand owner.
  // Otherwise they are held at the node — never teleported to a distant stock.
  const returnToLocal = (demand: Demand, node: TransportNode, quantity: number): boolean => {
    if (quantity <= 0) return true;
    const local = inventories.get(node.inventoryId);
    if (local !== undefined && local.ownerId === demand.ownerId) {
      adjustInventory(local.id, demand.cargo, quantity);
      return true;
    }
    return false;
  };

  const payCost = (batch: ShipmentBatch, edge: TransportEdge, amount: number): void => {
    const cost = amount * edge.costPerLoad;
    if (cost <= 0) return;
    const owner = actors.get(batch.ownerId);
    const fromNode = nodeById.get(edge.fromNodeId);
    if (owner === undefined || fromNode === undefined) return;
    // Departure is pre-capped for cross-actor tolls, so this never under-pays.
    actors.set(owner.id, { ...owner, treasury: owner.treasury - cost });
    const creditId = regionActor.get(fromNode.regionId);
    if (creditId !== undefined) {
      const credit = actors.get(creditId);
      if (credit !== undefined) actors.set(creditId, { ...credit, treasury: credit.treasury + cost });
    }
  };

  // Departure onto `edge`; returns the amount actually loaded (0 => wait).
  const depart = (
    batch: ShipmentBatch, edge: TransportEdge, amount: number,
  ): { batch: ShipmentBatch; amount: number } => {
    let limit = Math.max(0, amount);
    limit = Math.min(limit, capacity.edgeRemaining.get(edge.id) ?? 0);
    limit = Math.min(limit, capacity.nodeRemaining.get(edge.fromNodeId) ?? 0);
    const waterEdge = edge.waterEdgeId === null ? undefined : waterEdgeById.get(edge.waterEdgeId);
    if (waterEdge !== undefined && waterEdge.controlled) {
      if (!waterEdge.available) {
        limit = 0; // a closed lock blocks its transport edge entirely
      } else {
        const upstreamLevel = state.waterNodes.find(node => node.id === waterEdge.fromNodeId)?.level ?? 0;
        if (upstreamLevel < navMinLevel) limit = 0;
        else if (edge.waterPerLoad > 0) {
          limit = Math.min(limit, Math.floor(releaseBudget(water, waterEdge) / edge.waterPerLoad));
        }
      }
    }
    // A cross-actor toll must be payable in full to depart; internal transport
    // (owner serves its own region) is a wash and is not limited by treasury.
    const fromNode = nodeById.get(edge.fromNodeId);
    const creditActorId = fromNode === undefined ? undefined : regionActor.get(fromNode.regionId);
    if (creditActorId !== undefined && creditActorId !== batch.ownerId && edge.costPerLoad > 0) {
      const owner = actors.get(batch.ownerId);
      limit = owner === undefined ? 0 : Math.min(limit, Math.floor(owner.treasury / edge.costPerLoad));
    }
    if (limit <= 0) return { batch, amount: 0 };
    capacity.edgeRemaining.set(edge.id, (capacity.edgeRemaining.get(edge.id) ?? 0) - limit);
    capacity.nodeRemaining.set(edge.fromNodeId, (capacity.nodeRemaining.get(edge.fromNodeId) ?? 0) - limit);
    if (waterEdge !== undefined && waterEdge.controlled && waterEdge.available && edge.waterPerLoad > 0) {
      const released = releaseThrough(water, waterEdge, limit * edge.waterPerLoad);
      if (released < limit * edge.waterPerLoad) {
        throw new Error('Lock water release did not match navigation budget');
      }
    }
    payCost(batch, edge, limit);
    return {
      batch: {
        ...batch,
        currentNodeId: edge.fromNodeId,
        routeIndex: batch.routeIndex,
        remainingTravelTicks: edge.travelTicks,
        status: 'travelling',
      },
      amount: limit,
    };
  };

  // Phase A: mark demands whose deadline has passed.
  for (const [id, demand] of [...demands]) {
    if (demand.status !== 'active') continue;
    if (nextTick > demand.deadlineTick) {
      const dispatchable = demand.requested - demand.fulfilled
        - demand.reservedInTransit - demand.cancelled;
      demands.set(id, {
        ...demand, status: 'expired', cancelled: demand.cancelled + Math.max(0, dispatchable),
      });
    }
  }

  // Phase B: advance in-transit batches.
  for (const original of byId([...inTransit.values()])) {
    const batch = inTransit.get(original.id);
    if (batch === undefined) continue;
    const demand = demands.get(batch.demandId);
    if (demand === undefined) continue;
    if (batch.status === 'travelling') {
      const edge = edgeById.get(batch.routeEdgeIds[batch.routeIndex] ?? '');
      if (edge === undefined) throw new Error('Batch route references unknown edge');
      const remaining = batch.remainingTravelTicks - 1;
      if (remaining > 0) {
        inTransit.set(batch.id, { ...batch, remainingTravelTicks: remaining });
        continue;
      }
      const toNode = nodeById.get(edge.toNodeId);
      if (toNode === undefined) throw new Error('Batch route references unknown node');
      const loss = Math.floor(batch.quantity * edge.lossRate / 10000);
      const quantity = batch.quantity - loss;
      const lost = batch.lost + loss;
      cargoLoss += loss;
      if (loss > 0) {
        demands.set(demand.id, {
          ...demands.get(demand.id)!, reservedInTransit: Math.max(0, demand.reservedInTransit - loss),
        });
      }
      const currentDemand = demands.get(demand.id)!;
      const arrived: ShipmentBatch = {
        ...batch, quantity, lost, currentNodeId: toNode.id, remainingTravelTicks: 0,
      };
      if (currentDemand.status !== 'active') {
        const returned = returnToLocal(currentDemand, toNode, quantity);
        if (returned) {
          demands.set(currentDemand.id, {
            ...currentDemand,
            reservedInTransit: Math.max(0, currentDemand.reservedInTransit - quantity),
          });
          inTransit.set(batch.id, { ...arrived, status: 'returned', routeIndex: batch.routeEdgeIds.length });
        } else {
          // Hold at the next safe node; ownership and occupancy persist.
          inTransit.set(batch.id, {
            ...arrived,
            status: 'waiting',
            routeIndex: Math.min(batch.routeIndex + 1, batch.routeEdgeIds.length),
          });
        }
        continue;
      }
      if (batch.routeIndex >= batch.routeEdgeIds.length - 1) {
        adjustInventory(toNode.inventoryId, batch.cargo, quantity);
        const delivered = currentDemand.fulfilled + quantity;
        demands.set(currentDemand.id, {
          ...currentDemand,
          fulfilled: delivered,
          reservedInTransit: Math.max(0, currentDemand.reservedInTransit - quantity),
          status: delivered >= currentDemand.requested ? 'fulfilled' : 'active',
        });
        inTransit.set(batch.id, { ...arrived, status: 'delivered', routeIndex: batch.routeEdgeIds.length });
        continue;
      }
      // Intermediate node: try the next edge now.
      const nextIndex = batch.routeIndex + 1;
      const nextEdge = edgeById.get(batch.routeEdgeIds[nextIndex] ?? '');
      if (nextEdge === undefined) throw new Error('Batch route references unknown edge');
      const reach = reachByEdge.get(nextEdge.id);
      if (!edgeUsable(nextEdge, reach, nextTick, batch.purpose, batch.loadClass)) {
        inTransit.set(batch.id, { ...arrived, routeIndex: nextIndex, status: 'waiting' });
        continue;
      }
      const departed = depart({ ...arrived, routeIndex: nextIndex }, nextEdge, quantity);
      if (departed.amount <= 0) {
        inTransit.set(batch.id, { ...arrived, routeIndex: nextIndex, status: 'waiting' });
      } else {
        inTransit.set(batch.id, { ...departed.batch, quantity });
      }
      continue;
    }
    if (batch.status === 'waiting') {
      if (demand.status !== 'active') {
        const node = nodeById.get(batch.currentNodeId);
        if (node !== undefined && returnToLocal(demand, node, batch.quantity)) {
          demands.set(demand.id, {
            ...demand, reservedInTransit: Math.max(0, demand.reservedInTransit - batch.quantity),
          });
          inTransit.set(batch.id, { ...batch, status: 'returned', routeIndex: batch.routeEdgeIds.length });
        }
        // Otherwise the cargo stays held at the current safe node.
        continue;
      }
      const edge = edgeById.get(batch.routeEdgeIds[batch.routeIndex] ?? '');
      if (edge === undefined) throw new Error('Batch route references unknown edge');
      const reach = reachByEdge.get(edge.id);
      if (!edgeUsable(edge, reach, nextTick, batch.purpose, batch.loadClass)) continue;
      const departed = depart(batch, edge, batch.quantity);
      if (departed.amount > 0) inTransit.set(batch.id, departed.batch);
    }
  }

  // Phase C: dispatch new batches for active demands.
  let seq = 0;
  const queue=byId([...demands.values()]);
  if (queue.some(d => d.cargo === 'goods')) {
    const favoredCargo = nextTick % 2 === 0 ? 'goods' : 'grain';
    queue.sort((a, b) => Number(b.cargo === favoredCargo) - Number(a.cargo === favoredCargo));
  }
  for (const original of queue) {
    let choices=[...state.transportEdges];
    while(choices.length){
    const demand = demands.get(original.id);
    if (demand === undefined || demand.status !== 'active') break;
    const dispatchable = demand.requested - demand.fulfilled
      - demand.reservedInTransit - demand.cancelled;
    if (dispatchable <= 0) break;
    // Routing is load-class permissive: a heavier shipment transships down to the
    // route's tightest grade (split below), so load class never blocks a path.
    const route = findRoute(choices.filter(e=>(capacity.edgeRemaining.get(e.id)??0)>0), reachByEdge,
      demand.fromNodeId, demand.toNodeId, nextTick, demand.purpose, 'small');
    if (route === null || route.length === 0) break;
    choices=choices.filter(e=>e.id!==route[0]);
    let routeMinClass: LoadClass = 'heavy';
    for (const edgeId of route) {
      const edge = edgeById.get(edgeId);
      if (edge === undefined) continue;
      routeMinClass = tighterLoadClass(routeMinClass, edge.maxLoadClass);
      const reach = reachByEdge.get(edgeId);
      if (reach !== undefined) routeMinClass = tighterLoadClass(routeMinClass, reach.maxLoadClass);
    }
    const shipClass = tighterLoadClass(demand.loadClass, routeMinClass);
    const firstEdge = edgeById.get(route[0] ?? '');
    if (firstEdge === undefined) continue;
    const firstReach = reachByEdge.get(firstEdge.id);
    if (!edgeUsable(firstEdge, firstReach, nextTick, demand.purpose, shipClass)) continue;
    let q = dispatchable;
    const fromNode = nodeById.get(demand.fromNodeId);
    if (fromNode === undefined) continue;
    q = Math.min(q, capacity.nodeRemaining.get(demand.fromNodeId) ?? 0);
    q = Math.min(q, capacity.laborLoads.get(fromNode.regionId) ?? 0);
    for (const edgeId of route) {
      const edge = edgeById.get(edgeId);
      if (edge === undefined) continue;
      q = Math.min(q, capacity.edgeRemaining.get(edge.id) ?? 0);
    }
    for (const edgeId of route) {
      const edge = edgeById.get(edgeId);
      if (edge === undefined) continue;
      const waterEdge = edge.waterEdgeId === null ? undefined : waterEdgeById.get(edge.waterEdgeId);
      if (waterEdge !== undefined && waterEdge.controlled) {
        if (!waterEdge.available) { q = 0; break; }
        if (edge.waterPerLoad > 0) {
          const upstreamLevel = state.waterNodes.find(node => node.id === waterEdge.fromNodeId)?.level ?? 0;
          if (upstreamLevel < navMinLevel) { q = 0; break; }
          q = Math.min(q, Math.floor(releaseBudget(water, waterEdge) / edge.waterPerLoad));
        }
      }
    }
    if (q <= 0) continue;
    const sourceInventory = inventories.get(fromNode.inventoryId);
    if (sourceInventory === undefined) continue;
    // Source stock must belong to the demand owner; there is no implicit transfer.
    if (sourceInventory.ownerId !== demand.ownerId) continue;
    q = Math.min(q, sourceInventory[demand.cargo]??0);
    // First-edge toll (cross-actor) is a hard departure constraint.
    const firstFromNode = nodeById.get(firstEdge.fromNodeId);
    const firstCredit = firstFromNode === undefined ? undefined : regionActor.get(firstFromNode.regionId);
    if (firstCredit !== undefined && firstCredit !== demand.ownerId && firstEdge.costPerLoad > 0) {
      const owner = actors.get(demand.ownerId);
      q = owner === undefined ? 0 : Math.min(q, Math.floor(owner.treasury / firstEdge.costPerLoad));
    }
    if (q <= 0) continue;
    const batchSize = maxBatch[shipClass] > 0 ? maxBatch[shipClass] : q;
    const chunks: number[] = [];
    let remainingQ = q;
    while (remainingQ > 0) {
      const chunk = Math.min(batchSize, remainingQ);
      chunks.push(chunk);
      remainingQ -= chunk;
    }
    const headId = `batch:${demand.id}:t${nextTick}:${seq}`;
    const subBatches: ShipmentBatch[] = [];
    chunks.forEach((chunk, index) => {
      const id = index === 0 ? headId : `${headId}.${index}`;
      const seed: ShipmentBatch = {
        id, parentId: index === 0 ? null : headId, demandId: demand.id, ownerId: demand.ownerId,
        purpose: demand.purpose, cargo: demand.cargo, loadClass: shipClass,
        quantity: chunk, lost: 0, routeEdgeIds: route, routeIndex: 0,
        currentNodeId: demand.fromNodeId, remainingTravelTicks: 0, status: 'waiting',
      };
      const departed = depart(seed, firstEdge, chunk);
      if (departed.amount !== chunk) {
        throw new Error('Dispatch departure exceeded the precomputed budget');
      }
      subBatches.push(departed.batch);
    });
    adjustInventory(sourceInventory.id, demand.cargo, -q);
    capacity.laborLoads.set(fromNode.regionId, (capacity.laborLoads.get(fromNode.regionId) ?? 0) - q);
    demands.set(demand.id, { ...demand, reservedInTransit: demand.reservedInTransit + q });
    for (const subBatch of subBatches) inTransit.set(subBatch.id, subBatch);
    seq += 1;
    }
  }

  return {
    demands: byId([...demands.values()]),
    inTransit: byId([...inTransit.values()]),
    inventories: byId([...inventories.values()]),
    actors: byId([...actors.values()]),
    cargoLoss,
  };
}
