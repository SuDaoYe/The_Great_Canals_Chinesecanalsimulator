import { expect, test } from 'vitest';
import { allocateWeighted } from '../../src/core/labor';

test('same-tier competition scales by effective request times weight', () => {
  const result = allocateWeighted(20, [
    { activityId: 'canal', requested: 80, weight: 1 },
    { activityId: 'palace', requested: 20, weight: 1 },
  ]);
  expect(result.get('canal')).toBe(16);
  expect(result.get('palace')).toBe(4);
});

test('allocation weight multiplies rather than replaces effective demand', () => {
  const result = allocateWeighted(20, [
    { activityId: 'canal', requested: 80, weight: 1 },
    { activityId: 'palace', requested: 20, weight: 2 },
  ]);
  expect(result.get('canal')).toBe(13);
  expect(result.get('palace')).toBe(7);
});

import { createGame, tick } from '../../src/core/index';
import { makeScenario } from '../fixtures/scenarios';

test('mobilization consumes labor in effective settlement 2 to 3, not one tick later', () => {
  const scenario = makeScenario('conscription');
  let state = createGame(scenario, 11);
  for (let k = 1; k <= 9; k += 1) {
    state = tick(state, scenario).state;
    const military = state.ledger.labor.filter(row => row.activityId.startsWith('action:'))
      .reduce((sum, row) => sum + row.allocated, 0);
    expect(military, `completed tick ${k}`).toBe(k >= 3 && k <= 8 ? 40 : 0);
  }
});
