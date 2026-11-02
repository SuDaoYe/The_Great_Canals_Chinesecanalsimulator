import { freezeOwned, isDeepFrozen } from './immutable';
import { assertStateInvariants, InvariantError, splitEven } from './invariants';
import { runTickSettlement } from './economy';
import { completionBounds, makePreservationLiability, preservationMinimum, reachById } from './projects';
import type {
  ActorState, Commitment, DeepReadonly, DomainEvent,
  GameState, PreservationLiability, ProjectState,
} from './types';

export class SimulationError extends Error {
  readonly diagnostic: Readonly<{ tick: number; eventId: string; reason: string }>;
  constructor(state: GameState, eventId: string, reason: string) {
    super(`Tick ${state.tick} rejected: ${reason}`);
    this.name = 'SimulationError';
    this.diagnostic = Object.freeze({ tick: state.tick, eventId, reason });
  }
}

type CommandEvent = Exclude<DomainEvent, { type: 'TICK_COMPLETED' }>;

const byId = <T extends { readonly id: string }>(values: readonly T[]): T[] =>
  [...values].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function commandEventState(
  state: GameState, event: DeepReadonly<CommandEvent>,
  updates: Partial<Pick<GameState, 'actors' | 'projects' | 'commitments' | 'reaches'
    | 'liabilities' | 'waterNodes'>>,
): GameState {
  const frozenInput = isDeepFrozen(state);
  return freezeOwned({
    ...(frozenInput ? state : structuredClone(state)),
    ...(frozenInput ? updates : structuredClone(updates)),
    revision: state.revision + 1,
    appliedCommandIds: [...state.appliedCommandIds, event.delta.commandId],
    events: [structuredClone(event)],
  });
}

function applyProjectPlanned(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'PROJECT_PLANNED' }>>,
): GameState {
  const { project, commitments, escrow } = event.delta;
  if (state.projects.some(existing => existing.id === project.id)) {
    throw new InvariantError('Project ID already exists');
  }
  if (state.commitments.some(existing => commitments.some(candidate => candidate.id === existing.id))) {
    throw new InvariantError('Commitment ID already exists');
  }
  if (new Set(commitments.map(commitment => commitment.id)).size !== commitments.length) {
    throw new InvariantError('Duplicate commitment ID in event');
  }
  if (commitments.length !== escrow.length) throw new InvariantError('Escrow does not match commitments');
  if (project.commitmentIds.length !== commitments.length
      || !project.commitmentIds.every(id => commitments.some(commitment => commitment.id === id))) {
    throw new InvariantError('Project commitments do not match event');
  }
  for (const reachId of project.reachIds) {
    if (reachById(state.reaches, reachId) === undefined) throw new InvariantError(`Unknown reach ${reachId}`);
  }
  for (const sponsorId of project.sponsorIds) {
    if (!state.actors.some(actor => actor.id === sponsorId)) {
      throw new InvariantError(`Unknown sponsor ${sponsorId}`);
    }
  }
  if (project.replacesReachId !== null && reachById(state.reaches, project.replacesReachId) === undefined) {
    throw new InvariantError('Unknown replaced reach');
  }
  const actors = new Map(state.actors.map(actor => [actor.id, actor]));
  for (const entry of escrow) {
    const actor = actors.get(entry.actorId);
    if (actor === undefined) throw new InvariantError(`Unknown escrow actor ${entry.actorId}`);
    if (entry.amount < 0 || actor.treasury < entry.amount) {
      throw new InvariantError('Escrow exceeds available treasury');
    }
    actors.set(actor.id, { ...actor, treasury: actor.treasury - entry.amount });
  }
  const escrowByActor = new Map(escrow.map(entry => [entry.actorId, entry.amount]));
  for (const commitment of commitments) {
    if (commitment.amount !== escrowByActor.get(commitment.actorId)) {
      throw new InvariantError('Commitment amount does not match escrow');
    }
    if (commitment.consumed + commitment.reserved + commitment.refunded !== commitment.amount) {
      throw new InvariantError('New commitment does not reconcile');
    }
  }
  return commandEventState(state, event, {
    actors: byId([...actors.values()]),
    projects: byId([...state.projects, project]),
    commitments: byId([...state.commitments, ...commitments]),
  });
}

