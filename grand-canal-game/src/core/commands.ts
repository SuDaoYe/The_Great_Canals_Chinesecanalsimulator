import { assertScenarioIdentity, CommandFailure, splitEven } from './invariants';
import {
  baseLaborRequest, completionBounds, laborSourcesFor, siteRegionIdFor, workRequiredFor,
} from './projects';
import { reduceEvent } from './reducer';
import type {
  CanalReachState, CommandEnvelope, CommandResult, EntityId, GameState, LoadClass,
  MaintenancePolicy, PassagePolicy, PassageSchedule, PlayerCommand, ProjectPlannedEvent,
  ProjectStatusSetEvent, ReachStatusSetEvent, WaterPolicy, WaterPolicySetEvent,
  MaintenanceSetEvent, PassageSetEvent, ProjectKind, LaborMode,
} from './types';

const GRADES: readonly LoadClass[] = ['small', 'standard', 'heavy'];
const KINDS: readonly ProjectKind[] = ['build', 'dredge', 'upgrade', 'reroute'];
const MODES: readonly LaborMode[] = ['normal', 'urgent'];
const MAINTENANCE: readonly MaintenancePolicy[] = ['minimum', 'standard', 'intensive'];
const PASSAGE: readonly PassagePolicy[] = ['balanced', 'official_first', 'civil_first'];
const WATER: readonly WaterPolicy[] = ['balanced', 'navigation_first', 'irrigation_first'];

function failure(code: ConstructorParameters<typeof CommandFailure>[0], message: string,
  relatedIds: readonly string[] = []): never {
  throw new CommandFailure(code, message, relatedIds);
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0
      || !value.every(item => typeof item === 'string' && item.length > 0)) {
    failure('INVALID_TARGET', `${path} must be a non-empty string array`);
  }
  const result = [...value] as string[];
  if (new Set(result).size !== result.length) failure('INVALID_TARGET', `${path} contains duplicates`);
  return result;
}

function periods(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) failure('INVALID_TIME', `${path} must be an array`);
  const result: number[] = [];
  for (const item of value) {
    if (!Number.isSafeInteger(item) || item < 0 || item > 35) {
      failure('INVALID_TIME', `${path} must contain integer periods 0..35`);
    }
    result.push(item);
  }
  if (new Set(result).size !== result.length) failure('INVALID_TIME', `${path} contains duplicates`);
  return result.sort((a, b) => a - b);
}

function schedule(value: unknown): PassageSchedule {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    failure('INVALID_TIME', 'schedule must be an object');
  }
  const data = value as Record<string, unknown>;
  return {
    official: periods(data.official, 'schedule.official'),
    civil: periods(data.civil, 'schedule.civil'),
    trade: periods(data.trade, 'schedule.trade'),
  };
}

function actorOrFail(state: GameState, id: EntityId, path: string): void {
  if (!state.actors.some(actor => actor.id === id)) {
    failure('INVALID_TARGET', `Unknown ${path} ${id}`, [id]);
  }
}

function reachOrFail(state: GameState, id: EntityId): CanalReachState {
  const reach = state.reaches.find(candidate => candidate.id === id);
  if (reach === undefined) failure('INVALID_TARGET', `Unknown reach ${id}`, [id]);
  return reach;
}

