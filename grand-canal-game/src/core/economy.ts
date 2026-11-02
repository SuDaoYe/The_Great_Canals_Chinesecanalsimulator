import { transitionActions } from './actors';
import { forcedLaborByRegion, allocateLabor, laborForActivity, projectLaborApplied } from './labor';
import { siteRegionIdFor, trialReachEffects } from './projects';
import type {
  ActorState, AgricultureLoss, CanalReachState, Commitment, GameState, Inventory, LaborAllocation,
  PreservationLiability, ProjectState, RegionState, TickLedger,
} from './types';

export interface TickSettlement {
  regions: readonly RegionState[];
  actors: GameState['actors'];
  actions: GameState['actions'];
  projects: readonly ProjectState[];
  commitments: readonly Commitment[];
  inventories: readonly Inventory[];
  reaches: readonly CanalReachState[];
  liabilities: readonly PreservationLiability[];
  ledger: TickLedger;
}

function projectSite(  regions: readonly RegionState[], reaches: readonly CanalReachState[],
  project: ProjectState,
): { region: RegionState; inventoryId: string } | null {
  const regionId = siteRegionIdFor(reaches, project.reachIds);
  if (regionId === null) return null;
  const region = regions.find(candidate => candidate.id === regionId);
  if (region === undefined) return null;
  return { region, inventoryId: region.inventoryId };
}

// Human actions may hold revocable commitments to future disbursement. At the
// first settlement of the action's effective tick, only the unused reserved
// share is returned; already consumed value is not refunded and hard escrow is
// never confiscated. The link is explicit through ActorAction.commitmentIds.
function withdrawRevocableActionCommitments(
  state: GameState, nextTick: number,
  commitments: Map<string, Commitment>, actors: Map<string, ActorState>,
): void {
  const actions = [...state.actions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const action of actions) {
    if (nextTick < action.startTick || nextTick >= action.endTick) continue;
    if (action.phase === 'cancelled' || action.phase === 'completed' || action.phase === 'escalated') continue;
    for (const commitmentId of [...action.commitmentIds].sort()) {
      const commitment = commitments.get(commitmentId);
      if (commitment === undefined || commitment.firmness !== 'revocable'
          || commitment.status === 'withdrawn') continue;
      const refund = commitment.reserved;
      if (refund <= 0) continue;
      const actor = actors.get(commitment.actorId);
      if (actor === undefined) throw new Error('Revocable commitment references unknown funder');
      actors.set(actor.id, { ...actor, treasury: actor.treasury + refund });
      commitments.set(commitment.id, {
        ...commitment, reserved: 0, refunded: commitment.refunded + refund,
        status: 'withdrawn',
      });
    }
  }
}

function consumeRetainedCommitments(
  project: ProjectState, amount: number, commitments: Map<string, Commitment>,
): number {
  let remaining = Math.max(0, amount);
  for (const commitmentId of [...project.commitmentIds].sort()) {
    const commitment = commitments.get(commitmentId);
    if (commitment === undefined || remaining <= 0) continue;
    const take = Math.min(commitment.reserved, remaining);
    if (take <= 0) continue;
    const reserved = commitment.reserved - take;
    const consumed = commitment.consumed + take;
    commitments.set(commitmentId, {
      ...commitment, reserved, consumed,
      status: reserved === 0 && consumed === commitment.amount ? 'fulfilled' : 'escrowed',
    });
    remaining -= take;
  }
  return Math.max(0, amount) - remaining;
}

function refundRetainedCommitments(
  project: ProjectState, amount: number, commitments: Map<string, Commitment>,
  actors: Map<string, ActorState>,
): number {
  let remaining = Math.max(0, amount);
  for (const commitmentId of [...project.commitmentIds].sort()) {
    const commitment = commitments.get(commitmentId);
    if (commitment === undefined || remaining <= 0) continue;
    const refund = Math.min(commitment.reserved, remaining);
    if (refund <= 0) continue;
    const actor = actors.get(commitment.actorId);
    if (actor === undefined) throw new Error('Retained commitment references unknown funder');
    actors.set(actor.id, { ...actor, treasury: actor.treasury + refund });
    const reserved = commitment.reserved - refund;
    commitments.set(commitment.id, {
      ...commitment, reserved, refunded: commitment.refunded + refund,
      status: reserved === 0 ? 'withdrawn' : 'escrowed',
    });
    remaining -= refund;
  }
  return Math.max(0, amount) - remaining;
}

