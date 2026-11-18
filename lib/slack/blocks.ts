// Block Kit builders. Every message is rebuilt from current DB state, so a
// tap on the kiosk and a click in Slack always converge on the same view.
import { NAMES, PARENTS, isClaimableLogistics, isParent } from '../family';
import { daysBetween, fmtDay, fmtShortDate, fmtTime } from '../time';
import type { BacklogItem, CartProposal, DinnerRow, KitchenState } from '../types';
import type { GreenlightSummary } from '../domain';
import { mention } from './api';
import { outstandingPickups, todaysPickups } from '../pickups';

export type Block = Record<string, unknown>;

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const md = (text: string): Block => ({ type: 'section', text: { type: 'mrkdwn', text: trunc(text, 3000) } });
const ctx = (text: string): Block => ({ type: 'context', elements: [{ type: 'mrkdwn', text: trunc(text, 3000) }] });
const divider: Block = { type: 'divider' };
const header = (text: string): Block => ({ type: 'header', text: { type: 'plain_text', text: trunc(text, 150), emoji: true } });
const button = (text: string, action_id: string, value: string, style?: 'primary' | 'danger'): Block => ({
  type: 'button',
  text: { type: 'plain_text', text, emoji: true },
  action_id,
  value,
  ...(style ? { style } : {}),
});

const TYPE_ICON = { pickup: '🚗', appointment: '🩺', late_office: '🏢', general: '📅' } as const;

// ───────────────────────────── Dinner ─────────────────────────────
export function dinnerLine(d: DinnerRow): string {
  const recipe = d.recipe_name ? `*${esc(d.recipe_name)}*` : '';
  const fromFridge = d.linked_backlog_id ? ' _(from the fridge backlog)_' : '';
  if (d.chef === 'takeout') return d.status === 'cooked' ? '🥡 Takeout / fend — done.' : '🥡 Takeout / fend for yourselves tonight.';
  if (d.status === 'unclaimed') return '_Nobody has claimed dinner yet._';
  const who = isParent(d.chef) ? `*${NAMES[d.chef]}*` : '_Someone (unclaimed)_';
  if (d.status === 'cooked') return `✅ ${who} cooked ${recipe || 'dinner'}${fromFridge}.`;
  return `👩‍🍳 ${who} is cooking ${recipe || 'tonight'}${fromFridge}.`;
}

export function dinnerBlocks(s: KitchenState): Block[] {
  const d = s.dinner;
  const blocks: Block[] = [md(`*🍽️ Tonight's dinner*\n${dinnerLine(d)}`)];

  const notes: string[] = [];
  if (d.unavailable.length) notes.push(`🙅 Not tonight: ${d.unavailable.map((p) => NAMES[p]).join(', ')}`);
  for (const l of s.lateTonight) {
    if (l.parent) notes.push(`🏢 ${NAMES[l.parent]}: ${esc(l.title)} until ${fmtTime(l.until)}`);
  }
  for (const c of s.conflicts.filter((c) => c.kind === 'dinner')) notes.push(`⚠️ ${esc(c.message)}`);
  if (notes.length) blocks.push(ctx(notes.join('\n')));

  if (d.status !== 'cooked') {
    const els: Block[] = [
      button("🙋‍♀️ Daniela's cooking", 'dinner_claim:daniela', s.date, d.chef === 'daniela' ? 'primary' : undefined),
      button("🧑‍🍳 Warren's cooking", 'dinner_claim:warren', s.date, d.chef === 'warren' ? 'primary' : undefined),
    ];
    if (s.backlog.length) {
      els.push({
        type: 'static_select',
        action_id: 'dinner_backlog',
        placeholder: { type: 'plain_text', text: '🧊 Cook from backlog…', emoji: true },
        options: s.backlog.slice(0, 100).map((b) => ({
          text: { type: 'plain_text', text: trunc(b.recipe_or_item_name, 75) },
          value: JSON.stringify({ d: s.date, b: b.id }),
        })),
      });
    }
    els.push(button('🥡 Takeout / fend', 'dinner_claim:takeout', s.date));
    if (d.status === 'planned') els.push(button('✅ Mark cooked', 'dinner_cooked', s.date));
    blocks.push({ type: 'actions', block_id: 'dinner_actions', elements: els });

    // "Not tonight" toggles — answers "does anyone actually want to cook?"
    blocks.push({
      type: 'actions',
      block_id: 'dinner_availability',
      elements: PARENTS.map((p) =>
        button(
          d.unavailable.includes(p) ? `↩️ ${NAMES[p]} can cook after all` : `🙅 ${NAMES[p]}: not tonight`,
          `dinner_unavailable:${p}`,
          JSON.stringify({ d: s.date, u: !d.unavailable.includes(p) }),
        ),
      ),
    });
  }
  return blocks;
}

