-- Wesley's Greenlight chores (Allowance + Pay per chore)
-- days_of_week: 0 = Sun … 6 = Sat
insert into public.wesley_chore_templates (chore_title, emoji, days_of_week, category, reward_cents, sort_order) values
  ('Read',                        '📚', '{0,1,2,3,4,5,6}', 'allowance',     0,   1),
  ('Brush your teeth - morning',  '🦷', '{0,1,2,3,4,5,6}', 'allowance',     0,   2),
  ('Brush your teeth - bedtime',  '🦷', '{0,1,2,3,4,5,6}', 'allowance',     0,   3),
  ('feed the cats!',              '🐱', '{0,1,2,3,4,5,6}', 'pay_per_chore', 25,  4),
  ('Read to Lachlan',             '📚', '{2,4,6}',         'pay_per_chore', 50,  5),
  ('Pick up toys in living room', '🧸', '{1,3}',           'pay_per_chore', 300, 6),
  ('Do the laundry',              '🧺', '{1,3,5}',         'pay_per_chore', 300, 7),
  ('Vacuum around the house',     '🧹', '{3}',             'pay_per_chore', 500, 8)
on conflict (chore_title) do update set
  emoji = excluded.emoji,
  days_of_week = excluded.days_of_week,
  category = excluded.category,
  reward_cents = excluded.reward_cents,
  sort_order = excluded.sort_order;
