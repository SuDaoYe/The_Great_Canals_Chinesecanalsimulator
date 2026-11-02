import { buildCommandEvent } from './commands';
import { assertScenarioIdentity, CommandFailure } from './invariants';
import { siteRegionIdFor } from './projects';
import type {
  CommandError, GameState, PlayerCommand, PreviewResult, ScenarioDefinition,
} from './types';

const UNKNOWNS: readonly string[] = [
  'Future weather is not sampled in G1; only the current state is used.',
  'External actions may withdraw labor after this preview.',
  'Transport arrival and route capacity are not simulated before T04.',
];

function errorOf(error: CommandFailure): CommandError {
  return { code: error.code, message: error.message, relatedIds: [...error.relatedIds] };
}

export function preview(
  state: GameState, command: PlayerCommand, scenario: ScenarioDefinition,
): PreviewResult {
  assertScenarioIdentity(state, scenario);
  const impacts: string[] = [];
  const unknowns = [...UNKNOWNS];
  if (state.ending !== null) {
    return {
      feasible: false,
      errors: [{ code: 'INVALID_PHASE', message: 'The observation period has ended', relatedIds: [] }],
      estimate: null, impacts, unknowns,
    };
  }
  let event: ReturnType<typeof buildCommandEvent>;
  try {
    event = buildCommandEvent(state, 'preview', command);
  } catch (error) {
    if (error instanceof CommandFailure) {
      return { feasible: false, errors: [errorOf(error)], estimate: null, impacts, unknowns };
    }
    throw error;
  }
  if (event.type === 'PROJECT_PLANNED') {
    const project = event.delta.project;
    const treasuryRequired = event.delta.commitments
      .reduce((sum, commitment) => sum + commitment.amount, 0);
    const grainAtSiteRequired = project.workRequired
      * state.parameters.projects.grainUnitsPerWork;
    const materialsRequired = project.workRequired
      * state.parameters.projects.materialUnitsPerWork;
    const laborPerTick = project.laborSources.reduce((sum, source) => sum + source.requested, 0);
    const siteRegionId = siteRegionIdFor(state.reaches, project.reachIds);
    const siteRegion = siteRegionId === null
      ? undefined : state.regions.find(region => region.id === siteRegionId);
    const siteInventory = siteRegion === undefined
      ? undefined : state.inventories.find(inventory => inventory.id === siteRegion.inventoryId);
    if (siteInventory !== undefined) {
      if (siteInventory.grain < grainAtSiteRequired) {
        impacts.push(`Site grain ${siteInventory.grain} is below the ${grainAtSiteRequired} units needed; work will stall until delivery.`);
      }
      if (siteInventory.materials < materialsRequired) {
        impacts.push(`Site materials ${siteInventory.materials} are below the ${materialsRequired} units needed; work will stall until delivery.`);
      }
    }
    const competing = state.actions.filter(action => action.phase === 'active'
      && action.regionIds.some(regionId => project.laborSources.some(source => source.regionId === regionId)));
    if (competing.length > 0) {
      impacts.push(`Active external actions compete for labor in the source regions: ${competing.map(action => action.id).sort().join(', ')}.`);
    }
    impacts.push(`Requires ${treasuryRequired} escrowed treasury units from ${project.sponsorIds.join(', ')}.`);
    impacts.push(`Requests ${laborPerTick} labor units per period with ${state.parameters.projects.trialTicks} trial period(s).`);
    return {
      feasible: true,
      errors: [],
      estimate: {
        siteRegionId,
        workRequired: project.workRequired,
        treasuryRequired,
        grainAtSiteRequired,
        materialsRequired,
        laborPerTick,
        earliestCompletionTick: project.earliestCompletionTick,
        latestCompletionTick: project.latestCompletionTick,
      },
      impacts,
      unknowns,
    };
  }
  if (event.type === 'PROJECT_STATUS_SET') {
    const project = state.projects.find(candidate => candidate.id === event.delta.projectId);
    if (project !== undefined && event.delta.status === 'cancelled' && project.workCompleted > 0) {
      const minimum = state.parameters.projects.preservation[project.grade];
      impacts.push(`Stopping after ${project.workCompleted} completed work keeps the reach in disposal and creates a preservation liability of at least ${minimum.minimumTreasuryUnits} treasury and ${minimum.minimumLaborUnits} labor units.`);
      impacts.push('Only unspent escrow is returned; the minimum safety reserve is retained first.');
    } else if (event.delta.status === 'paused') {
      impacts.push('Completed work is kept, but the reach degrades each period until resumed.');
    } else if (event.delta.status === 'active') {
      impacts.push('Resume uses the remaining work and a current schedule estimate.');
    }
    return {
      feasible: true, errors: [],
      estimate: {
        siteRegionId: null, workRequired: project?.workRequired ?? null,
        treasuryRequired: 0, grainAtSiteRequired: 0, materialsRequired: 0, laborPerTick: 0,
        earliestCompletionTick: project?.earliestCompletionTick ?? null,
        latestCompletionTick: project?.latestCompletionTick ?? null,
      },
      impacts, unknowns,
    };
  }
  if (event.type === 'PASSAGE_SET') {
    impacts.push(event.delta.closedUntil === null
      ? 'Annual purpose windows apply immediately; no temporary closure.'
      : `Temporary closure overrides the annual schedule until tick ${event.delta.closedUntil} (exclusive).`);
    if (event.delta.maxLoadClass !== 'heavy') {
      impacts.push(`Loads above ${event.delta.maxLoadClass} become ineligible; total edge capacity is unchanged.`);
    }
  } else if (event.type === 'REACH_STATUS_SET') {
    impacts.push('Mothballing or decommissioning carries a minimum waterworks safety responsibility.');
  } else if (event.type === 'MAINTENANCE_SET') {
    impacts.push('The maintenance policy changes this period\'s minimum-maintenance labor request.');
  } else if (event.type === 'WATER_POLICY_SET') {
    impacts.push('The water policy changes allocation priority only when the water module is added in T04.');
  }
  return {
    feasible: true, errors: [], estimate: {
      siteRegionId: null, workRequired: null, treasuryRequired: 0, grainAtSiteRequired: 0,
      materialsRequired: 0, laborPerTick: 0, earliestCompletionTick: null, latestCompletionTick: null,
    },
    impacts, unknowns,
  };
}