function planProject(
  state: GameState, commandId: string, command: Extract<PlayerCommand, { type: 'PLAN_PROJECT' }>,
): ProjectPlannedEvent {
  const parameters = state.parameters;
  if (!KINDS.includes(command.projectKind)) failure('INVALID_TARGET', 'Unknown project kind');
  if (!GRADES.includes(command.grade)) failure('INVALID_TARGET', 'Unknown project grade');
  if (!MODES.includes(command.laborMode)) failure('INVALID_TARGET', 'Unknown labor mode');
  const reachIds = stringArray(command.reachIds, 'reachIds').sort();
  const sponsorIds = stringArray(command.sponsorIds, 'sponsorIds').sort();
  if (!Number.isSafeInteger(command.startTick) || command.startTick < state.tick
      || command.startTick >= state.endTick) {
    failure('INVALID_TIME', 'startTick must be within the current tick and the scenario end');
  }
  for (const reachId of reachIds) {
    const reach = reachOrFail(state, reachId);
    if (reach.status === 'retired' || reach.status === 'decommissioning') {
      failure('INVALID_TARGET', `Reach ${reachId} cannot accept a new project`, [reachId]);
    }
  }
  for (const sponsorId of sponsorIds) actorOrFail(state, sponsorId, 'sponsor');
  const siteRegionId = siteRegionIdFor(state.reaches, reachIds);
  if (siteRegionId === null) failure('INVALID_TARGET', 'Project reaches have no site region');
  const laborRegionIds = command.laborRegionIds === undefined
    ? [siteRegionId]
    : stringArray(command.laborRegionIds, 'laborRegionIds');
  for (const regionId of laborRegionIds) {
    if (!state.regions.some(region => region.id === regionId)) {
      failure('INVALID_TARGET', `Unknown labor region ${regionId}`, [regionId]);
    }
  }
  const replaced = command.replacesReachId ?? null;
  if (command.projectKind === 'reroute') {
    if (replaced === null) failure('INVALID_TARGET', 'reroute requires replacesReachId');
    const oldReach = reachOrFail(state, replaced);
    if (reachIds.includes(oldReach.id)) failure('INVALID_TARGET', 'reroute cannot replace a new reach');
  } else if (replaced !== null) {
    failure('INVALID_TARGET', 'Only reroute may replace a reach', [replaced]);
  }
  const projectId = `project:${commandId}`;
  const usedIds = new Set<string>();
  for (const collection of [state.regions, state.actors, state.actions, state.inventories,
    state.waterNodes, state.waterEdges, state.transportNodes, state.transportEdges, state.reaches,
    state.projects, state.liabilities, state.commitments, state.demands, state.inTransit,
    state.petitions]) {
    for (const entity of collection) usedIds.add(entity.id);
  }
  if (usedIds.has(projectId)) {
    failure('INVALID_TARGET', `Project ID already exists: ${projectId}`, [projectId]);
  }
  usedIds.add(projectId);
  const workRequired = workRequiredFor(parameters, command.projectKind, command.grade, reachIds.length);
  if (!Number.isSafeInteger(workRequired) || workRequired <= 0) {
    failure('INVALID_TARGET', 'Project has no valid work requirement');
  }
  const request = baseLaborRequest(parameters, command.grade, command.laborMode);
  const sources = laborSourcesFor(parameters, laborRegionIds, siteRegionId, command.startTick, request);
  const laborPerTick = sources.reduce((sum, source) => sum + source.requested, 0);
  if (laborPerTick <= 0) failure('INVALID_TARGET', 'Project has no effective labor request');
  const remoteDelay = sources
    .filter(source => source.regionId !== siteRegionId)
    .reduce((delay, source) => Math.max(delay, source.arrivalTick - command.startTick), 0);
  const bounds = completionBounds(parameters, command.startTick, workRequired, laborPerTick, remoteDelay);
  const treasuryRequired = workRequired * parameters.projects.treasuryUnitsPerWork;
  const shares = splitEven(treasuryRequired, sponsorIds);
  const escrow: { actorId: EntityId; amount: number }[] = [];
  const commitments: ProjectPlannedEvent['delta']['commitments'][number][] = [];
  const commitmentIds: string[] = [];
  let gap = 0;
  sponsorIds.forEach((sponsorId, index) => {
    const actor = state.actors.find(candidate => candidate.id === sponsorId)!;
    const amount = shares[index] ?? 0;
    if (actor.treasury < amount) gap += amount - actor.treasury;
    const commitmentId = `commit:${commandId}:${sponsorId}`;
    if (usedIds.has(commitmentId)) {
      failure('INVALID_TARGET', `Commitment ID already exists: ${commitmentId}`, [commitmentId]);
    }
    usedIds.add(commitmentId);
    commitmentIds.push(commitmentId);
    escrow.push({ actorId: sponsorId, amount });
    commitments.push({
      id: commitmentId, actorId: sponsorId, projectId, regionId: siteRegionId,
      resource: 'treasury', amount, consumed: 0, reserved: amount, refunded: 0,
      fromTick: command.startTick, untilTick: Math.max(bounds.latestCompletionTick, command.startTick + 1),
      firmness: 'hard', status: 'escrowed', sourceEventId: `command:${commandId}`,
    });
  });
  if (gap > 0) {
    failure('INSUFFICIENT_COMMITMENT',
      `Sponsors lack ${gap} treasury units for the project`, sponsorIds);
  }
  const project = {
    id: projectId, kind: command.projectKind, reachIds, sponsorIds,
    grade: command.grade, laborMode: command.laborMode, startTick: command.startTick,
    allocationWeight: 1,
    phase: command.startTick === state.tick ? 'construction' as const : 'planned' as const,
    status: 'active' as const, workRequired, workCompleted: 0,
    grainSpent: 0, materialsSpent: 0, treasurySpent: 0,
    commitmentIds, laborSources: sources,
    earliestCompletionTick: bounds.earliestCompletionTick,
    latestCompletionTick: bounds.latestCompletionTick,
    trialTicksRemaining: 0, replacesReachId: replaced,
  };
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'PROJECT_PLANNED', source: 'player',
    causeIds: [], facts: [],
    delta: { commandId, project, commitments, escrow },
  };
}