export function runTickSettlement(state: GameState, nextTick: number): TickSettlement {
  const parameters = state.parameters;
  const inventories = new Map(state.inventories.map(inventory => [inventory.id, inventory]));
  const commitments = new Map(state.commitments.map(commitment => [commitment.id, commitment]));
  const projects = new Map(state.projects.map(project => [project.id, project]));
  const liabilities = new Map(state.liabilities.map(liability => [liability.id, liability]));
  const actors = new Map(state.actors.map(actor => [actor.id, actor]));
  withdrawRevocableActionCommitments(state, nextTick, commitments, actors);
  const labor: readonly LaborAllocation[] = allocateLabor(state, nextTick);
  const forced = forcedLaborByRegion(labor);
  let reaches: readonly CanalReachState[] = state.reaches;
  const actions = transitionActions(state, nextTick);
  let grainProduced = 0;
  let grainConsumed = 0;
  let materialsConsumed = 0;

  const replaceReach = (id: string, update: (reach: CanalReachState) => CanalReachState): void => {
    reaches = reaches.map(reach => reach.id === id ? update(reach) : reach);
  };

  const orderedProjects = [...state.projects].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const original of orderedProjects) {
    const project = projects.get(original.id);
    if (project === undefined || project.status === 'cancelled') continue;
    if (project.status === 'paused') {
      if (project.workCompleted > 0) {
        for (const reachId of project.reachIds) {
          replaceReach(reachId, reach => ({
            ...reach,
            damage: Math.min(10000, reach.damage + parameters.projects.pausedDamageBpPerTick),
          }));
        }
      }
      continue;
    }
    if (project.phase === 'trial') {
      const remaining = project.trialTicksRemaining - 1;
      if (remaining > 0) {
        projects.set(project.id, { ...project, trialTicksRemaining: remaining });
      } else {
        const effects = trialReachEffects(parameters, reaches, project);
        reaches = effects.reaches;
        for (const liability of effects.liabilities) {
          if (!liabilities.has(liability.id)) liabilities.set(liability.id, liability);
        }
        projects.set(project.id, { ...project, phase: 'operating', trialTicksRemaining: 0 });
      }
      continue;
    }
    if (project.phase !== 'planned' && project.phase !== 'construction') continue;
    if (state.tick < project.startTick) continue;

    const site = projectSite(state.regions, reaches, project);
    const siteInventory = site === null ? undefined : inventories.get(site.inventoryId);
    const applied = projectLaborApplied(labor, project.id);
    const remainingWork = project.workRequired - project.workCompleted;
    const reservedTreasury = project.commitmentIds
      .map(id => commitments.get(id)?.reserved ?? 0)
      .reduce((sum, value) => sum + value, 0);
    const treasuryPerWork = parameters.projects.treasuryUnitsPerWork;
    const grainPerWork = parameters.projects.grainUnitsPerWork;
    const materialPerWork = parameters.projects.materialUnitsPerWork;
    const limits = [applied, remainingWork];
    if (treasuryPerWork > 0) limits.push(Math.floor(reservedTreasury / treasuryPerWork));
    if (grainPerWork > 0 && siteInventory !== undefined) {
      limits.push(Math.floor(siteInventory.grain / grainPerWork));
    }
    if (materialPerWork > 0 && siteInventory !== undefined) {
      limits.push(Math.floor(siteInventory.materials / materialPerWork));
    }
    if (siteInventory === undefined) limits.push(0);
    const work = Math.max(0, Math.min(...limits));
    let phase = project.phase;
    if (phase === 'planned') phase = 'construction';
    const arrivedSources = project.laborSources.map(source => state.tick >= source.arrivalTick
      ? { ...source, arrived: source.requested }
      : source);
    let updated: ProjectState = { ...project, phase, laborSources: arrivedSources };
    if (work > 0 && siteInventory !== undefined) {
      let treasuryCost = work * treasuryPerWork;
      for (const commitmentId of [...project.commitmentIds].sort()) {
        const commitment = commitments.get(commitmentId);
        if (commitment === undefined || treasuryCost <= 0) continue;
        const take = Math.min(commitment.reserved, treasuryCost);
        if (take <= 0) continue;
        const nextReserved = commitment.reserved - take;
        const consumed = commitment.consumed + take;
        commitments.set(commitmentId, {
          ...commitment, reserved: nextReserved, consumed,
          status: nextReserved === 0 && consumed === commitment.amount ? 'fulfilled' : 'escrowed',
        });
        treasuryCost -= take;
      }
      if (treasuryCost !== 0) throw new Error('Project work exceeded its escrowed commitment');
      const grainUsed = work * grainPerWork;
      const materialsUsed = work * materialPerWork;
      inventories.set(siteInventory.id, {
        ...siteInventory,
        grain: siteInventory.grain - grainUsed,
        materials: siteInventory.materials - materialsUsed,
      });
      grainConsumed += grainUsed;
      materialsConsumed += materialsUsed;
      updated = {
        ...updated,
        workCompleted: updated.workCompleted + work,
        grainSpent: updated.grainSpent + grainUsed,
        materialsSpent: updated.materialsSpent + materialsUsed,
        treasurySpent: updated.treasurySpent + work * treasuryPerWork,
      };
    }
    if (updated.workCompleted >= updated.workRequired) {
      if (parameters.projects.trialTicks > 0) {
        updated = { ...updated, phase: 'trial', trialTicksRemaining: parameters.projects.trialTicks };
      } else {
        const effects = trialReachEffects(parameters, reaches, updated);
        reaches = effects.reaches;
        for (const liability of effects.liabilities) {
          if (!liabilities.has(liability.id)) liabilities.set(liability.id, liability);
        }
        updated = { ...updated, phase: 'operating', trialTicksRemaining: 0 };
      }
    }
    projects.set(project.id, updated);
  }

  const orderedLiabilities = [...state.liabilities]
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const original of orderedLiabilities) {
    let liability = liabilities.get(original.id);
    if (liability === undefined || liability.status !== 'unresolved') continue;
    const reachIndex = reaches.findIndex(candidate => candidate.id === liability!.reachId);
    if (reachIndex < 0) continue;
    let reach = reaches[reachIndex]!;
    if (reach.status !== 'decommissioning') continue;
    const regionId = [...reach.regionIds].sort()[0];
    if (regionId === undefined) continue;
    const region = state.regions.find(candidate => candidate.id === regionId);
    if (region === undefined) continue;
    const inventory = inventories.get(region.inventoryId);
    const actor = actors.get(liability.responsibleActorId);
    if (inventory === undefined || actor === undefined) continue;
    const project = liability.projectId === null ? undefined : projects.get(liability.projectId);
    const projectReserved = project === undefined ? 0 : project.commitmentIds.reduce((total, id) =>
      total + (commitments.get(id)?.reserved ?? 0), 0);
    const reserveAvailable = Math.min(liability.reservedTreasury,
      project === undefined ? liability.reservedTreasury : projectReserved);
    const allocated = laborForActivity(labor, `preservation:${liability.id}`);
    const remaining = liability.exitWorkRequired - liability.exitWorkCompleted;
    const treasuryPerWork = parameters.projects.treasuryUnitsPerWork;
    const grainPerWork = parameters.projects.grainUnitsPerWork;
    const limits = [allocated, remaining];
    if (treasuryPerWork > 0) {
      limits.push(Math.floor((reserveAvailable + actor.treasury) / treasuryPerWork));
    }
    if (grainPerWork > 0) limits.push(Math.floor(inventory.grain / grainPerWork));
    const work = Math.max(0, Math.min(...limits));
    if (work > 0) {
      const treasuryCost = work * treasuryPerWork;
      const fromReserve = Math.min(reserveAvailable, treasuryCost);
      if (fromReserve > 0 && project !== undefined) {
        const consumed = consumeRetainedCommitments(project, fromReserve, commitments);
        if (consumed !== fromReserve) {
          throw new Error('Preservation reserve exceeds its retained commitment');
        }
      }
      const fromActor = treasuryCost - fromReserve;
      if (fromActor > 0) actors.set(actor.id, { ...actor, treasury: actor.treasury - fromActor });
      const grainUsed = work * grainPerWork;
      inventories.set(inventory.id, { ...inventory, grain: inventory.grain - grainUsed });
      grainConsumed += grainUsed;
      liability = {
        ...liability,
        reservedTreasury: liability.reservedTreasury - fromReserve,
        exitWorkCompleted: liability.exitWorkCompleted + work,
      };
    }
    // Safe disposal is complete only after all exit work is actually paid for.
    // No command or cancellation path may set this status for free.
    if (liability.exitWorkCompleted >= liability.exitWorkRequired) {
      if (liability.reservedTreasury > 0) {
        if (project !== undefined) {
          refundRetainedCommitments(project, liability.reservedTreasury, commitments, actors);
        } else {
          const current = actors.get(actor.id);
          if (current !== undefined) {
            actors.set(actor.id, { ...current, treasury: current.treasury + liability.reservedTreasury });
          }
        }
        liability = { ...liability, reservedTreasury: 0 };
      }
      liability = { ...liability, status: 'resolved' };
      reach = { ...reach, status: 'retired' };
      reaches = reaches.map((candidate, index) => index === reachIndex ? reach : candidate);
    }
    liabilities.set(liability.id, liability);
  }

  const agricultureLoss: AgricultureLoss[] = [];
  const regions = state.regions.map(region => {
    const allocatedAgriculture = labor
      .filter(row => row.activityId === `agriculture:${region.id}`)
      .reduce((sum, row) => sum + row.allocated, 0);
    const output = region.agriculturalLabor > 0
      ? Math.min(region.agriculturalCapacity,
        Math.floor(region.agriculturalCapacity * allocatedAgriculture / region.agriculturalLabor))
      : 0;
    const lostOutput = region.agriculturalCapacity - output;
    if (region.agriculturalLabor > 0) {
      agricultureLoss.push({
        regionId: region.id, allocatedLabor: allocatedAgriculture,
        requiredLabor: region.agriculturalLabor, lostOutput,
      });
    }
    if (output > 0) {
      const inventory = inventories.get(region.inventoryId);
      if (inventory !== undefined) {
        inventories.set(region.inventoryId, { ...inventory, grain: inventory.grain + output });
        grainProduced += output;
      }
    }
    const forcedLabor = forced.get(region.id) ?? 0;
    const gain = Math.ceil(forcedLabor * parameters.labor.burdenUnitsPerHundredForcedLabor / 100);
    const burden = Math.max(0, region.corveeBurden
      - parameters.labor.burdenRecoveryUnitsPerTick + gain);
    return { ...region, corveeBurden: burden };
  });

  reaches = reaches.map(reach => reach.closedUntil !== null && nextTick >= reach.closedUntil
    ? { ...reach, closedUntil: null }
    : reach);

  const nextInventories = [...inventories.values()].sort((a, b) => a.id < b.id ? -1 : 1);
  const transitCargo = state.inTransit
    .filter(batch => batch.status === 'waiting' || batch.status === 'travelling')
    .reduce((sum, batch) => sum + batch.quantity, 0);
  const closingCargo = nextInventories.reduce((sum, inventory) => sum + inventory.grain + inventory.materials, 0)
    + transitCargo;
  const openingCargo = state.ledger.cargo.closing;
  if (openingCargo + grainProduced - grainConsumed - materialsConsumed !== closingCargo) {
    throw new Error('Cargo ledger does not reconcile with inventory and consumption');
  }
  const waterOpening = state.ledger.water.closing;

  return {
    regions,
    actors: [...actors.values()].sort((a, b) => a.id < b.id ? -1 : 1),
    actions,
    projects: [...projects.values()].sort((a, b) => a.id < b.id ? -1 : 1),
    commitments: [...commitments.values()].sort((a, b) => a.id < b.id ? -1 : 1),
    inventories: nextInventories,
    reaches: [...reaches].sort((a, b) => a.id < b.id ? -1 : 1),
    liabilities: [...liabilities.values()].sort((a, b) => a.id < b.id ? -1 : 1),
    ledger: {
      tick: nextTick, labor, agricultureLoss,
      water: { opening: waterOpening, incoming: 0, outgoing: 0, consumed: 0, closing: waterOpening },
      cargo: {
        opening: openingCargo, incoming: grainProduced, outgoing: 0,
        consumed: grainConsumed + materialsConsumed, closing: closingCargo,
      },
    },
  };
}
