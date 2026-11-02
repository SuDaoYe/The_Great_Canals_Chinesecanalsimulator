import { describe, expect, test } from 'vitest';
import { applyCommand, createGame, hashState, preview, tick } from '../../src/core/index';
import { passageStatusAt } from '../../src/core/projects';
import type {
  CanalReachState, GameState, PlayerCommand, ScenarioDefinition,
} from '../../src/core/types';
import { makeScenario } from '../fixtures/scenarios';
import { runTicks } from '../fixtures/inspect';

const PERIODS = Array.from({ length: 36 }, (_, index) => index);
const PLAN: PlayerCommand = {
  type: 'PLAN_PROJECT', projectKind: 'dredge', reachIds: ['ab'], grade: 'small',
  laborMode: 'normal', startTick: 0, sponsorIds: ['central'],
};

function applyOk(
  state: GameState, scenario: ScenarioDefinition, commandId: string, command: PlayerCommand,
): GameState {
  const result = applyCommand(state, {
    commandId, expectedRevision: state.revision, command,
  }, scenario);
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function withReach(scenario: ScenarioDefinition, reach: CanalReachState): ScenarioDefinition {
  return {
    ...scenario,
    initial: { ...scenario.initial, reaches: [...scenario.initial.reaches, reach] },
  };
}

function secondReach(id = 'ac'): CanalReachState {
  return {
    id, name: id, regionIds: ['a'], waterEdgeIds: [], transportEdgeIds: [],
    grade: 'small', status: 'candidate', silt: 1000, damage: 0,
    maintenance: 'standard', maintenanceLabor: 0, maintenanceCost: 1,
    passage: 'balanced', maxLoadClass: 'standard',
    schedule: { official: [...PERIODS], civil: [...PERIODS], trade: [...PERIODS] },
    closedUntil: null, validPeriod: { fromYear: 1400, untilYearExclusive: null }, evidenceIds: [],
  };
}

test('tick never freezes or reuses a mutable deserialized input', () => {
  const scenario = makeScenario('conscription');
  const mutable = JSON.parse(JSON.stringify(createGame(scenario, 7))) as GameState;
  const next = tick(mutable, scenario).state;
  for (const value of [mutable.regions, mutable.actions, mutable.projects,
    mutable.commitments, mutable.reaches, mutable.inventories]) {
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(value[0])).toBe(false);
  }
  (mutable.reaches[0] as { silt: number }).silt = 7;
  (mutable.projects[0] as { workCompleted: number }).workCompleted = 7;
  (mutable.actions[0] as { laborRequest: number }).laborRequest = 7;
  expect(next.reaches[0]!.silt).toBe(6000);
  expect(next.projects[0]!.workCompleted).toBe(20);
  expect(next.actions[0]!.laborRequest).toBe(40);
});

test('duplicate command cannot spend twice; preview is isolated and stateless', () => {
  const scenario = makeScenario('minimal');
  const state = createGame(scenario, 7);
  const before = hashState(state);
  const firstPreview = preview(state, PLAN, scenario);
  preview(state, PLAN, scenario);
  expect(firstPreview.feasible).toBe(true);
  expect(hashState(state)).toBe(before);
  // A caller mutating the returned estimate must not reach the formal snapshot.
  firstPreview.estimate!.treasuryRequired = -1;
  expect(hashState(state)).toBe(before);
  const once = applyCommand(state, {
    commandId: 'p-1', expectedRevision: state.revision, command: PLAN,
  }, scenario);
  expect(once.ok).toBe(true);
  if (!once.ok) throw new Error(once.error.message);
  expect(once.state.revision).toBe(1);
  expect(once.state.appliedCommandIds).toEqual(['p-1']);
  expect(once.state.actors[0]!.treasury).toBe(10000 - 240);
  const treasury = once.state.actors[0]!.treasury;
  const twice = applyCommand(once.state, {
    commandId: 'p-1', expectedRevision: once.state.revision, command: PLAN,
  }, scenario);
  expect(twice.ok).toBe(false);
  if (twice.ok) throw new Error('duplicate command accepted');
  expect(twice.error.code).toBe('DUPLICATE_COMMAND');
  expect(hashState(twice.state)).toBe(hashState(once.state));
  expect(twice.state.actors[0]!.treasury).toBe(treasury);
  expect(twice.state.projects).toHaveLength(1);
});

