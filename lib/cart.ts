// Smart gate for Warren's recipe agent: inventory-aware + human-approved.
import { db, unwrap } from './supabase/server';
import { addBacklogItem, listBacklog, listGroceries } from './domain';
import { nextSaturday, todayISO } from './time';
import { postMessage, CHANNELS } from './slack/api';
import { cartBlocks } from './slack/blocks';
import type { CartItem, CartProposal, ProposedRecipe } from './types';

export interface ProposeCartInput {
  delivery_date?: string;
  /** How many dinners Warren's agent would normally plan. Defaults to recipes.length. */
  target_meal_count?: number;
  recipes: ProposedRecipe[];
  extra_items?: { name: string; quantity?: string }[];
  /** Include the household grocery list ("add paper towels"). Default true. */
  include_household_requests?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/s$/, '');

/** "fresh basil" matches fridge "basil"; "cream cheese" does NOT match "cream". */
function sameIngredient(item: string, have: string): boolean {
  const a = norm(item);
  const b = norm(have);
  return !!a && !!b && (a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`));
}

export async function proposeCart(input: ProposeCartInput): Promise<{ proposal: CartProposal; slackError?: string }> {
  if (!Array.isArray(input.recipes)) throw new Error('recipes[] is required');
  const today = todayISO();
  const delivery = input.delivery_date ?? nextSaturday(today);
  const inFridge = await listBacklog();
  const havePerishables = inFridge.flatMap((b) => b.key_perishables);

  // Prefer recipes that use up what's already in the fridge.
  const overlap = (r: ProposedRecipe) =>
    (r.ingredients ?? []).filter((i) => havePerishables.some((h) => sameIngredient(i.name, h))).length;
  const ranked = [...input.recipes].sort((a, b) => overlap(b) - overlap(a));

  const target = input.target_meal_count ?? input.recipes.length;
  const slots = Math.max(0, target - inFridge.length);
  const kept = ranked.slice(0, slots);
  const dropped = ranked.slice(slots);

  const cart = new Map<string, CartItem>();
  const skipped: { name: string; reason: string }[] = [];
  const add = (it: CartItem) => {
    const key = norm(it.name);
    if (!key) return;
    const have = it.source !== 'household' ? havePerishables.find((h) => sameIngredient(it.name, h)) : undefined;
    if (have) {
      if (!skipped.some((s) => norm(s.name) === key)) skipped.push({ name: it.name, reason: `already have ${have}` });
      return;
    }
    const ex = cart.get(key);
    if (ex) {
      if (!ex.source.split(', ').includes(it.source)) ex.source = `${ex.source}, ${it.source}`;
      if (it.quantity && !ex.quantity) ex.quantity = it.quantity;
    } else cart.set(key, { ...it });
  };

  kept.forEach((r) => (r.ingredients ?? []).forEach((i) => add({ name: i.name, quantity: i.quantity, source: r.name })));
  (input.extra_items ?? []).forEach((i) => add({ ...i, source: 'extra' }));

  let groceryIds: string[] = [];
  if (input.include_household_requests !== false) {
    const g = await listGroceries();
    g.forEach((x) => add({ name: x.name, quantity: x.quantity ?? undefined, source: 'household' }));
    groceryIds = g.map((x) => x.id);
  }

  const proposal = unwrap<CartProposal>(
    await db()
      .from('cart_proposals')
      .insert({
        delivery_date: delivery,
        target_meal_count: target,
        kept_recipes: kept,
        dropped_recipes: dropped,
        items: [...cart.values()],
        skipped_items: skipped,
        backlog_snapshot: inFridge,
        grocery_item_ids: groceryIds,
      })
      .select()
      .single(),
    'insert proposal',
  );

  try {
    const msg = await postMessage(CHANNELS.food(), `Proposed order for ${delivery}`, cartBlocks(proposal));
    unwrap(
      await db().from('cart_proposals').update({ slack_channel: msg.channel, slack_ts: msg.ts }).eq('id', proposal.id),
      'save proposal ts',
    );
    return { proposal: { ...proposal, slack_channel: msg.channel, slack_ts: msg.ts } };
  } catch (e) {
    return { proposal, slackError: String(e) };
  }
}

export async function getProposal(id: string): Promise<CartProposal> {
  return unwrap(await db().from('cart_proposals').select('*').eq('id', id).single(), 'get proposal');
}

/** Approve/hold. On approve, new recipes land in the backlog (arriving Saturday). */
export async function decideProposal(id: string, approve: boolean, by: string): Promise<CartProposal> {
  const p = await getProposal(id);
  if (p.status !== 'pending') return p;
  const updated = unwrap<CartProposal>(
    await db()
      .from('cart_proposals')
      .update({ status: approve ? 'approved' : 'rejected', decided_by: by, decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select()
      .single(),
    'decide proposal',
  );
  if (approve) {
    for (const r of p.kept_recipes) {
      await addBacklogItem({
        name: r.name,
        perishables: r.perishables ?? [],
        delivery_date: p.delivery_date,
        added_by: "Warren's agent",
        source_proposal_id: p.id,
      });
    }
    if (p.grocery_item_ids.length) {
      await db().from('grocery_items').update({ status: 'ordered' }).in('id', p.grocery_item_ids);
    }
  }
  return updated;
}

export async function notifyAgent(p: CartProposal) {
  const url = process.env.RECIPE_AGENT_CALLBACK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RECIPE_AGENT_API_KEY ?? ''}` },
      body: JSON.stringify({
        proposal_id: p.id,
        status: p.status,
        delivery_date: p.delivery_date,
        decided_by: p.decided_by,
        recipes: p.kept_recipes,
        items: p.items,
      }),
    });
  } catch (e) {
    console.error('agent callback failed', e);
  }
}