function refundCommitments(
  state: GameState, project: DeepReadonly<ProjectState>, retainTreasury: number,
): { commitments: readonly Commitment[]; actors: readonly ActorState[]; retained: number } {
  const commitments = new Map(state.commitments.map(commitment => [commitment.id, commitment]));
  const actors = new Map(state.actors.map(actor => [actor.id, actor]));
  let remainingRetain = Math.max(0, retainTreasury);
  let retained = 0;
  for (const commitmentId of [...project.commitmentIds].sort()) {
    const commitment = commitments.get(commitmentId);
    if (commitment === undefined) continue;
    const keep = Math.min(commitment.reserved, remainingRetain);
    const refund = commitment.reserved - keep;
    remainingRetain -= keep;
    retained += keep;
    if (refund <= 0) continue;
    const actor = actors.get(commitment.actorId);
    if (actor === undefined) throw new InvariantError('Commitment references unknown actor');
    actors.set(actor.id, { ...actor, treasury: actor.treasury + refund });
    commitments.set(commitment.id, {
      ...commitment, reserved: keep, refunded: commitment.refunded + refund,
      status: keep === 0 ? 'withdrawn' : 'escrowed',
    });
  }
  return {
    commitments: byId([...commitments.values()]),
    actors: byId([...actors.values()]),
    retained,
  };
}

function applyProjectStatus(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'PROJECT_STATUS_SET' }>>,
): GameState {
  const project = state.projects.find(candidate => candidate.id === event.delta.projectId);
  if (project === undefined) throw new InvariantError('Unknown project');
  if (event.delta.status === 'paused') {
    if (project.status !== 'active' || (project.phase !== 'planned' && project.phase !== 'construction')) {
      throw new InvariantError('Illegal pause transition');
    }
    return commandEventState(state, event, {
      projects: byId(state.projects.map(candidate => candidate.id === project.id
        ? { ...candidate, status: 'paused' as const } : candidate)),
    });
  }
  if (event.delta.status === 'active') {
    if (project.status !== 'paused') throw new InvariantError('Illegal resume transition');
    const request = project.laborSources.reduce((sum, source) => sum + source.requested, 0);
    const bounds = completionBounds(state.parameters, state.tick,
      project.workRequired - project.workCompleted, request, 0);
    return commandEventState(state, event, {
      projects: byId(state.projects.map(candidate => candidate.id === project.id
        ? { ...candidate, status: 'active' as const,
          earliestCompletionTick: bounds.earliestCompletionTick,
          latestCompletionTick: bounds.latestCompletionTick }
        : candidate)),
    });
  }
  if (project.status === 'cancelled' || project.phase === 'operating' || project.phase === 'cancelled') {
    throw new InvariantError('Project cannot be cancelled');
  }
  if (project.workCompleted === 0) {
    const refunded = refundCommitments(state, project, 0);
    return commandEventState(state, event, {
      actors: refunded.actors,
      commitments: refunded.commitments,
      projects: byId(state.projects.map(candidate => candidate.id === project.id
        ? { ...candidate, status: 'cancelled' as const, phase: 'cancelled' as const } : candidate)),
    });
  }
  const reachIds = [...project.reachIds].sort();
  const minimum = preservationMinimum(state.parameters, project.grade);
  const totalRetain = Math.min(minimum.minimumTreasury * reachIds.length,
    project.commitmentIds.reduce((sum, id) =>
      sum + (state.commitments.find(commitment => commitment.id === id)?.reserved ?? 0), 0));
  const refunded = refundCommitments(state, project, totalRetain);
  const reachShares = splitEven(refunded.retained, reachIds);
  const sponsor = [...project.sponsorIds].sort()[0];
  if (sponsor === undefined) throw new InvariantError('Cancelled project has no sponsor');
  const liabilities: PreservationLiability[] = [];
  const reaches = state.reaches.map(reach => {
    if (!reachIds.includes(reach.id)) return reach;
    if (reach.status !== 'retired') {
      const share = reachShares[reachIds.indexOf(reach.id)] ?? 0;
      const liability = makePreservationLiability(state.parameters, reach,
        project.id, sponsor, 'project_cancelled', share);
      if (!state.liabilities.some(existing => existing.id === liability.id)) liabilities.push(liability);
    }
    return reach.status === 'retired' ? reach : { ...reach, status: 'decommissioning' as const };
  });
  return commandEventState(state, event, {
    actors: refunded.actors,
    commitments: refunded.commitments,
    reaches,
    liabilities: byId([...state.liabilities, ...liabilities]),
    projects: byId(state.projects.map(candidate => candidate.id === project.id
      ? { ...candidate, status: 'cancelled' as const, phase: 'cancelled' as const } : candidate)),
  });
}

