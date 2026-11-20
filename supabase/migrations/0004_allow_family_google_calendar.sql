-- Forward compatibility for existing databases created before Family Calendar
-- became a separate source. Production already accepts this value; ordinary
-- local refreshes never execute migrations or change production schema.
alter table public.family_logistics
  drop constraint if exists family_logistics_source_calendar_check;

alter table public.family_logistics
  add constraint family_logistics_source_calendar_check
  check (source_calendar in ('warren_outlook', 'daniela_google', 'family_google', 'manual'));