test('preview does not read formal randomness and does not change later commands', () => {
  const scenario = makeScenario('minimal');
  const plain = createGame(scenario, 7);
  const previewed = createGame(scenario, 7);
  for (let index = 0; index < 4; index += 1) preview(previewed, PLAN, scenario);
  const perturbed = {
    ...previewed,
    rngStates: { ...previewed.rngStates, weather: previewed.rngStates.weather + 99 },
  };
  expect(preview(perturbed, PLAN, scenario).estimate)
    .toEqual(preview(previewed, PLAN, scenario).estimate);
  const a = applyOk(plain, scenario, 'p-1', PLAN);
  const b = applyOk(previewed, scenario, 'p-1', PLAN);
  expect(hashState(a)).toBe(hashState(b));
});

test('envelope precedence is revision, duplicate, target, time; failures are atomic', () => {
  const scenario = makeScenario('minimal');
  const initial = createGame(scenario, 7);
  const stale = applyCommand(initial, {
    commandId: 'p-1', expectedRevision: 1, command: PLAN,
  }, scenario);
  expect(stale.ok).toBe(false);
  if (stale.ok) throw new Error('stale command accepted');
  expect(stale.error.code).toBe('STALE_REVISION');
  expect(hashState(stale.state)).toBe(hashState(initial));

  const applied = applyOk(initial, scenario, 'p-1', PLAN);
  const staleDuplicate = applyCommand(applied, {
    commandId: 'p-1', expectedRevision: 0, command: PLAN,
  }, scenario);
  expect(staleDuplicate.ok).toBe(false);
  if (staleDuplicate.ok) throw new Error('stale duplicate accepted');
  expect(staleDuplicate.error.code).toBe('STALE_REVISION');

  const duplicate = applyCommand(applied, {
    commandId: 'p-1', expectedRevision: applied.revision, command: PLAN,
  }, scenario);
  expect(duplicate.ok).toBe(false);
  if (duplicate.ok) throw new Error('duplicate accepted');
  expect(duplicate.error.code).toBe('DUPLICATE_COMMAND');

  const badTarget = applyCommand(applied, {
    commandId: 'p-2', expectedRevision: applied.revision,
    command: { ...PLAN, reachIds: ['missing'] },
  }, scenario);
  expect(badTarget.ok).toBe(false);
  if (badTarget.ok) throw new Error('bad target accepted');
  expect(badTarget.error.code).toBe('INVALID_TARGET');
  expect(hashState(badTarget.state)).toBe(hashState(applied));

  const badTime = applyCommand(applied, {
    commandId: 'p-3', expectedRevision: applied.revision,
    command: { ...PLAN, startTick: -1 },
  }, scenario);
  expect(badTime.ok).toBe(false);
  if (badTime.ok) throw new Error('bad time accepted');
  expect(badTime.error.code).toBe('INVALID_TIME');
  expect(hashState(badTime.state)).toBe(hashState(applied));
  expect(applied.projects).toHaveLength(1);
  expect(applied.revision).toBe(1);
});

test('a multi-reach command with one bad reach is all-or-nothing', () => {
  const scenario = withReach(makeScenario('minimal'), secondReach());
  const state = createGame(scenario, 7);
  const before = hashState(state);
  const result = applyCommand(state, {
    commandId: 'multi', expectedRevision: 0,
    command: { ...PLAN, reachIds: ['ab', 'ac', 'missing'] },
  }, scenario);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('bad multi-reach accepted');
  expect(result.error.code).toBe('INVALID_TARGET');
  expect(result.state.projects).toHaveLength(0);
  expect(result.state.commitments).toHaveLength(0);
  expect(hashState(result.state)).toBe(before);
});

