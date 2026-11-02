import { loadRank, splitEven } from './invariants';
import { TICKS_PER_YEAR } from './calendar';
import type {
  BalanceParameters, CanalReachState, EntityId,
  LoadClass, PassagePolicy, PreservationLiability, ProjectKind, ProjectLaborSource,
  ProjectState, Purpose, Tick,
} from './types';

export type ProjectSite = { regionId: EntityId; inventoryId: EntityId };

export function nextLoadClass(value: LoadClass): LoadClass {
  return value === 'small' ? 'standard' : value === 'standard' ? 'heavy' : 'heavy';
}

export function reachById(reaches: readonly CanalReachState[], id: EntityId): CanalReachState | undefined {
  return reaches.find(reach => reach.id === id);
}

export function siteRegionIdFor(
  reaches: readonly CanalReachState[], reachIds: readonly EntityId[],
): EntityId | null {
  const regions = new Set<EntityId>();
  for (const reachId of reachIds) {
    const reach = reaches.find(candidate => candidate.id === reachId);
    if (reach === undefined) continue;
    for (const regionId of reach.regionIds) regions.add(regionId);
  }
  return [...regions].sort()[0] ?? null;
}

export function workRequiredFor(
  parameters: BalanceParameters, kind: ProjectKind, grade: LoadClass, reachCount: number,
): number {
  const base = parameters.projects.workUnitsByGrade[grade];
  const multiplier = parameters.projects.workMultiplierByKindBp[kind];
  return Math.ceil(base * multiplier * reachCount / 10000);
}

export function baseLaborRequest(
  parameters: BalanceParameters, grade: LoadClass, mode: 'normal' | 'urgent',
): number {
  const base = parameters.labor.normalProjectLaborUnitsByGrade[grade];
  return mode === 'urgent'
    ? Math.ceil(base * parameters.labor.urgentLaborMultiplierBp / 10000)
    : base;
}

export function laborSourcesFor(
  parameters: BalanceParameters, regionIds: readonly EntityId[], siteRegionId: EntityId,
  startTick: Tick, request: number,
): readonly ProjectLaborSource[] {
  const sorted = [...regionIds].sort();
  const shares = splitEven(request, sorted);
  return sorted.map((regionId, index) => ({
    regionId,
    requested: shares[index] ?? 0,
    arrived: 0,
    arrivalTick: startTick + (regionId === siteRegionId ? 0 : parameters.labor.remoteArrivalTicks),
  }));
}

export interface CompletionBounds {
  earliestCompletionTick: Tick; latestCompletionTick: Tick;
}

export function completionBounds(
  parameters: BalanceParameters, startTick: Tick, workRequired: number,
  laborPerTick: number, remoteDelay: number,
): CompletionBounds {
  const rate = Math.max(1, laborPerTick);
  const earliestTicks = Math.ceil(workRequired / rate);
  const reduced = Math.max(1, Math.floor(rate
    * (10000 - parameters.projects.completionUncertaintyBp) / 10000));
  const latestTicks = Math.ceil(workRequired / reduced);
  const trials = parameters.projects.trialTicks;
  return {
    earliestCompletionTick: startTick + remoteDelay + earliestTicks + trials,
    latestCompletionTick: startTick + remoteDelay + latestTicks + trials,
  };
}

export function passagePriority(policy: PassagePolicy, allowed: readonly Purpose[]): readonly Purpose[] {
  const order: readonly Purpose[] = policy === 'official_first'
    ? ['official', 'civil', 'trade']
    : policy === 'civil_first'
      ? ['civil', 'official', 'trade']
      // Balanced has no policy preference. Its lexical tie-break is explicit so
      // that array insertion order can never decide a shared-capacity conflict.
      : ['civil', 'official', 'trade'];
  return order.filter(purpose => allowed.includes(purpose));
}

export interface PassageStatus {
  periodOfYear: number;
  closed: boolean;
  open: boolean;
  loadEligible: boolean;
  allowedPurposes: readonly Purpose[];
  priority: readonly Purpose[];
}

