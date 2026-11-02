import { expect, test } from 'vitest';
import { applyCommand, createGame, tick } from '../../src/core/index';
import { allocateWeighted } from '../../src/core/labor';
import type { ActorAction, Commitment, GameState, ScenarioDefinition } from '../../src/core/types';
import { inspect, runTicks } from '../fixtures/inspect';
import { makeScenario } from '../fixtures/scenarios';

function layeredScenario(
  military: number, palace: number, agriculturalLabor = 60, projectRequest = 20,
): ScenarioDefinition {
  const base = makeScenario('palace-and-canal');
  const actions: ActorAction[] = [];
  if (military > 0) {
    actions.push({
      id: 'mil-a', actorId: 'central', regionIds: ['a'], kind: 'military',
      phase: 'active', startTick: 0, endTick: 540, laborRequest: military,
      allocationWeight: 1, commitmentIds: [], sourceEventId: null,
    });
  }
  if (palace > 0) {
    actions.push({
      id: 'palace-a', actorId: 'court', regionIds: ['a'], kind: 'palace',
      phase: 'active', startTick: 0, endTick: 540, laborRequest: palace,
      allocationWeight: 1, commitmentIds: [], sourceEventId: null,
    });
  }
  return {
    ...base,
    initial: {
      ...base.initial,
      regions: base.initial.regions.map(region => region.id === 'a'
        ? { ...region, agriculturalLabor } : region),
      actions,
      actors: base.initial.actors.map(actor => actor.id === 'central'
        ? { ...actor, actionIds: military > 0 ? ['mil-a'] : [] }
        : { ...actor, actionIds: palace > 0 ? ['palace-a'] : [] }),
      projects: base.initial.projects.map(project => ({
        ...project,
        laborSources: [{ regionId: 'a', requested: projectRequest, arrived: projectRequest, arrivalTick: 0 }],
        earliestCompletionTick: 13, latestCompletionTick: 17,
      })),
    },
  };
}

function row(state: GameState, activityId: string) {
  const found = state.ledger.labor.find(allocation => allocation.activityId === activityId);
  if (found === undefined) throw new Error(`Missing labor row ${activityId}`);
  return found;
}

test('conscription delays works without spending population', () => {
  const s1 = makeScenario('peace'), s2 = makeScenario('conscription');
  const a = inspect(runTicks(createGame(s1, 11), s1, 9));
  const b = inspect(runTicks(createGame(s2, 11), s2, 9));
  expect(b.populationByRegion.a).toBe(a.populationByRegion.a);
  expect(b.projectWork).toBeLessThan(a.projectWork);
  expect(b.burdenByRegion.a!).toBeGreaterThan(a.burdenByRegion.a!);
  expect(b.laborAllocatedByRegion.a!).toBeLessThanOrEqual(b.laborCapacityByRegion.a!);
  expect(b.laborAllocatedByRegion.a!).toBeGreaterThanOrEqual(0);
});

test('conscription warns before tick 3, stays active through 8 and ends at 9', () => {
  const scenario = makeScenario('conscription');
  let state = createGame(scenario, 3);
  const phases: string[] = [];
  for (let count = 0; count <= 9; count += 1) {
    phases.push(state.actions[0]!.phase);
    if (count < 9) state = runTicks(state, scenario, 1);
  }
  expect(phases[2]).toBe('mobilizing');
  for (const index of [3, 4, 5, 6, 7, 8]) expect(phases[index]).toBe('active');
  expect(phases[9]).toBe('completed');
});

test('layered allocation gives 30/60/5/5 after life labor', () => {
  const scenario = layeredScenario(30, 20);
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  expect(row(state, 'action:mil-a:a')).toMatchObject({ requested: 30, allocated: 30 });
  expect(row(state, 'agriculture:a')).toMatchObject({ requested: 60, allocated: 60 });
  expect(row(state, 'action:palace-a:a')).toMatchObject({ requested: 20, allocated: 5 });
  expect(row(state, 'project:p1:a')).toMatchObject({ requested: 20, allocated: 5 });
  expect(state.ledger.labor.reduce((sum, allocation) => sum + allocation.allocated, 0)).toBe(100);
});

test('mobilization at 70 takes agriculture and leaves no palace or canal labor', () => {
  const scenario = layeredScenario(70, 20);
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  expect(row(state, 'action:mil-a:a').allocated).toBe(70);
  expect(row(state, 'agriculture:a')).toMatchObject({ allocated: 30, unmet: 30 });
  expect(row(state, 'action:palace-a:a').allocated).toBe(0);
  expect(row(state, 'project:p1:a').allocated).toBe(0);
  expect(state.ledger.agricultureLoss[0]).toMatchObject({
    regionId: 'a', allocatedLabor: 30, requiredLabor: 60, lostOutput: 50,
  });
});