test('cancel before start refunds each sponsor separately; a second cancel does nothing', () => {
  const base = makeScenario('minimal');
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      actors: [...base.initial.actors, {
        id: 'court', name: 'court', kind: 'royal', regionIds: ['a'], goals: ['prestige'],
        treasury: 1000, executionCapacity: 10000, commitmentIds: [], actionIds: [],
      }],
    },
  };
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', { ...PLAN, startTick: 2, sponsorIds: ['central', 'court'] });
  expect(state.projects[0]!.phase).toBe('planned');
  const centralBefore = state.actors.find(actor => actor.id === 'central')!.treasury;
  const courtBefore = state.actors.find(actor => actor.id === 'court')!.treasury;
  expect(centralBefore).toBe(10000 - 120);
  expect(courtBefore).toBe(1000 - 120);
  state = applyOk(state, scenario, 'cancel', { type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled' });
  expect(state.projects[0]!.status).toBe('cancelled');
  expect(state.actors.find(actor => actor.id === 'central')!.treasury).toBe(10000);
  expect(state.actors.find(actor => actor.id === 'court')!.treasury).toBe(1000);
  expect(state.commitments.every(commitment => commitment.status === 'withdrawn'
    && commitment.refunded === 120 && commitment.reserved === 0)).toBe(true);
  expect(state.liabilities).toHaveLength(0);
  const snapshot = hashState(state);
  const second = applyCommand(state, {
    commandId: 'cancel-2', expectedRevision: state.revision,
    command: { type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled' },
  }, scenario);
  expect(second.ok).toBe(false);
  if (second.ok) throw new Error('double cancel accepted');
  expect(second.error.code).toBe('INVALID_PHASE');
  expect(hashState(second.state)).toBe(snapshot);
});

test('cancel after construction keeps work and reserves minimum safety before refunding', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 1);
  expect(state.projects[0]!.workCompleted).toBe(20);
  state = applyOk(state, scenario, 'cancel', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled',
  });
  const project = state.projects[0]!;
  expect(project.workCompleted).toBe(20);
  expect(project.phase).toBe('cancelled');
  expect(state.reaches[0]!.status).toBe('decommissioning');
  expect(state.liabilities).toHaveLength(1);
  const liability = state.liabilities[0]!;
  expect(liability.reachId).toBe('ab');
  expect(liability.minimumTreasury).toBe(20);
  expect(liability.reservedTreasury).toBe(20);
  expect(liability.exitWorkRequired).toBeGreaterThan(0);
  const commitment = state.commitments[0]!;
  expect(commitment.amount).toBe(240);
  expect(commitment.consumed).toBe(20);
  expect(commitment.reserved).toBe(20);
  expect(commitment.refunded).toBe(200);
  expect(commitment.consumed + commitment.reserved + commitment.refunded).toBe(commitment.amount);
  expect(state.actors[0]!.treasury).toBe(10000 - 240 + 200);
});

test('pause keeps work and degrades the reach; resume uses the remaining work', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 2);
  const work = state.projects[0]!.workCompleted;
  state = applyOk(state, scenario, 'pause', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'paused',
  });
  const damage = state.reaches[0]!.damage;
  state = runTicks(state, scenario, 3);
  expect(state.projects[0]!.workCompleted).toBe(work);
  expect(state.reaches[0]!.damage).toBeGreaterThan(damage);
  state = applyOk(state, scenario, 'resume', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'active',
  });
  const resumed = state.projects[0]!;
  expect(resumed.status).toBe('active');
  expect(resumed.earliestCompletionTick).not.toBeNull();
  state = runTicks(state, scenario, 1);
  expect(state.projects[0]!.workCompleted).toBeGreaterThan(work);
});

