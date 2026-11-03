import { expect, test } from 'vitest';
import { startGame, advanceGame, commandGame, previewGame } from '../../src/game/session.js';

function finish(strategy) {
  let game = startGame('ming', 7);
  for (let count = 0; !game.finished && count < 500; count += 1) {
    if (strategy === 'repair' && game.state.reaches[0].silt > 2500
        && !game.state.projects.some(project => !['operating', 'cancelled'].includes(project.phase))) {
      const command = { type: 'PLAN_PROJECT', projectKind: 'dredge', reachIds: ['ab'],
        grade: 'standard', laborMode: 'normal', startTick: game.state.tick, sponsorIds: ['central'] };
      if (previewGame(command).feasible) game = commandGame(command);
    }
    game = advanceGame(36);
  }
  return game;
}
test('canal decisions change supply and the world ending through normal game entry points', () => {
  const passive = finish('passive');
  const repaired = finish('repair');
  expect(passive.finished.title).toBe('民生凋敝');
  expect(repaired.state.tick).toBe(repaired.state.endTick);
  expect(repaired.metrics.grainDelivered).toBeGreaterThan(passive.metrics.grainDelivered);
  expect(repaired.metrics.emptyWarehouseTicks).toBeLessThan(passive.metrics.emptyWarehouseTicks);
});
test('same game seed and commands reproduce world weather and outcomes', () => {
  const first = finish('repair');
  const second = finish('repair');
  expect(second.hash).toBe(first.hash);
  expect(second.metrics).toEqual(first.metrics);
});
