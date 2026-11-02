import { actionLaborDemands, type ActivityDemand } from './actors';
import type { GameState, LaborAllocation } from './types';

function splitProportional(total: number, weights: readonly number[]): readonly number[] {
  if (weights.length === 0) return [];
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0) return weights.map(() => 0);
  const parts = weights.map((weight, index) => {
    const numerator = total * weight;
    return { index, base: Math.floor(numerator / weightSum), remainder: numerator % weightSum };
  });
  let assigned = parts.reduce((sum, part) => sum + part.base, 0);
  const order = [...parts].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; assigned < total; index += 1) {
    order[index % order.length]!.base += 1;
    assigned += 1;
  }
  return parts.map(part => part.base);
}

export function projectLaborDemands(state: GameState): readonly ActivityDemand[] {
  const demands: ActivityDemand[] = [];
  for (const project of state.projects) {
    if (project.status !== 'active') continue;
    if (project.phase !== 'planned' && project.phase !== 'construction') continue;
    if (state.tick < project.startTick) continue;
    const remaining = project.workRequired - project.workCompleted;
    if (remaining <= 0) continue;
    const arrived = project.laborSources
      .filter(source => source.requested > 0 && state.tick >= source.arrivalTick)
      .sort((a, b) => a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0);
    if (arrived.length === 0) continue;
    const requested = Math.min(remaining, arrived.reduce((sum, source) => sum + source.requested, 0));
    const shares = splitProportional(requested, arrived.map(source => source.requested));
    const actorId = [...project.sponsorIds].sort()[0] ?? '';
    arrived.forEach((source, index) => {
      if ((shares[index] ?? 0) <= 0) return;
      demands.push({
        regionId: source.regionId,
        actorId,
        activityId: `project:${project.id}:${source.regionId}`,
        tier: project.laborMode === 'urgent' ? 1 : 4,
        requested: shares[index] ?? 0,
        weight: project.allocationWeight,
      });
    });
  }
  return demands;
}

export function maintenanceLaborDemands(state: GameState): readonly ActivityDemand[] {
  const demands: ActivityDemand[] = [];
  for (const reach of state.reaches) {
    if (reach.status !== 'active' || reach.maintenanceLabor <= 0) continue;
    const regionId = [...reach.regionIds].sort()[0];
    if (regionId === undefined) continue;
    const region = state.regions.find(candidate => candidate.id === regionId);
    if (region === undefined) continue;
    const surchargeBp = 10000 + Math.floor(
      reach.silt * state.parameters.labor.siltMaintenanceSurchargeBp / 10000);
    const requested = Math.ceil(reach.maintenanceLabor
      * state.parameters.labor.maintenanceMultiplierBp[reach.maintenance]
      * surchargeBp / 100000000);
    if (requested <= 0) continue;
    demands.push({
      regionId,
      actorId: region.actorId,
      activityId: `maintenance:${reach.id}`,
      tier: 3,
      requested,
      weight: 1,
    });
  }
  return demands;
}

// Safe disposal is a real, paid activity in the same labor ledger. A liability
// only progresses while its reach is in decommissioning; the required exit work
// is requested up to the configured minimum safety labor per period.
export function preservationLaborDemands(state: GameState): readonly ActivityDemand[] {
  const demands: ActivityDemand[] = [];
  const liabilities = [...state.liabilities]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const liability of liabilities) {
    if (liability.status !== 'unresolved') continue;
    const remaining = liability.exitWorkRequired - liability.exitWorkCompleted;
    if (remaining <= 0 || liability.minimumLabor <= 0) continue;
    const reach = state.reaches.find(candidate => candidate.id === liability.reachId);
    if (reach === undefined || reach.status !== 'decommissioning') continue;
    const regionId = [...reach.regionIds].sort()[0];
    if (regionId === undefined) continue;
    demands.push({
      regionId,
      actorId: liability.responsibleActorId,
      activityId: `preservation:${liability.id}`,
      tier: 3,
      requested: Math.min(remaining, liability.minimumLabor),
      weight: 1,
    });
  }
  return demands;
}

export interface WeightedDemand {
  activityId: string; requested: number; weight: number; cap?: number;
}