test('completion enters trial and only the following period starts operation', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 12);
  expect(state.projects[0]!.phase).toBe('trial');
  expect(state.projects[0]!.workCompleted).toBe(240);
  state = tick(state, scenario).state;
  expect(state.projects[0]!.phase).toBe('operating');
});

test('passage windows, load eligibility, closure and restoration are explicit', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  const empty = { official: [], civil: [], trade: [] };
  state = applyOk(state, scenario, 'pass-1', {
    type: 'SET_PASSAGE', reachId: 'ab', policy: 'official_first', maxLoadClass: 'small',
    schedule: { official: [...PERIODS], civil: [0, 1, 2], trade: [] }, closedUntil: 2,
  });
  expect(state.reaches[0]!.schedule.official).toEqual(PERIODS);
  expect(state.reaches[0]!.passage).toBe('official_first');
  expect(state.reaches[0]!.closedUntil).toBe(2);
  const status = passageStatusAt(state.reaches[0]!, 0, 'small');
  expect(status.closed).toBe(true);
  expect(status.open).toBe(false);
  expect(status.loadEligible).toBe(true);
  expect(passageStatusAt(state.reaches[0]!, 0, 'standard').loadEligible).toBe(false);
  expect(passageStatusAt(state.reaches[0]!, 1, 'small').closed).toBe(true);
  state = runTicks(state, scenario, 2);
  expect(state.reaches[0]!.closedUntil).toBeNull();
  const restored = passageStatusAt(state.reaches[0]!, 2, 'small');
  expect(state.reaches[0]!.passage).toBe('official_first');
  expect(restored.closed).toBe(false);
  expect(restored.open).toBe(true);
  expect(restored.priority[0]).toBe('official');
  expect(restored.allowedPurposes).toContain('official');
  expect(restored.allowedPurposes).not.toContain('trade');
  // Input arrays were copied: mutating the caller's array cannot change state.
  const official = [5, 6];
  state = applyOk(state, scenario, 'pass-2', {
    type: 'SET_PASSAGE', reachId: 'ab', policy: 'civil_first', maxLoadClass: 'heavy',
    schedule: { official, civil: [...PERIODS], trade: [] }, closedUntil: null,
  });
  official.push(7);
  expect(state.reaches[0]!.schedule.official).toEqual([5, 6]);
  expect(passageStatusAt(state.reaches[0]!, 5, 'heavy').priority[0]).toBe('civil');
  state = applyOk(state, scenario, 'pass-3', {
    type: 'SET_PASSAGE', reachId: 'ab', policy: 'balanced', maxLoadClass: 'heavy',
    schedule: empty, closedUntil: null,
  });
  expect(passageStatusAt(state.reaches[0]!, 0, 'small').open).toBe(false);
});

test('invalid schedules and closure boundaries return INVALID_TIME without mutation', () => {
  const scenario = makeScenario('minimal');
  const state = createGame(scenario, 7);
  const before = hashState(state);
  const invalidSchedules = [
    { official: [-1], civil: [], trade: [] },
    { official: [36], civil: [], trade: [] },
    { official: [1.5], civil: [], trade: [] },
    { official: [1, 1], civil: [], trade: [] },
  ];
  for (const [index, schedule] of invalidSchedules.entries()) {
    const result = applyCommand(state, {
      commandId: `bad-${index}`, expectedRevision: state.revision,
      command: {
        type: 'SET_PASSAGE', reachId: 'ab', policy: 'balanced',
        maxLoadClass: 'standard', schedule, closedUntil: null,
      },
    }, scenario);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('invalid schedule accepted');
    expect(result.error.code).toBe('INVALID_TIME');
    expect(hashState(result.state)).toBe(before);
  }
  const early = applyCommand(state, {
    commandId: 'early', expectedRevision: state.revision,
    command: {
      type: 'SET_PASSAGE', reachId: 'ab', policy: 'balanced', maxLoadClass: 'standard',
      schedule: { official: [...PERIODS], civil: [], trade: [] }, closedUntil: 0,
    },
  }, scenario);
  expect(early.ok).toBe(false);
  if (early.ok) throw new Error('past closure accepted');
  expect(early.error.code).toBe('INVALID_TIME');
  const unknown = applyCommand(state, {
    commandId: 'unknown', expectedRevision: state.revision,
    command: {
      type: 'SET_PASSAGE', reachId: 'missing', policy: 'balanced', maxLoadClass: 'standard',
      schedule: { official: [], civil: [], trade: [] }, closedUntil: null,
    },
  }, scenario);
  expect(unknown.ok).toBe(false);
  if (unknown.ok) throw new Error('unknown reach accepted');
  expect(unknown.error.code).toBe('INVALID_TARGET');
});