function setProjectStatus(
  state: GameState, commandId: string,
  command: Extract<PlayerCommand, { type: 'SET_PROJECT_STATUS' }>,
): ProjectStatusSetEvent {
  const project = state.projects.find(candidate => candidate.id === command.projectId);
  if (project === undefined) failure('INVALID_TARGET', `Unknown project ${command.projectId}`, [command.projectId]);
  if (!['paused', 'active', 'cancelled'].includes(command.status)) {
    failure('INVALID_PHASE', 'Unknown project status');
  }
  if (project.status === command.status) {
    failure('INVALID_PHASE', `Project is already ${project.status}`, [project.id]);
  }
  if (command.status === 'paused') {
    if (project.status !== 'active' || (project.phase !== 'planned' && project.phase !== 'construction')) {
      failure('INVALID_PHASE', 'Only an active planned/under-construction project can pause', [project.id]);
    }
  } else if (command.status === 'active') {
    if (project.status !== 'paused' || project.phase === 'cancelled' || project.phase === 'operating') {
      failure('INVALID_PHASE', 'Only a paused project can resume', [project.id]);
    }
  } else if (project.phase === 'operating' || project.phase === 'cancelled') {
    failure('INVALID_PHASE', 'An operating or cancelled project cannot be cancelled again', [project.id]);
  }
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'PROJECT_STATUS_SET', source: 'player',
    causeIds: [], facts: [], delta: { commandId, projectId: command.projectId, status: command.status },
  };
}

function setPassage(
  state: GameState, commandId: string,
  command: Extract<PlayerCommand, { type: 'SET_PASSAGE' }>,
): PassageSetEvent {
  reachOrFail(state, command.reachId);
  if (!PASSAGE.includes(command.policy)) failure('INVALID_TARGET', 'Unknown passage policy');
  if (!GRADES.includes(command.maxLoadClass)) failure('INVALID_TARGET', 'Unknown load class');
  const nextSchedule = schedule(command.schedule);
  if (command.closedUntil !== null) {
    if (!Number.isSafeInteger(command.closedUntil)) failure('INVALID_TIME', 'closedUntil must be an integer tick');
    if (command.closedUntil <= state.tick) {
      failure('INVALID_TIME', 'closedUntil must be later than the current tick');
    }
  }
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'PASSAGE_SET', source: 'player',
    causeIds: [], facts: [],
    delta: {
      commandId, reachId: command.reachId, policy: command.policy,
      maxLoadClass: command.maxLoadClass, schedule: nextSchedule, closedUntil: command.closedUntil,
    },
  };
}

function setMaintenance(
  state: GameState, commandId: string,
  command: Extract<PlayerCommand, { type: 'SET_MAINTENANCE' }>,
): MaintenanceSetEvent {
  reachOrFail(state, command.reachId);
  if (!MAINTENANCE.includes(command.policy)) failure('INVALID_TARGET', 'Unknown maintenance policy');
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'MAINTENANCE_SET', source: 'player',
    causeIds: [], facts: [], delta: { commandId, reachId: command.reachId, policy: command.policy },
  };
}

function setWaterPolicy(
  state: GameState, commandId: string,
  command: Extract<PlayerCommand, { type: 'SET_WATER_POLICY' }>,
): WaterPolicySetEvent {
  if (!state.waterNodes.some(node => node.id === command.nodeId)) {
    failure('INVALID_TARGET', `Unknown water node ${command.nodeId}`, [command.nodeId]);
  }
  if (!WATER.includes(command.policy)) failure('INVALID_TARGET', 'Unknown water policy');
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'WATER_POLICY_SET', source: 'player',
    causeIds: [], facts: [], delta: { commandId, nodeId: command.nodeId, policy: command.policy },
  };
}

