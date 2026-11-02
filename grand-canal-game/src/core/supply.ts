import type {
  Demand, EntityId, GameState, Inventory, SupplyRule,
} from './types';

// Automatic supply (FR-08) is split into two explicit phases so time is never
// ambiguous:
//   1. generateSupplyDemands runs before labor and transport settlement. It
//      reads the destination inventory as it exists at the start of the tick
//      plus the cargo already reserved on active inbound batches. A stable key
//      is updated only for the real uncovered deficit.
//   2. consumeSupply runs after settleTransport has delivered or advanced every
//      batch. It consumes only cargo actually present, so its total is a real
//      ledger debit and an unmet amount is never invented.
// No rule has a price field and no UI/player command depends on one.

export function supplyDemandKey(ruleId: EntityId): string {
  return `supply:${ruleId}`;
}

export function supplyDemandId(ruleId: EntityId): string {
  return `demand:supply:${ruleId}`;
}

function byId<T extends { readonly id: string }>(values: readonly T[]): T[] {
  return [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function inventoryAtNode(state: GameState, nodeId: EntityId): Inventory | undefined {
  const node = state.transportNodes.find(candidate => candidate.id === nodeId);
  if (node === undefined) return undefined;
  return state.inventories.find(inventory => inventory.id === node.inventoryId);
}

// Cargo physically on its way to this destination is already committed supply.
// It must not be requested a second time, even while still at an intermediate
// node or when the journey spans several ticks. Only the rule owner's cargo
// counts; another actor's inbound stock cannot cover this owner's deficit.
function inboundReserved(state: GameState, rule: SupplyRule): number {
  const demandById = new Map(state.demands.map(demand => [demand.id, demand]));
  let reserved = 0;
  for (const batch of state.inTransit) {
    if (batch.ownerId !== rule.ownerId) continue;
    if (batch.cargo !== rule.cargo) continue;
    if (batch.status !== 'waiting' && batch.status !== 'travelling') continue;
    const demand = demandById.get(batch.demandId);
    if (demand !== undefined && demand.toNodeId === rule.destNodeId) reserved += batch.quantity;
  }
  return reserved;
}

// Creates or updates one demand per configured rule. The demand ID and key are
// derived from the stable rule ID, so a recurring need never spawns duplicates.
export function generateSupplyDemands(state: GameState): readonly Demand[] {
  const rules = byId(state.parameters.supply.rules);
  if (rules.length === 0) return state.demands;
  const demands = new Map(state.demands.map(demand => [demand.id, demand]));
  for (const rule of rules) {
    const demandKey = supplyDemandKey(rule.id);
    const existing = [...demands.values()].find(demand => demand.demandKey === demandKey);
    // An explicit cancellation is retained; automatic rules never override it.
    if (existing !== undefined && existing.status === 'cancelled') continue;
    const inventory = inventoryAtNode(state, rule.destNodeId);
    if (inventory === undefined) continue;
    const stock = inventory.ownerId === rule.ownerId ? inventory[rule.cargo] : 0;
    const reserved = inboundReserved(state, rule);
    const deficit = Math.max(0, rule.targetStock - stock - reserved);
    if (existing === undefined) {
      if (deficit <= 0) continue;
      const demand: Demand = {
        id: supplyDemandId(rule.id), demandKey, ownerId: rule.ownerId,
        fromNodeId: rule.sourceNodeId, toNodeId: rule.destNodeId,
        purpose: rule.purpose, cargo: rule.cargo, loadClass: 'standard',
        requested: deficit, fulfilled: 0, reservedInTransit: 0, cancelled: 0,
        deadlineTick: state.endTick, sourceEventId: null, status: 'active',
      };
      demands.set(demand.id, demand);
      continue;
    }
    // Counters stay cumulative. A renewed need raises requested above what has
    // already been delivered/reserved; an oversupplied destination trims the
    // undispatched request without cancelling cargo already in transit.
    const committed = existing.fulfilled + existing.reservedInTransit + existing.cancelled;
    const requested = committed + deficit;
    const status: Demand['status'] = deficit > 0 || existing.reservedInTransit > 0
      ? 'active' : 'fulfilled';
    demands.set(existing.id, { ...existing, requested, status });
  }
  return byId([...demands.values()]);
}

export interface SupplyConsumptionResult {
  inventories: readonly Inventory[];
  consumed: number;
}

// Settlement step after transport arrival. Each rule consumes at most its
// configured amount from the cargo that is actually present at the destination;
// stock is never allowed to go negative and the returned total is the exact
// amount the caller must add to the cargo ledger's consumed field.
export function consumeSupply(
  state: GameState, inventoriesAfterTransport: readonly Inventory[],
): SupplyConsumptionResult {
  const rules = byId(state.parameters.supply.rules);
  if (rules.length === 0) {
    return { inventories: inventoriesAfterTransport, consumed: 0 };
  }
  const inventories = new Map(inventoriesAfterTransport.map(inventory => [inventory.id, inventory]));
  let consumed = 0;
  for (const rule of rules) {
    const inventory = inventoryAtNode(state, rule.destNodeId);
    if (inventory === undefined) continue;
    const current = inventories.get(inventory.id);
    if (current === undefined || current.ownerId !== rule.ownerId) continue;
    const amount = Math.min(rule.consumptionPerTick, current[rule.cargo]);
    if (amount <= 0) continue;
    inventories.set(current.id, { ...current, [rule.cargo]: current[rule.cargo] - amount });
    consumed += amount;
  }
  return { inventories: byId([...inventories.values()]), consumed };
}