test('mothballing a reach creates a persistent safety liability and blocks reopening', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'mothball', {
    type: 'SET_REACH_STATUS', reachId: 'ab', status: 'mothballed',
  });
  expect(state.reaches[0]!.status).toBe('mothballed');
  expect(state.liabilities).toHaveLength(1);
  expect(state.liabilities[0]!.minimumTreasury).toBe(20);
  expect(state.liabilities[0]!.status).toBe('unresolved');
  const reopen = applyCommand(state, {
    commandId: 'reopen', expectedRevision: state.revision,
    command: { type: 'SET_REACH_STATUS', reachId: 'ab', status: 'active' },
  }, scenario);
  expect(reopen.ok).toBe(false);
  if (reopen.ok) throw new Error('reopened with liability');
  expect(reopen.error.code).toBe('INVALID_PHASE');
  const same = applyCommand(state, {
    commandId: 'same', expectedRevision: state.revision,
    command: { type: 'SET_REACH_STATUS', reachId: 'ab', status: 'mothballed' },
  }, scenario);
  expect(same.ok).toBe(false);
  if (same.ok) throw new Error('same reach status accepted');
  expect(same.error.code).toBe('INVALID_PHASE');
});

test('reroute links old reach disposal and preserves maintenance debt', () => {
  const base = makeScenario('minimal');
  const scenario = withReach({
    ...base,
    parameters: {
      ...base.parameters,
      projects: { ...base.parameters.projects,
        workUnitsByGrade: { ...base.parameters.projects.workUnitsByGrade, small: 60 } },
    },
  }, secondReach());
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'reroute', {
    ...PLAN, projectKind: 'reroute', reachIds: ['ac'], replacesReachId: 'ab',
  });
  state = runTicks(state, scenario, 6);
  expect(state.projects[0]!.workCompleted).toBeGreaterThanOrEqual(60);
  state = tick(state, scenario).state;
  expect(state.projects[0]!.phase).toBe('operating');
  expect(state.reaches.find(reach => reach.id === 'ac')!.status).toBe('active');
  expect(state.reaches.find(reach => reach.id === 'ab')!.status).toBe('decommissioning');
  expect(state.liabilities.some(liability => liability.cause === 'reroute'
    && liability.reachId === 'ab')).toBe(true);
  expect(state.reaches.find(reach => reach.id === 'ab')!.maintenanceCost).toBeGreaterThan(0);
});

test('insufficient sponsor funds and locked funds cannot back two projects', () => {
  const base = makeScenario('minimal');
  const poor: ScenarioDefinition = {
    ...base,
    initial: { ...base.initial, actors: base.initial.actors.map(actor => ({ ...actor, treasury: 100 })) },
  };
  const poorState = createGame(poor, 7);
  const first = applyCommand(poorState, {
    commandId: 'p-1', expectedRevision: 0, command: PLAN,
  }, poor);
  expect(first.ok).toBe(false);
  if (first.ok) throw new Error('unfunded project accepted');
  expect(first.error.code).toBe('INSUFFICIENT_COMMITMENT');
  expect(first.error.relatedIds).toEqual(['central']);
  expect(first.state.projects).toHaveLength(0);

  const tight: ScenarioDefinition = {
    ...base,
    initial: { ...base.initial, actors: base.initial.actors.map(actor => ({ ...actor, treasury: 300 })) },
  };
  let state = createGame(tight, 7);
  state = applyOk(state, tight, 'p-1', PLAN);
  expect(state.actors[0]!.treasury).toBe(60);
  const second = applyCommand(state, {
    commandId: 'p-2', expectedRevision: state.revision, command: PLAN,
  }, tight);
  expect(second.ok).toBe(false);
  if (second.ok) throw new Error('double-locked funds accepted');
  expect(second.error.code).toBe('INSUFFICIENT_COMMITMENT');
  expect(hashState(second.state)).toBe(hashState(state));
});