function setReachStatus(
  state: GameState, commandId: string,
  command: Extract<PlayerCommand, { type: 'SET_REACH_STATUS' }>,
): ReachStatusSetEvent {
  const reach = reachOrFail(state, command.reachId);
  if (!['active', 'mothballed', 'decommissioning'].includes(command.status)) {
    failure('INVALID_TARGET', 'Unknown reach status');
  }
  if (reach.status === command.status) {
    failure('INVALID_PHASE', `Reach is already ${reach.status}`, [reach.id]);
  }
  if (reach.status === 'retired' || reach.status === 'candidate') {
    failure('INVALID_PHASE', 'Only an operating reach can change operating status', [reach.id]);
  }
  if (command.status === 'active') {
    if (reach.status !== 'mothballed' && reach.status !== 'decommissioning') {
      failure('INVALID_PHASE', 'Only a mothballed/decommissioning reach can reopen', [reach.id]);
    }
    if (state.liabilities.some(liability => liability.reachId === reach.id
        && liability.status === 'unresolved')) {
      failure('INVALID_PHASE', 'Unresolved preservation liability blocks reopening', [reach.id]);
    }
  } else {
    if (reach.status === 'decommissioning' && command.status === 'mothballed') {
      failure('INVALID_PHASE', 'A decommissioning reach cannot return to mothballed', [reach.id]);
    }
    if (state.projects.some(project => project.reachIds.includes(reach.id)
        && project.status !== 'cancelled' && project.phase !== 'operating')) {
      failure('INVALID_PHASE', 'An unfinished project occupies this reach', [reach.id]);
    }
  }
  return {
    id: `command:${commandId}`, tick: state.tick, type: 'REACH_STATUS_SET', source: 'player',
    causeIds: [], facts: [], delta: { commandId, reachId: command.reachId, status: command.status },
  };
}

export function buildCommandEvent(
  state: GameState, commandId: string, command: PlayerCommand,
): ReturnType<typeof planProject> | ProjectStatusSetEvent | PassageSetEvent
  | MaintenanceSetEvent | WaterPolicySetEvent | ReachStatusSetEvent {
  if (command === null || typeof command !== 'object') failure('INVALID_TARGET', 'Command must be an object');
  switch (command.type) {
    case 'PLAN_PROJECT': return planProject(state, commandId, command);
    case 'SET_PROJECT_STATUS': return setProjectStatus(state, commandId, command);
    case 'SET_PASSAGE': return setPassage(state, commandId, command);
    case 'SET_MAINTENANCE': return setMaintenance(state, commandId, command);
    case 'SET_WATER_POLICY': return setWaterPolicy(state, commandId, command);
    case 'SET_REACH_STATUS': return setReachStatus(state, commandId, command);
    default: return failure('INVALID_TARGET', 'Unknown command type');
  }
}

export function applyCommand(
  state: GameState, envelope: CommandEnvelope, scenario: Parameters<typeof assertScenarioIdentity>[1],
): CommandResult {
  assertScenarioIdentity(state, scenario);
  if (envelope === null || typeof envelope !== 'object') {
    throw new TypeError('CommandEnvelope must be an object');
  }
  if (envelope.expectedRevision !== state.revision) {
    return {
      ok: false, state,
      error: {
        code: 'STALE_REVISION',
        message: `Expected revision ${state.revision}, received ${String(envelope.expectedRevision)}`,
        relatedIds: [],
      },
    };
  }
  if (typeof envelope.commandId !== 'string' || envelope.commandId.trim().length === 0) {
    return {
      ok: false, state,
      error: { code: 'INVALID_TARGET', message: 'commandId must be a non-empty string', relatedIds: [] },
    };
  }
  if (state.appliedCommandIds.includes(envelope.commandId)) {
    return {
      ok: false, state,
      error: {
        code: 'DUPLICATE_COMMAND',
        message: `Command ${envelope.commandId} was already applied`,
        relatedIds: [envelope.commandId],
      },
    };
  }
  if (state.ending !== null) {
    return {
      ok: false, state,
      error: { code: 'INVALID_PHASE', message: 'The observation period has ended', relatedIds: [] },
    };
  }
  let event: ReturnType<typeof buildCommandEvent>;
  try {
    event = buildCommandEvent(state, envelope.commandId, envelope.command);
  } catch (error) {
    if (error instanceof CommandFailure) {
      return {
        ok: false, state,
        error: { code: error.code, message: error.message, relatedIds: error.relatedIds },
      };
    }
    throw error;
  }
  const next = reduceEvent(state, event);
  return { ok: true, state: next, events: Object.freeze([event]) };
}