function applyPassage(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'PASSAGE_SET' }>>,
): GameState {
  const reach = reachById(state.reaches, event.delta.reachId);
  if (reach === undefined) throw new InvariantError('Unknown reach');
  const schedule = {
    official: [...event.delta.schedule.official],
    civil: [...event.delta.schedule.civil],
    trade: [...event.delta.schedule.trade],
  };
  return commandEventState(state, event, {
    reaches: state.reaches.map(candidate => candidate.id === reach.id
      ? { ...candidate, passage: event.delta.policy, maxLoadClass: event.delta.maxLoadClass,
        schedule, closedUntil: event.delta.closedUntil }
      : candidate),
  });
}

function applyMaintenance(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'MAINTENANCE_SET' }>>,
): GameState {
  const reach = reachById(state.reaches, event.delta.reachId);
  if (reach === undefined) throw new InvariantError('Unknown reach');
  return commandEventState(state, event, {
    reaches: state.reaches.map(candidate => candidate.id === reach.id
      ? { ...candidate, maintenance: event.delta.policy } : candidate),
  });
}

function applyWaterPolicy(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'WATER_POLICY_SET' }>>,
): GameState {
  if (!state.waterNodes.some(node => node.id === event.delta.nodeId)) {
    throw new InvariantError('Unknown water node');
  }
  return commandEventState(state, event, {
    waterNodes: state.waterNodes.map(node => node.id === event.delta.nodeId
      ? { ...node, policy: event.delta.policy } : node),
  });
}

function applyReachStatus(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'REACH_STATUS_SET' }>>,
): GameState {
  const reach = reachById(state.reaches, event.delta.reachId);
  if (reach === undefined) throw new InvariantError('Unknown reach');
  if (reach.status === 'retired' || reach.status === 'candidate') {
    throw new InvariantError('Illegal reach status transition');
  }
  if (event.delta.status === 'active') {
    if (state.liabilities.some(liability => liability.reachId === reach.id
        && liability.status === 'unresolved')) {
      throw new InvariantError('Unresolved liability blocks reopening');
    }
    return commandEventState(state, event, {
      reaches: state.reaches.map(candidate => candidate.id === reach.id
        ? { ...candidate, status: 'active' as const } : candidate),
    });
  }
  const regionId = [...reach.regionIds].sort()[0];
  const region = regionId === undefined ? undefined
    : state.regions.find(candidate => candidate.id === regionId);
  if (region === undefined) throw new InvariantError('Reach has no responsible region');
  const liability = makePreservationLiability(state.parameters, reach, null,
    region.actorId, 'reach_status', 0);
  const existing = state.liabilities.some(candidate => candidate.reachId === reach.id
    && candidate.status === 'unresolved');
  return commandEventState(state, event, {
    reaches: state.reaches.map(candidate => candidate.id === reach.id
      ? { ...candidate, status: event.delta.status } : candidate),
    liabilities: existing ? state.liabilities
      : byId([...state.liabilities, liability]),
  });
}

