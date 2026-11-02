import type {
  CommandErrorCode, GameState, LoadClass, ScenarioDefinition, TickLedger,
} from './types';

export class CommandFailure extends Error {
  readonly code: CommandErrorCode;
  readonly relatedIds: readonly string[];
  constructor(code: CommandErrorCode, message: string, relatedIds: readonly string[] = []) {
    super(message);
    this.name = 'CommandFailure';
    this.code = code;
    this.relatedIds = [...relatedIds];
  }
}

export class InvariantError extends Error {
  constructor(message: string) { super(message); this.name = 'InvariantError'; }
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantError(message);
}

export function assertScenarioIdentity(state: GameState, scenario: ScenarioDefinition): void {
  if (state.scenarioId !== scenario.id || state.scenarioVersion !== scenario.version
      || state.rulesVersion !== scenario.rulesVersion || state.endTick !== scenario.endTick
      || state.calendar.startYear !== scenario.calendar.startYear
      || state.parameters.version !== scenario.parameters.version) {
    throw new Error('Scenario identity/version/calendar mismatch');
  }
}

export function loadRank(value: LoadClass): number {
  return value === 'small' ? 0 : value === 'standard' ? 1 : 2;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

// Split an integer total into stable parts. Ties go to the lexically smaller ID.
export function splitEven(total: number, ids: readonly string[]): readonly number[] {
  if (ids.length === 0) return [];
  const sorted = [...ids].sort();
  const base = Math.floor(total / sorted.length);
  const remainder = total % sorted.length;
  return sorted.map((_, index) => base + (index < remainder ? 1 : 0));
}

export function absoluteClosedUntil(
  closedUntil: number | null, tick: number,
): boolean {
  return closedUntil !== null && tick < closedUntil;
}

export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function checkLedger(ledger: TickLedger, label: string): void {
  for (const balance of [ledger.water, ledger.cargo]) {
    for (const value of Object.values(balance)) {
      assert(isSafeCount(value), `${label} ledger has invalid quantity`);
    }
    assert(balance.opening + balance.incoming === balance.closing + balance.outgoing + balance.consumed,
      'Unbalanced ledger');
  }
}

export function assertStateInvariants(state: GameState): void {
  assert(isSafeCount(state.tick) && state.tick <= state.endTick, 'Invalid tick');
  assert(isSafeCount(state.revision), 'Invalid revision');
  checkLedger(state.ledger, 'state');
  const allocations = new Map<string, number>();
  for (const row of state.ledger.labor) {
    assert(row.regionId.length > 0 && row.activityId.length > 0, 'Invalid labor row ID');
    assert(isSafeCount(row.requested) && isSafeCount(row.allocated) && isSafeCount(row.unmet),
      'Invalid labor row quantity');
    assert(row.allocated <= row.requested, 'Labor allocation exceeds request');
    assert(row.allocated + row.unmet === row.requested, 'Labor row does not reconcile');
    allocations.set(row.regionId, (allocations.get(row.regionId) ?? 0) + row.allocated);
  }
  for (const [regionId, allocated] of allocations) {
    const region = state.regions.find(candidate => candidate.id === regionId);
    assert(region !== undefined, `Labor row references unknown region ${regionId}`);
    assert(allocated <= region.laborCapacity, `Labor in ${regionId} exceeds physical capacity`);
  }
  for (const region of state.regions) {
    assert(isSafeCount(region.population) && isSafeCount(region.laborCapacity), 'Invalid region quantity');
    assert(region.subsistenceLabor <= region.laborCapacity, 'Subsistence exceeds regional capacity');
  }
  for (const actor of state.actors) assert(isSafeCount(actor.treasury), 'Negative actor treasury');
  for (const inventory of state.inventories) {
    assert(isSafeCount(inventory.grain) && isSafeCount(inventory.materials), 'Negative inventory');
  }
  for (const reach of state.reaches) {
    assert(reach.silt >= 0 && reach.silt <= 10000 && reach.damage >= 0 && reach.damage <= 10000,
      'Invalid reach condition');
  }
  for (const project of state.projects) {
    assert(project.workCompleted <= project.workRequired, 'Project work exceeds requirement');
    assert(isSafeCount(project.workCompleted) && isSafeCount(project.workRequired), 'Invalid project work');
    assert(project.trialTicksRemaining >= 0, 'Invalid trial countdown');
  }
  for (const commitment of state.commitments) {
    assert(commitment.consumed + commitment.reserved + commitment.refunded === commitment.amount,
      'Commitment does not reconcile');
  }
  for (const liability of state.liabilities) {
    assert(liability.exitWorkCompleted <= liability.exitWorkRequired, 'Liability exit work exceeds requirement');
    assert(liability.reservedTreasury <= liability.minimumTreasury, 'Liability reserve exceeds minimum');
  }
  const allIds = new Set<string>();
  for (const collection of [state.regions, state.actors, state.actions, state.inventories,
    state.waterNodes, state.waterEdges, state.transportNodes, state.transportEdges, state.reaches,
    state.projects, state.liabilities, state.commitments, state.demands, state.inTransit,
    state.petitions]) {
    for (const entity of collection) {
      assert(!allIds.has(entity.id), `Duplicate entity ID ${entity.id}`);
      allIds.add(entity.id);
    }
  }
}