test('palace and canal cannot both receive 80 from a 100 pool', () => {
  const scenario = makeScenario('palace-and-canal');
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  const palace = row(state, 'action:palace-a:a').allocated;
  const canal = row(state, 'project:p1:a').allocated;
  expect(palace).toBeLessThan(80);
  expect(canal).toBeLessThan(80);
  expect(palace + canal).toBeLessThanOrEqual(100);
  expect(row(state, 'action:palace-a:a').unmet).toBeGreaterThan(0);
  expect(row(state, 'project:p1:a').unmet).toBeGreaterThan(0);
});

test('same-tier caps redistribute and weights multiply effective demand', () => {
  const capped = allocateWeighted(20, [
    { activityId: 'A', requested: 100, weight: 1, cap: 5 },
    { activityId: 'B', requested: 100, weight: 1 },
  ]);
  expect(capped.get('A')).toBe(5);
  expect(capped.get('B')).toBe(15);

  const proportional = allocateWeighted(20, [
    { activityId: 'canal', requested: 80, weight: 1 },
    { activityId: 'palace', requested: 20, weight: 1 },
  ]);
  expect(proportional.get('canal')).toBe(16);
  expect(proportional.get('palace')).toBe(4);

  const weighted = allocateWeighted(20, [
    { activityId: 'canal', requested: 80, weight: 1 },
    { activityId: 'palace', requested: 20, weight: 2 },
  ]);
  expect(weighted.get('canal')).toBe(13);
  expect(weighted.get('palace')).toBe(7);
});

test('largest remainder then activityId settles equal demands; zero pools are safe', () => {
  const result = allocateWeighted(10, [
    { activityId: 'b', requested: 100, weight: 1 },
    { activityId: 'a', requested: 100, weight: 1 },
    { activityId: 'c', requested: 100, weight: 1 },
  ]);
  expect([result.get('a'), result.get('b'), result.get('c')]).toEqual([4, 3, 3]);
  expect(allocateWeighted(0, [{ activityId: 'a', requested: 10, weight: 1 }]).size).toBe(0);
  expect(allocateWeighted(10, [{ activityId: 'a', requested: 0, weight: 1 }]).size).toBe(0);
  expect(allocateWeighted(10, [{ activityId: 'a', requested: 10, weight: 0 }]).size).toBe(0);
});

test('effective request cannot exceed remaining work and excess idles', () => {
  const base = layeredScenario(0, 100);
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      projects: base.initial.projects.map(project => ({
        ...project, workCompleted: 239,
        laborSources: [{ regionId: 'a', requested: 20, arrived: 20, arrivalTick: 0 }],
      })),
      regions: base.initial.regions.map(region => region.id === 'a'
        ? { ...region, agriculturalLabor: 0, laborCapacity: 20 } : region),
    },
  };
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  const project = row(state, 'project:p1:a');
  expect(project.requested).toBe(1);
  expect(project.allocated).toBeLessThanOrEqual(1);
  expect(row(state, 'action:palace-a:a').allocated).toBe(20);
  expect(state.ledger.labor.reduce((sum, allocation) => sum + allocation.allocated, 0)).toBe(20);
});

test('remote labor is not credited before it arrives', () => {
  const base = makeScenario('peace');
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      projects: base.initial.projects.map(project => ({
        ...project, laborSources: [{ regionId: 'b', requested: 20, arrived: 0, arrivalTick: 1 }],
      })),
    },
  };
  const initial = createGame(scenario, 1);
  expect(inspect(runTicks(initial, scenario, 1)).projectWork).toBe(0);
  expect(inspect(runTicks(initial, scenario, 2)).projectWork).toBe(20);
});

test('funds and labor available but zero site grain stall the work without negative stock', () => {
  const base = makeScenario('peace');
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      regions: base.initial.regions.map(region => ({ ...region, agriculturalLabor: 0 })),
      inventories: base.initial.inventories.map(inventory => inventory.id === 'stock-a'
        ? { ...inventory, grain: 0 } : inventory),
    },
  };
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  expect(row(state, 'project:p1:a').allocated).toBe(20);
  expect(state.projects[0]!.workCompleted).toBe(0);
  expect(state.inventories.find(inventory => inventory.id === 'stock-a')!.grain).toBe(0);
  expect(state.actors[0]!.treasury).toBeGreaterThanOrEqual(0);
  expect(state.commitments[0]!.reserved).toBe(240);
});