describe('maintenance and water policy commands', () => {
  test('valid policy changes advance one revision and reject unknown targets', () => {
    const scenario = makeScenario('minimal');
    let state = createGame(scenario, 7);
    state = applyOk(state, scenario, 'maint', {
      type: 'SET_MAINTENANCE', reachId: 'ab', policy: 'intensive',
    });
    expect(state.reaches[0]!.maintenance).toBe('intensive');
    state = applyOk(state, scenario, 'water', {
      type: 'SET_WATER_POLICY', nodeId: 'water-a', policy: 'irrigation_first',
    });
    expect(state.waterNodes[0]!.policy).toBe('irrigation_first');
    const unknown = applyCommand(state, {
      commandId: 'water-bad', expectedRevision: state.revision,
      command: { type: 'SET_WATER_POLICY', nodeId: 'missing', policy: 'balanced' },
    }, scenario);
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error('unknown water node accepted');
    expect(unknown.error.code).toBe('INVALID_TARGET');
  });
});

test('dredge grade changes residual silt and therefore real maintenance burden', () => {
  const scenario = makeScenario('minimal');
  const run = (grade: 'small' | 'standard'): GameState => {
    let state = createGame(scenario, 7);
    state = applyOk(state, scenario, `dredge-${grade}`, {
      ...PLAN, grade, laborMode: 'normal', startTick: 0,
    });
    return runTicks(state, scenario, 21);
  };
  const small = run('small');
  const standard = run('standard');
  expect(small.projects[0]!.phase).toBe('operating');
  expect(standard.projects[0]!.phase).toBe('operating');
  expect(small.reaches[0]!.silt).toBe(3600);
  expect(standard.reaches[0]!.silt).toBe(1800);
  const nextSmall = runTicks(small, scenario, 1);
  const nextStandard = runTicks(standard, scenario, 1);
  const maintenance = (state: GameState): number =>
    state.ledger.labor.find(row => row.activityId === 'maintenance:ab')!.requested;
  expect(maintenance(nextSmall)).toBeGreaterThan(maintenance(nextStandard));
  expect(maintenance(nextStandard)).toBeGreaterThan(0);
});

test('cancelled construction must pay for safe exit before the reach retires', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 1);
  expect(state.projects[0]!.workCompleted).toBe(20);
  state = applyOk(state, scenario, 'cancel', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled',
  });
  const liability = state.liabilities[0]!;
  expect(liability.status).toBe('unresolved');
  expect(state.reaches[0]!.status).toBe('decommissioning');
  const treasuryBefore = state.actors[0]!.treasury;
  const grainBefore = state.inventories.find(inventory => inventory.id === 'stock-a')!.grain;

  const first = runTicks(state, scenario, 1);
  const labor = first.ledger.labor.find(row => row.activityId.startsWith('preservation:'));
  expect(labor).toMatchObject({ allocated: 10, requested: 10 });
  expect(first.liabilities[0]!.exitWorkCompleted).toBe(10);

  let consumedGrain = first.ledger.cargo.consumed;
  state = first;
  for (let index = 0; index < 5; index += 1) {
    state = runTicks(state, scenario, 1);
    consumedGrain += state.ledger.cargo.consumed;
  }
  const resolved = state.liabilities[0]!;
  expect(resolved.status).toBe('resolved');
  expect(resolved.exitWorkCompleted).toBe(resolved.exitWorkRequired);
  expect(resolved.reservedTreasury).toBe(0);
  expect(state.reaches[0]!.status).toBe('retired');
  expect(consumedGrain).toBe(60);
  expect(state.actors[0]!.treasury).toBe(treasuryBefore - 40);
  expect(state.inventories.find(inventory => inventory.id === 'stock-a')!.grain)
    .toBeGreaterThan(grainBefore);
  const commitment = state.commitments.find(candidate => candidate.id === 'commit:p-1:central')!;
  expect(commitment.consumed).toBe(40);
  expect(commitment.reserved).toBe(0);
  expect(commitment.refunded).toBe(200);
  expect(commitment.consumed + commitment.reserved + commitment.refunded).toBe(commitment.amount);
});

