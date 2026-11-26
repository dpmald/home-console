import type { DinnerTipsPayload, StructuredRecipePayload } from '@/app/api/dinner-tips/route';

export type GuideView = 'steps' | 'tips';
export type DinnerGuide = StructuredRecipePayload | DinnerTipsPayload;

/** Touch and voice can request the same meal as the Dinner Hub changes view. */
export function createDinnerGuideLoader(fetcher: typeof fetch = fetch) {
  const pending = new Map<string, Promise<DinnerGuide>>();
  return (view: GuideView, meal: string) => {
    const url = `/api/dinner-tips?meal=${encodeURIComponent(meal)}&mode=${view === 'steps' ? 'recipe' : 'tips'}`;
    const existing = pending.get(url);
    if (existing) return existing;
    const loading = fetcher(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) }).then(async response => {
      if (!response.ok) throw new Error('The dinner guide is unavailable.');
      const guide: DinnerGuide = await response.json();
      const content = view === 'steps' && guide && 'steps' in guide ? guide.steps
        : view === 'tips' && guide && 'tips' in guide ? guide.tips : null;
      if (typeof guide?.mealTitle !== 'string' || guide.mealTitle.trim().toLowerCase() !== meal.trim().toLowerCase()
        || !Array.isArray(content) || !content.length) {
        throw new Error('The console has no matching dinner guide yet.');
      }
      return guide;
    }).finally(() => pending.delete(url));
    pending.set(url, loading);
    return loading;
  };
}