// Weighted water-filling within one tier. The competition weight is
// effectiveRequest x allocationWeight; `cap` (when supplied) limits how much
// that activity may actually receive. A capped activity is satisfied and
// removed, and the freed pool is redistributed among the remaining unmet
// demands. Integer leftovers use largest remainder, then activityId, so array
// insertion order never decides an allocation.
export function allocateWeighted(
  pool: number, demands: readonly WeightedDemand[],
): ReadonlyMap<string, number> {
  const allocations = new Map<string, number>();
  const active = demands
    .filter(demand => demand.requested > 0 && demand.weight > 0)
    .map(demand => ({
      activityId: demand.activityId,
      requested: demand.requested,
      competition: demand.requested * demand.weight,
      cap: Math.max(0, Math.min(demand.requested, demand.cap ?? demand.requested)),
    }));
  let remaining = Math.max(0, pool);
  while (remaining > 0 && active.length > 0) {
    const totalCompetition = active.reduce((sum, demand) => sum + demand.competition, 0);
    if (totalCompetition <= 0) break;
    const capped = active.filter(demand =>
      demand.cap * totalCompetition <= remaining * demand.competition);
    if (capped.length > 0) {
      for (const demand of capped) {
        allocations.set(demand.activityId, (allocations.get(demand.activityId) ?? 0) + demand.cap);
        remaining -= demand.cap;
      }
      const cappedIds = new Set(capped.map(demand => demand.activityId));
      for (let index = active.length - 1; index >= 0; index -= 1) {
        if (cappedIds.has(active[index]!.activityId)) active.splice(index, 1);
      }
      continue;
    }
    const parts = active.map(demand => {
      const numerator = remaining * demand.competition;
      return {
        demand,
        base: Math.floor(numerator / totalCompetition),
        remainder: numerator % totalCompetition,
      };
    });
    let assigned = 0;
    for (const part of parts) {
      allocations.set(part.demand.activityId,
        (allocations.get(part.demand.activityId) ?? 0) + part.base);
      assigned += part.base;
    }
    const order = [...parts].sort((a, b) => b.remainder - a.remainder
      || (a.demand.activityId < b.demand.activityId ? -1 : a.demand.activityId > b.demand.activityId ? 1 : 0));
    for (let index = 0; assigned < remaining; index += 1) {
      const target = order[index % order.length]!.demand.activityId;
      allocations.set(target, (allocations.get(target) ?? 0) + 1);
      assigned += 1;
    }
    remaining = 0;
  }
  return allocations;
}

export function allocateLabor(state: GameState, nextTick: number): readonly LaborAllocation[] {
  const external = [
    ...actionLaborDemands(state, nextTick),
    ...projectLaborDemands(state),
    ...maintenanceLaborDemands(state),
    ...preservationLaborDemands(state),
  ];
  const rows: LaborAllocation[] = [];
  for (const region of [...state.regions].sort((a, b) => a.id < b.id ? -1 : 1)) {
    let pool = region.laborCapacity;
    if (region.subsistenceLabor > 0) {
      const allocated = Math.min(pool, region.subsistenceLabor);
      rows.push({
        regionId: region.id, actorId: region.actorId,
        activityId: `subsistence:${region.id}`, requested: region.subsistenceLabor,
        allocated, unmet: region.subsistenceLabor - allocated,
      });
      pool -= allocated;
    }
    const tiers: readonly (1 | 2 | 3 | 4)[] = [1, 2, 3, 4];
    for (const tier of tiers) {
      const demands: ActivityDemand[] = external.filter(demand =>
        demand.regionId === region.id && demand.tier === tier);
      if (tier === 2 && region.agriculturalLabor > 0) {
        demands.push({
          regionId: region.id, actorId: region.actorId, activityId: `agriculture:${region.id}`,
          tier: 2, requested: region.agriculturalLabor, weight: 1,
        });
      }
      const sorted = demands.sort((a, b) =>
        a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0);
      const allocations = allocateWeighted(pool, sorted);
      let used = 0;
      for (const demand of sorted) {
        const allocated = allocations.get(demand.activityId) ?? 0;
        used += allocated;
        rows.push({
          regionId: region.id, actorId: demand.actorId, activityId: demand.activityId,
          requested: demand.requested, allocated, unmet: demand.requested - allocated,
        });
      }
      pool -= used;
      if (pool < 0) throw new Error('Labor allocation exceeded regional capacity');
    }
  }
  return rows.sort((a, b) => a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1
    : a.activityId < b.activityId ? -1 : a.activityId > b.activityId ? 1 : 0);
}

export function laborForActivity(
  rows: readonly LaborAllocation[], activityId: string,
): number {
  return rows.filter(row => row.activityId === activityId)
    .reduce((sum, row) => sum + row.allocated, 0);
}

export function projectLaborApplied(
  rows: readonly LaborAllocation[], projectId: string,
): number {
  return rows.filter(row => row.activityId.startsWith(`project:${projectId}:`))
    .reduce((sum, row) => sum + row.allocated, 0);
}

export function forcedLaborByRegion(rows: readonly LaborAllocation[]): ReadonlyMap<string, number> {
  const forced = new Map<string, number>();
  for (const row of rows) {
    if (row.activityId.startsWith('subsistence:') || row.activityId.startsWith('agriculture:')) continue;
    forced.set(row.regionId, (forced.get(row.regionId) ?? 0) + row.allocated);
  }
  return forced;
}