test('safe exit triggered by SET_REACH_STATUS is paid work, not a free unlock', () => {
  const scenario = makeScenario('minimal');
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'dispose', {
    type: 'SET_REACH_STATUS', reachId: 'ab', status: 'decommissioning',
  });
  expect(state.reaches[0]!.status).toBe('decommissioning');
  expect(state.liabilities[0]!.status).toBe('unresolved');
  const treasuryBefore = state.actors[0]!.treasury;
  const grainBefore = state.inventories.find(inventory => inventory.id === 'stock-a')!.grain;
  let consumedGrain = 0;
  for (let index = 0; index < 6; index += 1) {
    state = runTicks(state, scenario, 1);
    consumedGrain += state.ledger.cargo.consumed;
  }
  expect(state.liabilities[0]!.status).toBe('resolved');
  expect(state.reaches[0]!.status).toBe('retired');
  expect(consumedGrain).toBe(60);
  expect(state.actors[0]!.treasury).toBe(treasuryBefore - 60);
  expect(state.inventories.find(inventory => inventory.id === 'stock-a')!.grain)
    .toBeGreaterThan(grainBefore);
});

test('safe exit does not advance when site grain is unavailable', () => {
  const base = makeScenario('minimal');
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      regions: base.initial.regions.map(region => region.id === 'a'
        ? { ...region, agriculturalLabor: 0 } : region),
      inventories: base.initial.inventories.map(inventory => inventory.id === 'stock-a'
        ? { ...inventory, grain: 20 } : inventory),
    },
  };
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 1);
  expect(state.projects[0]!.workCompleted).toBe(20);
  state = applyOk(state, scenario, 'cancel', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled',
  });
  state = runTicks(state, scenario, 6);
  expect(state.liabilities[0]!.exitWorkCompleted).toBe(0);
  expect(state.liabilities[0]!.status).toBe('unresolved');
  expect(state.reaches[0]!.status).toBe('decommissioning');
  expect(state.commitments[0]!.reserved).toBe(20);
});

test('safe exit does not advance without treasury after the retained reserve is spent', () => {
  const base = makeScenario('minimal');
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      actors: base.initial.actors.map(actor => actor.id === 'central'
        ? { ...actor, treasury: 240 } : actor),
    },
  };
  let state = createGame(scenario, 7);
  state = applyOk(state, scenario, 'p-1', PLAN);
  state = runTicks(state, scenario, 11);
  expect(state.projects[0]!.workCompleted).toBe(220);
  state = applyOk(state, scenario, 'cancel', {
    type: 'SET_PROJECT_STATUS', projectId: 'project:p-1', status: 'cancelled',
  });
  expect(state.actors[0]!.treasury).toBe(0);
  expect(state.liabilities[0]!.reservedTreasury).toBe(20);
  state = runTicks(state, scenario, 6);
  expect(state.liabilities[0]!.exitWorkCompleted).toBe(20);
  expect(state.liabilities[0]!.status).toBe('unresolved');
  expect(state.liabilities[0]!.reservedTreasury).toBe(0);
  expect(state.reaches[0]!.status).toBe('decommissioning');
  expect(state.actors[0]!.treasury).toBe(0);
});
