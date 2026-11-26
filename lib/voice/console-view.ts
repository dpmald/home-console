export type ViewMode = 'ambient' | 'dinner' | 'bento' | 'timeline';
export type MemberFilter = 'all' | 'school' | 'daniela' | 'warren' | 'wesley' | 'lachlan';
export type BoardSource = 'saved' | 'demo' | 'unconfirmed';

export function readViewRequest(args: Record<string, unknown>, currentFilter: MemberFilter) {
  const { view, member = currentFilter } = args;
  if (view !== 'ambient' && view !== 'dinner' && view !== 'bento' && view !== 'timeline') {
    throw new Error('Choose a kitchen view.');
  }
  if (member !== 'all' && member !== 'school' && member !== 'daniela' && member !== 'warren' && member !== 'wesley' && member !== 'lachlan') {
    throw new Error('Choose a valid family filter.');
  }
  return { view, member_filter: member } as const;
}

// A generic meal can temporarily display the salmon template while its recipe loads.
export function hasVoiceRecipe(source: BoardSource, dinnerView: string, title: string | null, usingSalmonTemplate: boolean) {
  return source === 'saved' && dinnerView === 'recipe' && !!title?.trim() &&
    (!usingSalmonTemplate || title.trim().toLowerCase() === 'crispy miso salmon rice bowls');
}

interface StepTimer { defaultTimerSecs: number }
export function recipeControl(action: unknown, steps: StepTimer[], index: number, seconds: number, running: boolean) {
  const next = action === 'next' ? index + 1 : action === 'previous' ? index - 1 : index;
  if (next < 0 || next >= steps.length) throw new Error('Already at the first or last recipe step.');
  switch (action) {
    case 'next':
    case 'previous': return { index: next, seconds: steps[next].defaultTimerSecs, running: false };
    case 'current': return { index, seconds, running };
    case 'start_timer': return { index, seconds: seconds > 0 ? seconds : steps[index].defaultTimerSecs, running: true };
    case 'pause_timer': return { index, seconds, running: false };
    default: throw new Error('Unknown recipe step action.');
  }
}
