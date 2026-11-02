import { splitEven } from './invariants';
import type { ActorAction, GameState } from './types';

export interface ActivityDemand {
  regionId: string;
  actorId: string;
  activityId: string;
  tier: 1 | 2 | 3 | 4;
  requested: number;
  weight: number;
}

export function transitionActions(
  state: GameState, nextTick: number,
): readonly ActorAction[] {
  return state.actions.map(action => {
    let phase = action.phase;
    if (phase === 'proposed') {
      if (nextTick >= action.endTick) phase = 'completed';
      else if (nextTick >= action.startTick) phase = 'active';
      else if (nextTick >= action.startTick - 1) phase = 'mobilizing';
    } else if (phase === 'mobilizing') {
      if (nextTick >= action.endTick) phase = 'completed';
      else if (nextTick >= action.startTick) phase = 'active';
    } else if (phase === 'active' && nextTick >= action.endTick) {
      phase = 'completed';
    }
    return phase === action.phase ? action : { ...action, phase };
  });
}

export function actionLaborDemands(state: GameState, nextTick: number): readonly ActivityDemand[] {
  const demands: ActivityDemand[] = [];
  for (const action of state.actions) {
    if (action.phase === 'proposed' || action.phase === 'completed'
        || action.phase === 'cancelled' || action.phase === 'escalated') continue;
    // Effective at settlement k-1 -> k: a request effective at tick k must
    // occupy labor in that settlement, not one settlement later.
    if (nextTick < action.startTick || nextTick >= action.endTick) continue;
    if (action.laborRequest <= 0) continue;
    const regionIds = [...action.regionIds].sort();
    const shares = splitEven(action.laborRequest, regionIds);
    regionIds.forEach((regionId, index) => {
      demands.push({
        regionId,
        actorId: action.actorId,
        activityId: `action:${action.id}:${regionId}`,
        tier: action.kind === 'military' || action.kind === 'relief' ? 1 : 4,
        requested: shares[index] ?? 0,
        weight: action.allocationWeight,
      });
    });
  }
  return demands;
}