// ─────────────────────────── Backlog text ───────────────────────────
export function backlogLine(b: BacklogItem, today: string): string {
  const age = daysBetween(b.delivery_date, today);
  const when = age < 0 ? `arrives ${fmtShortDate(b.delivery_date)}` : age === 0 ? 'arrived today' : `${age}d in ${b.location}`;
  const warn = age >= 6 ? ' 🔴' : age >= 4 ? ' 🟠' : '';
  const per = b.key_perishables.length ? ` — ${esc(b.key_perishables.join(', '))}` : '';
  return `• ${esc(b.recipe_or_item_name)} _(${when})_${per}${warn}`;
}

// ───────────────────────────── Standup ─────────────────────────────
export function standupBlocks(s: KitchenState): Block[] {
  const blocks: Block[] = [header(`☀️ Good morning — ${fmtDay(s.date)}`), ...dinnerBlocks(s), divider];

  blocks.push(
    s.backlog.length
      ? md(`*🧊 Fridge backlog — ${s.backlog.length} waiting*\n${s.backlog.map((b) => backlogLine(b, s.date)).join('\n')}`)
      : ctx('🧊 Fridge backlog is clear.'),
  );
  blocks.push(divider);

  const important = s.events.filter((e) => e.logistics_type !== 'general');
  const general = s.events.filter((e) => e.logistics_type === 'general');
  const lines = important.map(
    (e) =>
      `${TYPE_ICON[e.logistics_type]} *${fmtTime(e.start_time)}* ${esc(e.title)} — ${
        e.assigned_parent === 'unassigned' ? '❓ _needs an owner_' : `👤 ${NAMES[e.assigned_parent]}`
      }`,
  );
  if (general.length) lines.push(`📅 ${general.length} other calendar event${general.length === 1 ? '' : 's'}`);
  blocks.push(md(`*🚗 Today's logistics*\n${lines.join('\n') || '_Nothing on either calendar today._'}`));

  const clashes = s.conflicts.filter((c) => c.kind === 'clash');
  if (clashes.length) blocks.push(md(`*⚠️ Conflicts*\n${clashes.map((c) => `• ${esc(c.message)}`).join('\n')}`));

  important
    .filter((e) => isClaimableLogistics(e) && e.assigned_parent === 'unassigned')
    .slice(0, 8)
    .forEach((e, i) => {
      blocks.push(ctx(`Who's got *${fmtTime(e.start_time)} ${esc(e.title)}*?`));
      blocks.push({
        type: 'actions',
        block_id: `assign_${i}`,
        elements: PARENTS.map((p) =>
          button(NAMES[p], `logistics_assign:${p}:${i}`, JSON.stringify({ id: e.id, d: s.date })),
        ),
      });
    });

  const done = s.chores.filter((c) => c.completed).length;
  if (s.chores.length) blocks.push(divider, ctx(`🧹 Wesley: ${done}/${s.chores.length} chores checked off today`));
  return blocks;
}

// ──────────────────────── Pickup nudge (#calendar) ────────────────────────
/** 2 PM pickup nudge. Re-rendered whenever a pickup is claimed anywhere. */
export function pickupNudgeBlocks(s: KitchenState, now = new Date()): Block[] {
  const pickups = todaysPickups(s.events, s.date);
  const open = outstandingPickups(pickups, now);
  const blocks: Block[] = [
    open.length
      ? md(
          `⏰ *${open.length === 1 ? 'A pickup still needs' : 'Pickups still need'} an owner today.* ${mention('daniela')} ${mention('warren')}`,
        )
      : md("✅ *All of today's pickups are covered.*"),
  ];
  const lines = pickups.map(
    (e) =>
      `🚗 *${fmtTime(e.start_time)}* ${esc(e.title)} — ${
        e.assigned_parent === 'unassigned' ? '❓ _unclaimed_' : `👤 ${NAMES[e.assigned_parent]}`
      }`,
  );
  if (lines.length) blocks.push(md(lines.join('\n')));
  open.slice(0, 8).forEach((e, i) => {
    blocks.push(ctx(`Who's got *${fmtTime(e.start_time)} ${esc(e.title)}*?`));
    blocks.push({
      type: 'actions',
      block_id: `pickup_assign_${i}`,
      elements: PARENTS.map((p) => button(NAMES[p], `logistics_assign:${p}:${i}`, JSON.stringify({ id: e.id, d: s.date }))),
    });
  });
  if (open.length) {
    blocks.push(ctx('Tap a name, or reply in the thread — e.g. "I\'ve got it", "I\'ll get Wesley", "Warren has both".'));
  }
  return blocks;
}

export function nudgeBlocks(s: KitchenState): Block[] {
  const top =
    s.dinner.status === 'unclaimed'
      ? md(`⏰ *It's 2 PM and dinner is still unclaimed.* ${mention('daniela')} ${mention('warren')}`)
      : md('✅ *Dinner is sorted.*');
  return [top, ...dinnerBlocks(s)];
}