test('burden recovers gradually after forced labor stops', () => {
  const scenario = makeScenario('conscription');
  let state = runTicks(createGame(scenario, 3), scenario, 9);
  const burden = state.regions[0]!.corveeBurden;
  expect(burden).toBeGreaterThan(0);
  const paused = applyCommand(state, {
    commandId: 'pause', expectedRevision: state.revision,
    command: { type: 'SET_PROJECT_STATUS', projectId: 'p1', status: 'paused' },
  }, scenario);
  expect(paused.ok).toBe(true);
  if (!paused.ok) throw new Error(paused.error.message);
  const later = runTicks(paused.state, scenario, 5);
  expect(later.regions[0]!.corveeBurden).toBeCloseTo(Math.max(0, burden - 10), 0);
  expect(later.regions[0]!.corveeBurden).toBeLessThan(burden);
});

test('maintenance demand is capped by the regional pool and cannot overdraw it', () => {
  const base = layeredScenario(0, 100);
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      regions: base.initial.regions.map(region => region.id === 'a'
        ? { ...region, agriculturalLabor: 60, laborCapacity: 100 } : region),
      reaches: base.initial.reaches.map(reach => ({ ...reach, maintenanceLabor: 100 })),
      projects: base.initial.projects.map(project => ({
        ...project, laborSources: [{ regionId: 'a', requested: 20, arrived: 20, arrivalTick: 0 }],
      })),
    },
  };
  const state = runTicks(createGame(scenario, 1), scenario, 1);
  expect(row(state, 'maintenance:ab').allocated).toBe(40);
  expect(row(state, 'action:palace-a:a').allocated).toBe(0);
  expect(row(state, 'project:p1:a').allocated).toBe(0);
  expect(state.ledger.labor.reduce((sum, allocation) => sum + allocation.allocated, 0)).toBe(100);
  expect(state.ledger.labor.every(allocation => allocation.allocated <= allocation.requested)).toBe(true);
});

test('an effective human action withdraws only unused revocable funds', () => {
  const base = makeScenario('peace');
  const revocable: Commitment = {
    id: 'commit-revoke', actorId: 'central', projectId: null, regionId: 'a',
    resource: 'treasury', amount: 200, consumed: 20, reserved: 180, refunded: 0,
    fromTick: 0, untilTick: 540, firmness: 'revocable', status: 'escrowed',
    sourceEventId: 'event:war-a',
  };
  const hard: Commitment = {
    ...revocable, id: 'commit-hard', amount: 100, consumed: 0, reserved: 100, refunded: 0,
    firmness: 'hard', sourceEventId: 'event:war-a',
  };
  const action: ActorAction = {
    id: 'withdraw-a', actorId: 'central', regionIds: ['a'], kind: 'military',
    phase: 'proposed', startTick: 3, endTick: 9, laborRequest: 0, allocationWeight: 1,
    commitmentIds: ['commit-revoke', 'commit-hard'], sourceEventId: 'event:war-a',
  };
  const scenario: ScenarioDefinition = {
    ...base,
    initial: {
      ...base.initial,
      commitments: [...base.initial.commitments, revocable, hard],
      actions: [...base.initial.actions, action],
      actors: base.initial.actors.map(actor => actor.id === 'central'
        ? { ...actor, treasury: actor.treasury - 280,
          commitmentIds: [...actor.commitmentIds, 'commit-revoke', 'commit-hard'],
          actionIds: [...actor.actionIds, 'withdraw-a'] }
        : actor),
    },
  };
  let state = createGame(scenario, 7);
  const treasuryBefore = state.actors[0]!.treasury;
  state = runTicks(state, scenario, 2);
  expect(state.actions[0]!.phase).toBe('mobilizing');
  expect(state.commitments.find(item => item.id === 'commit-revoke')!.reserved).toBe(180);
  state = tick(state, scenario).state;
  expect(state.actions[0]!.phase).toBe('active');
  const withdrawn = state.commitments.find(item => item.id === 'commit-revoke')!;
  expect(withdrawn).toMatchObject({
    status: 'withdrawn', reserved: 0, consumed: 20, refunded: 180,
    sourceEventId: 'event:war-a',
  });
  expect(withdrawn.consumed + withdrawn.reserved + withdrawn.refunded).toBe(withdrawn.amount);
  const stillHard = state.commitments.find(item => item.id === 'commit-hard')!;
  expect(stillHard).toMatchObject({ status: 'escrowed', reserved: 100, consumed: 0, refunded: 0 });
  const projectCommitment = state.commitments.find(item => item.id === 'commit-p1')!;
  expect(projectCommitment).toMatchObject({ status: 'escrowed', refunded: 0 });
  expect(projectCommitment.reserved).toBe(180);
  expect(state.actors[0]!.treasury).toBe(treasuryBefore + 180);
  const afterWithdrawal = state;
  state = runTicks(state, scenario, 2);
  expect(state.actors[0]!.treasury).toBe(afterWithdrawal.actors[0]!.treasury);
  expect(state.commitments.find(item => item.id === 'commit-revoke')).toEqual(withdrawn);
});
