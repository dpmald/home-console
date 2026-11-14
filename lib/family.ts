import type { Parent, SourceCalendar } from './types';

export const NAMES: Record<Parent, string> = { daniela: 'Daniela', warren: 'Warren' };
export const KID = 'Wesley';
export const PARENTS: Parent[] = ['daniela', 'warren'];

export const isParent = (x: unknown): x is Parent => x === 'daniela' || x === 'warren';

export function ownerOfCalendar(src: SourceCalendar): Parent | null {
  if (src === 'warren_outlook') return 'warren';
  if (src === 'daniela_google') return 'daniela';
  return null;
}

export const SOURCE_LABEL: Record<SourceCalendar, string> = {
  warren_outlook: "Warren's Outlook",
  daniela_google: "Daniela's Google",
  manual: 'Added manually',
};
