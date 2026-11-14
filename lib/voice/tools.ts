// Tool definitions for the realtime voice model. Safe to import on client.
const fn = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: 'function' as const, name, description, parameters: { type: 'object', properties, required } });

const parent = { type: 'string', enum: ['daniela', 'warren'] };

/** Tools executed in the browser (audio, timers) rather than on the server. */
export const CLIENT_TOOL_NAMES = new Set(['set_timer', 'cancel_timers', 'play_npr', 'stop_npr', 'end_session']);

export const VOICE_TOOLS = [
  fn('get_today_overview', "Today's dinner plan, fridge backlog, Wesley's chores, calendar logistics & conflicts, grocery list."),
  fn(
    'set_dinner',
    'Set who is cooking dinner tonight and optionally what. chef "takeout" = takeout / fend for yourselves.',
    {
      chef: { type: 'string', enum: ['daniela', 'warren', 'takeout'] },
      recipe_name: { type: 'string', description: 'Dish. If it matches a fridge-backlog meal it gets linked.' },
    },
    ['chef'],
  ),
  fn('not_tonight', 'Record that a parent can NOT cook tonight (or undo it).', { parent, unavailable: { type: 'boolean' } }, ['parent']),
  fn('mark_dinner_cooked', "Mark tonight's dinner cooked (also clears a linked fridge-backlog meal)."),
  fn(
    'update_fridge_item',
    'Mark a fridge/pantry backlog meal or item as cooked or discarded (tossed).',
    { name: { type: 'string' }, status: { type: 'string', enum: ['cooked', 'discarded'] } },
    ['name', 'status'],
  ),
  fn(
    'add_fridge_item',
    'Add leftovers, a meal kit or a notable ingredient to the fridge/pantry backlog.',
    {
      name: { type: 'string' },
      perishables: { type: 'array', items: { type: 'string' } },
      location: { type: 'string', enum: ['fridge', 'pantry', 'freezer'] },
    },
    ['name'],
  ),
  fn(
    'add_grocery_item',
    'Add an item to the household shopping list (goes into the next Saturday order proposal).',
    { name: { type: 'string' }, quantity: { type: 'string' } },
    ['name'],
  ),
  fn("set_chore_done", "Check off (or un-check) one of Wesley's chores for today.", { chore: { type: 'string' }, done: { type: 'boolean' } }, ['chore']),
  fn("assign_logistics", "Assign today's pickup / appointment to a parent.", { event: { type: 'string' }, parent }, ['event', 'parent']),
  fn('get_weather', 'Current weather plus today and tomorrow forecast.'),
  fn(
    'post_to_slack',
    'Post a short message to the family Slack.',
    { channel: { type: 'string', enum: ['logistics', 'food'] }, message: { type: 'string' } },
    ['channel', 'message'],
  ),
  fn('set_timer', 'Start a kitchen timer.', { minutes: { type: 'number' }, seconds: { type: 'number' }, label: { type: 'string' } }),
  fn('cancel_timers', 'Cancel all kitchen timers.'),
  fn('play_npr', 'Play the NPR live stream on the kitchen speakers.'),
  fn('stop_npr', 'Stop the NPR stream.'),
  fn('end_session', 'End the conversation when the user is done ("thanks", "that\'s all", "never mind").'),
];
