import type { CalendarDefinition, GameDate, Tick } from './types';

export const TICKS_PER_YEAR = 36;

export function dateAtTick(calendar: Readonly<CalendarDefinition>, tick: Tick): GameDate {
  if (!Number.isSafeInteger(tick) || tick < 0 || !Number.isSafeInteger(calendar.startYear)) {
    throw new RangeError('Calendar requires integer startYear and nonnegative safe tick');
  }
  const year = calendar.startYear + Math.floor(tick / TICKS_PER_YEAR);
  if (!Number.isSafeInteger(year)) throw new RangeError('Calendar year overflow');
  const periodOfYear = tick % TICKS_PER_YEAR;
  return { year, month: Math.floor(periodOfYear / 3) + 1, period: (periodOfYear % 3 + 1) as 1 | 2 | 3 };
}
