// G1 measurement: three synthetic three-year strategies on the minimal fixture.
// This is an experimental comparison, not a historical or balance claim.
import { applyCommand, createGame, hashState, tick } from '../src/core/index';
import type { GameState, PlayerCommand, ScenarioDefinition } from '../src/core/types';
import { makeScenario } from '../tests/fixtures/scenarios';

const END_TICK = 108; // three 36-period years
const INITIAL_SILT = 6000; // synthetic severe initial silt in the minimal fixture

type Strategy = 'immediate-major' | 'autumn-segmented' | 'dredge-only';

interface ScheduledCommand { atTick: number; id: string; command: PlayerCommand }

function commandsFor(strategy: Strategy): ScheduledCommand[] {
  const dredge = (id: string, grade: 'small' | 'standard', startTick: number): PlayerCommand => ({
    type: 'PLAN_PROJECT', projectKind: 'dredge', reachIds: ['ab'], grade,
    laborMode: 'normal', startTick, sponsorIds: ['central'],
  });
  if (strategy === 'immediate-major') {
    return [{ atTick: 0, id: 'major', command: dredge('major', 'standard', 0) }];
  }
  if (strategy === 'autumn-segmented') {
    // No seasonal agriculture is modelled in G1. This is a paused/delayed
    // small dredge control, not evidence for an autumn strategy.
    return [
      { atTick: 27, id: 'autumn-plan', command: dredge('autumn', 'small', 27) },
      { atTick: 33, id: 'autumn-pause', command: { type: 'SET_PROJECT_STATUS', projectId: 'project:autumn-plan', status: 'paused' } },
      { atTick: 45, id: 'autumn-resume', command: { type: 'SET_PROJECT_STATUS', projectId: 'project:autumn-plan', status: 'active' } },
    ];
  }
  return [{ atTick: 0, id: 'dredge', command: dredge('dredge', 'small', 0) }];
}

function runStrategy(
  strategy: Strategy, scenario: ScenarioDefinition,
): { state: GameState; operatingTick: number | null } {
  let state = createGame(scenario, 20261102);
  let operatingTick: number | null = null;
  const scheduled = commandsFor(strategy);
  for (let completed = 0; completed < END_TICK; completed += 1) {
    const due = scheduled.filter(entry => entry.atTick === completed);
    for (const entry of due) {
      const result = applyCommand(state, {
        commandId: entry.id, expectedRevision: state.revision, command: entry.command,
      }, scenario);
      if (!result.ok) throw new Error(`${strategy}/${entry.id}: ${result.error.code} ${result.error.message}`);
      state = result.state;
    }
    state = tick(state, scenario).state;
    if (operatingTick === null && state.projects[0]?.phase === 'operating') {
      operatingTick = state.tick;
    }
  }
  return { state, operatingTick };
}

function summary(
  strategy: Strategy, run: { state: GameState; operatingTick: number | null },
): Record<string, number | string | null> {
  const { state, operatingTick } = run;
  const reach = state.reaches.find(candidate => candidate.id === 'ab')!;
  const project = state.projects[0];
  const maintenance = state.ledger.labor.find(row => row.activityId === 'maintenance:ab');
  return {
    strategy,
    tick: state.tick,
    revision: state.revision,
    hash: hashState(state),
    operatingTick,
    projectWork: state.projects.reduce((sum, item) => sum + item.workCompleted, 0),
    projectTreasurySpent: state.projects.reduce((sum, item) => sum + item.treasurySpent, 0),
    projectGrainSpent: state.projects.reduce((sum, item) => sum + item.grainSpent, 0),
    projectPhase: project?.phase ?? null,
    projectStatus: project?.status ?? null,
    treasury: state.actors.find(actor => actor.id === 'central')!.treasury,
    grainA: state.inventories.find(inventory => inventory.id === 'stock-a')!.grain,
    burdenA: state.regions.find(region => region.id === 'a')!.corveeBurden,
    siltRemaining: reach.silt,
    siltRemoved: INITIAL_SILT - reach.silt,
    maintenanceLaborRequested: maintenance?.requested ?? 0,
    damage: reach.damage,
    liabilities: state.liabilities.length,
    committed: state.commitments.reduce((sum, commitment) => sum + commitment.consumed
      + commitment.reserved + commitment.refunded, 0),
  };
}

const scenario = makeScenario('minimal');
const results = (['immediate-major', 'autumn-segmented', 'dredge-only'] as const)
  .map(strategy => summary(strategy, runStrategy(strategy, scenario)));

console.log(`G1 three-year measurement: ${END_TICK} ticks, synthetic minimal fixture, seed 20261102`);
console.table(results);
console.log(JSON.stringify({ endTick: END_TICK, fixture: scenario.id, seed: 20261102, results }, null, 2));