export function passageStatusAt(
  reach: CanalReachState, tick: Tick, loadClass: LoadClass,
): PassageStatus {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new RangeError('Invalid passage tick');
  const periodOfYear = tick % TICKS_PER_YEAR;
  const closed = reach.closedUntil !== null && tick < reach.closedUntil;
  const allowed = (['official', 'civil', 'trade'] as const).filter(
    purpose => reach.schedule[purpose].includes(periodOfYear));
  const loadEligible = loadRank(loadClass) <= loadRank(reach.maxLoadClass);
  return {
    periodOfYear,
    closed,
    open: !closed && allowed.length > 0,
    loadEligible,
    allowedPurposes: allowed,
    priority: passagePriority(reach.passage, allowed),
  };
}

export function preservationMinimum(
  parameters: BalanceParameters, grade: LoadClass,
): { minimumLabor: number; minimumTreasury: number; exitWorkRequired: number } {
  const rules = parameters.projects.preservation[grade];
  return {
    minimumLabor: rules.minimumLaborUnits,
    minimumTreasury: rules.minimumTreasuryUnits,
    exitWorkRequired: Math.ceil(parameters.projects.workUnitsByGrade[grade]
      * rules.exitWorkFractionBp / 10000),
  };
}

export function makePreservationLiability(
  parameters: BalanceParameters, reach: CanalReachState, projectId: EntityId | null,
  responsibleActorId: EntityId, cause: PreservationLiability['cause'], reservedTreasury: number,
): PreservationLiability {
  const minimum = preservationMinimum(parameters, reach.grade);
  return {
    id: `liability:${cause}:${projectId ?? 'reach'}:${reach.id}`,
    reachId: reach.id, projectId, responsibleActorId, cause,
    minimumLabor: minimum.minimumLabor, minimumTreasury: minimum.minimumTreasury,
    reservedTreasury,
    exitWorkRequired: minimum.exitWorkRequired, exitWorkCompleted: 0,
    risk: reservedTreasury >= minimum.minimumTreasury ? 0 : 10000,
    status: 'unresolved',
  };
}

export function projectRemoteDelay(
  project: ProjectState, siteRegionId: EntityId | null,
): number {
  if (siteRegionId === null) return 0;
  return project.laborSources
    .filter(source => source.regionId !== siteRegionId)
    .reduce((delay, source) => Math.max(delay, source.arrivalTick - project.startTick), 0);
}

export function trialReachEffects(
  parameters: BalanceParameters, reaches: readonly CanalReachState[],
  project: ProjectState,
): {
  reaches: readonly CanalReachState[];
  liabilities: readonly PreservationLiability[];
} {
  const liabilitySeed = project.sponsorIds.length > 0 ? [...project.sponsorIds].sort()[0]! : '';
  const updated = reaches.map(reach => {
    if (!project.reachIds.includes(reach.id)) return reach;
    if (project.kind === 'dredge') {
      // Physical effect is grade-dependent: a small dredge leaves residual
      // silt, while a larger one removes a larger share. These shares are
      // experimental coefficients, not measured historical capacities.
      const reductionBp = parameters.projects.dredgeSiltReductionBpByGrade[project.grade];
      const removed = Math.ceil(reach.silt * reductionBp / 10000);
      return { ...reach, status: 'active' as const, silt: Math.max(0, reach.silt - removed) };
    }
    if (project.kind === 'build') return { ...reach, status: 'active' as const };
    if (project.kind === 'upgrade') {
      return { ...reach, status: 'active' as const, grade: nextLoadClass(reach.grade),
        maxLoadClass: nextLoadClass(reach.maxLoadClass) };
    }
    return { ...reach, status: 'active' as const };
  });
  const liabilities: PreservationLiability[] = [];
  const oldReachId = project.replacesReachId;
  if (oldReachId !== null) {
    const oldReach = reaches.find(reach => reach.id === oldReachId);
    if (oldReach !== undefined && oldReach.status !== 'retired'
        && !project.reachIds.includes(oldReach.id)) {
      const index = updated.findIndex(reach => reach.id === oldReach.id);
      if (index >= 0) {
        updated[index] = { ...updated[index]!, status: 'decommissioning' };
        liabilities.push(makePreservationLiability(parameters, updated[index]!,
          project.id, liabilitySeed, 'reroute', 0));
      }
    }
  }
  return { reaches: updated, liabilities };
}
