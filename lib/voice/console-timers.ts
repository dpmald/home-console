export interface KitchenTimer {
  id: string;
  label: string;
  initialSecs: number;
  endsAt: number;
  pausedRemaining?: number;
}

export function remainingSeconds(timer: KitchenTimer, now = Date.now()) {
  return timer.pausedRemaining ?? Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
}

export function describeTimer(timer: KitchenTimer, now = Date.now()) {
  const seconds = remainingSeconds(timer, now);
  const status = !seconds ? 'finished' : timer.pausedRemaining === undefined ? 'running' : 'paused';
  return { label: timer.label, remaining_seconds: seconds, status };
}

export function createKitchenTimer(args: Record<string, unknown>, now = Date.now()): KitchenTimer {
  const minutes = args.minutes ?? 0;
  const seconds = args.seconds ?? 0;
  if (typeof minutes !== 'number' || typeof seconds !== 'number' || minutes < 0 || seconds < 0) {
    throw new Error('Use a positive timer duration.');
  }
  const total = Math.round(minutes * 60 + seconds);
  if (!Number.isFinite(total) || total < 1 || total > 86400) {
    throw new Error('Choose a timer between one second and 24 hours.');
  }
  const label = args.label ?? 'Kitchen Timer';
  if (typeof label !== 'string' || !label.trim() || label.trim().length > 100) {
    throw new Error('Choose a short name for the timer.');
  }
  return { id: crypto.randomUUID(), label: label.trim(), initialSecs: total, endsAt: now + total * 1000 };
}

export function findKitchenTimer(timers: KitchenTimer[], label: unknown) {
  if (label !== undefined && (typeof label !== 'string' || !label.trim())) throw new Error('Which timer?');
  const matches = typeof label === 'string'
    ? timers.filter(timer => timer.label.toLowerCase() === label.trim().toLowerCase())
    : timers;
  if (!matches.length) throw new Error('No matching kitchen timer.');
  if (matches.length > 1) throw new Error('More than one timer matches. Ask for the timer name.');
  return matches[0];
}

export function updateKitchenTimer(timer: KitchenTimer, action: unknown, now = Date.now()): KitchenTimer | null {
  const seconds = remainingSeconds(timer, now);
  switch (action) {
    case 'pause':
      return { ...timer, pausedRemaining: seconds };
    case 'resume':
      if (!seconds) throw new Error('The timer has finished. Reset it before resuming.');
      return timer.pausedRemaining === undefined ? timer : { ...timer, endsAt: now + seconds * 1000, pausedRemaining: undefined };
    case 'reset':
      return { ...timer, pausedRemaining: timer.initialSecs, endsAt: now + timer.initialSecs * 1000 };
    case 'add_minute':
      return {
        ...timer,
        initialSecs: timer.initialSecs + 60,
        endsAt: Math.max(now, timer.endsAt) + 60000,
        pausedRemaining: timer.pausedRemaining === undefined ? undefined : seconds + 60,
      };
    case 'cancel':
      return null;
    default:
      throw new Error('Unknown timer action.');
  }
}
