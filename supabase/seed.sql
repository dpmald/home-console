-- Sample chores for Wesley — edit freely in the Supabase table editor.
-- days_of_week: 0 = Sun … 6 = Sat
insert into public.wesley_chore_templates (chore_title, emoji, days_of_week, sort_order) values
  ('Make bed',                  '🛏️', '{0,1,2,3,4,5,6}', 1),
  ('Clear plate after dinner',  '🍽️', '{0,1,2,3,4,5,6}', 2),
  ('Pack backpack for tomorrow','🎒', '{0,1,2,3,4}',     3),
  ('Take out recycling',        '♻️', '{2}',             4),
  ('Tidy bedroom',              '🧸', '{6}',             5)
on conflict (chore_title) do nothing;