// ──────────────────────────── Cart proposal ────────────────────────────
export function cartBlocks(p: CartProposal): Block[] {
  const blocks: Block[] = [header(`🛒 Proposed order — delivery ${fmtDay(p.delivery_date)}`)];
  const fridge = p.backlog_snapshot ?? [];
  if (fridge.length) {
    blocks.push(
      md(
        `🧊 *${fridge.length} meal${fridge.length === 1 ? '' : 's'} still waiting:* ${fridge
          .map((f) => esc(f.recipe_or_item_name))
          .join(', ')}\nScaled the plan from *${p.target_meal_count}* → *${p.kept_recipes.length}* new recipe${
          p.kept_recipes.length === 1 ? '' : 's'
        }.`,
      ),
    );
  } else {
    blocks.push(md(`🧊 Fridge backlog is clear — planning *${p.kept_recipes.length}* recipes.`));
  }
  if (p.kept_recipes.length) blocks.push(md(`*New recipes*\n${p.kept_recipes.map((r) => `• ${esc(r.name)}`).join('\n')}`));
  if (p.dropped_recipes.length) blocks.push(ctx(`Pushed to a later week: ${p.dropped_recipes.map((r) => esc(r.name)).join(', ')}`));

  const items = p.items.map(
    (i) => `• ${esc(i.name)}${i.quantity ? ` — ${esc(i.quantity)}` : ''}${i.source === 'household' ? ' _(household request)_' : ''}`,
  );
  blocks.push(md(`*Cart — ${p.items.length} item${p.items.length === 1 ? '' : 's'}*\n${items.join('\n') || '_empty_'}`));
  if (p.skipped_items.length) {
    blocks.push(
      md(`*Not ordering — already have it*\n${p.skipped_items.map((s) => `• ${esc(s.name)} _(${esc(s.reason)})_`).join('\n')}`),
    );
  }

  if (p.status === 'pending') {
    blocks.push({
      type: 'actions',
      block_id: 'cart_actions',
      elements: [
        button('👍 Approve Saturday Order', 'cart_approve', p.id, 'primary'),
        button('✋ Hold off', 'cart_reject', p.id, 'danger'),
      ],
    });
  } else {
    blocks.push(
      ctx(
        p.status === 'approved'
          ? `✅ Approved by ${esc(p.decided_by ?? 'someone')} — the agent can place the order.`
          : `✋ Held by ${esc(p.decided_by ?? 'someone')} — the agent will not place this order.`,
      ),
    );
  }
  return blocks;
}

// ──────────────────────────── Greenlight ────────────────────────────
export function greenlightBlocks(g: GreenlightSummary): Block[] {
  const allChores = g.days.flatMap((d) => d.chores);
  const allowanceChores = allChores.filter((c) => (c.reward_cents ?? 0) === 0);
  const allowanceDone = allowanceChores.filter((c) => c.completed).length;
  const bonusCents = allChores
    .filter((c) => c.completed && (c.reward_cents ?? 0) > 0)
    .reduce((sum, c) => sum + (c.reward_cents ?? 0), 0);
  const bonusTotalCents = allChores
    .filter((c) => (c.reward_cents ?? 0) > 0)
    .reduce((sum, c) => sum + (c.reward_cents ?? 0), 0);

  const blocks: Block[] = [
    header(`💰 Wesley's chores — ${fmtShortDate(g.start)} to ${fmtShortDate(g.end)}`),
    md(
      `*Allowance:* ${allowanceDone}/${allowanceChores.length} done   ·   *Pay per chore:* $${(bonusCents / 100).toFixed(2)} of $${(
        bonusTotalCents / 100
      ).toFixed(2)} earned`,
    ),
  ];
  const lines = g.days.map(
    (d) =>
      `*${fmtShortDate(d.date)}*  ${d.chores
        .map((c) => {
          const tag = (c.reward_cents ?? 0) > 0 ? ` ($${((c.reward_cents ?? 0) / 100).toFixed(2)})` : '';
          return `${c.completed ? '✅' : '⬜'} ${esc(c.chore_title)}${tag}`;
        })
        .join('   ')}`,
  );
  if (lines.length) blocks.push(md(lines.join('\n')));
  blocks.push(ctx('Check these off in the Greenlight app before the allowance payout, then tap below.'));
  blocks.push(
    g.verified
      ? ctx('✅ Reconciled in Greenlight.')
      : {
          type: 'actions',
          block_id: 'greenlight_actions',
          elements: [button('✅ Reconciled in Greenlight', 'greenlight_verified', JSON.stringify({ s: g.start, e: g.end }), 'primary')],
        },
  );
  return blocks;
}