function applyTick(
  state: GameState, event: DeepReadonly<Extract<DomainEvent, { type: 'TICK_COMPLETED' }>>,
): GameState {
  const settlement = runTickSettlement(state, event.tick);
  assertStateInvariants({
    ...state,
    regions: settlement.regions,
    actors: settlement.actors,
    actions: settlement.actions,
    projects: settlement.projects,
    commitments: settlement.commitments,
    inventories: settlement.inventories,
    reaches: settlement.reaches,
    liabilities: settlement.liabilities,
    ledger: settlement.ledger,
  } as GameState);
  const frozenInput = isDeepFrozen(state);
  const safeSettlement = frozenInput ? settlement : structuredClone(settlement);
  const owned = frozenInput ? state : structuredClone(state);
  return freezeOwned({
    ...owned,
    tick: event.tick, revision: state.revision + 1,
    regions: safeSettlement.regions, actors: safeSettlement.actors,
    actions: safeSettlement.actions,
    projects: safeSettlement.projects, commitments: safeSettlement.commitments,
    inventories: safeSettlement.inventories, reaches: safeSettlement.reaches,
    liabilities: safeSettlement.liabilities, ledger: safeSettlement.ledger,
    events: [structuredClone(event)],
    ending: event.delta.observationEnded ? { reason: 'observation_end', tick: event.tick } : null,
  });
}

// The only transition writer. Validation happens before constructing a candidate;
// a thrown error leaves the caller's stable snapshot and RNG untouched.
export function reduceEvent(state: GameState, event: DeepReadonly<DomainEvent>): GameState {
  const reject = (reason: string): never => { throw new SimulationError(state, event.id, reason); };
  if (state.ending !== null) reject('Cannot reduce an event after ending');
  if (!Number.isSafeInteger(state.tick) || state.tick < 0 || state.tick >= state.endTick
      || !Number.isSafeInteger(state.revision) || state.revision < 0 || state.revision === Number.MAX_SAFE_INTEGER) {
    reject('Invalid time/revision boundary');
  }
  if (state.pendingEvents.length !== 0) {
    reject('Scheduled mechanisms are not implemented for this event queue');
  }
  if (Object.keys(state.rngStates).length !== 3
      || !['weather', 'actors', 'disasters'].every(key => Object.hasOwn(state.rngStates, key))
      || !Object.values(state.rngStates).every(v => Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) {
    reject('Invalid RNG states');
  }
  try {
    assertStateInvariants(state);
  } catch (error) {
    if (error instanceof InvariantError) reject(error.message);
    throw error;
  }
  if (event.type === 'TICK_COMPLETED') {
    if (event.source !== 'system' || event.id !== `tick:${state.scenarioId}:${state.tick + 1}`
        || event.tick !== state.tick + 1 || event.delta.fromTick !== state.tick
        || event.delta.toTick !== state.tick + 1 || event.causeIds.length !== 0
        || event.facts.length !== 0
        || event.delta.observationEnded !== (event.tick === state.endTick)) {
      reject('Invalid foundation event');
    }
    let next: GameState;
    try {
      next = applyTick(state, event);
    } catch (error) {
      if (error instanceof InvariantError || error instanceof Error) reject(error.message);
      throw error;
    }
    return next;
  }
  if (event.source !== 'player' || event.tick !== state.tick
      || event.id !== `command:${event.delta.commandId}` || event.causeIds.length !== 0
      || event.facts.length !== 0) {
    reject('Invalid command event');
  }
  if (state.appliedCommandIds.includes(event.delta.commandId)) reject('Duplicate command ID');
  let next: GameState | undefined;
  try {
    switch (event.type) {
      case 'PROJECT_PLANNED': next = applyProjectPlanned(state, event); break;
      case 'PROJECT_STATUS_SET': next = applyProjectStatus(state, event); break;
      case 'PASSAGE_SET': next = applyPassage(state, event); break;
      case 'MAINTENANCE_SET': next = applyMaintenance(state, event); break;
      case 'WATER_POLICY_SET': next = applyWaterPolicy(state, event); break;
      case 'REACH_STATUS_SET': next = applyReachStatus(state, event); break;
      default: return reject('Unknown event type');
    }
    if (next === undefined) return reject('Event produced no state');
    assertStateInvariants(next);
  } catch (error) {
    if (error instanceof InvariantError) reject(error.message);
    if (error instanceof SimulationError) throw error;
    reject(error instanceof Error ? error.message : 'Event application failed');
  }
  if (next === undefined) return reject('Event produced no state');
  return next;
}