import { after, NextResponse, type NextRequest } from 'next/server';
import {
  addBacklogItem, addGrocery, assignLogistics, claimDinner, cookFromBacklog, getKitchenState,
  markDinnerCooked, setBacklogStatus, setGroceryStatus, setNotTonight, toggleChore, unclaimDinner,
} from '@/lib/domain';
import { demoKitchenState } from '@/lib/demo';
import { refreshDinnerMessages } from '@/lib/slack/sync';
import { todayISO } from '@/lib/time';
import type { KioskAction } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const date = todayISO();
  try {
    return NextResponse.json(await getKitchenState(date));
  } catch {
    return NextResponse.json(demoKitchenState(date));
  }
}

export async function POST(req: NextRequest) {
  const date = todayISO();
  const a = (await req.json()) as KioskAction;
  let touchedSlack = false;

  switch (a.type) {
    case 'claim_dinner':
      await claimDinner(date, a.chef, 'kiosk');
      touchedSlack = true;
      break;
    case 'unclaim_dinner':
      await unclaimDinner(date, 'kiosk');
      touchedSlack = true;
      break;
    case 'not_tonight':
      await setNotTonight(date, a.parent, a.unavailable, 'kiosk');
      touchedSlack = true;
      break;
    case 'cook_from_backlog':
      await cookFromBacklog(date, a.backlogId, null, 'kiosk');
      touchedSlack = true;
      break;
    case 'dinner_cooked':
      await markDinnerCooked(date, 'kiosk');
      touchedSlack = true;
      break;
    case 'backlog_status':
      await setBacklogStatus(a.id, a.status);
      touchedSlack = true;
      break;
    case 'add_backlog':
      if (a.name.trim()) {
        await addBacklogItem({ name: a.name.trim(), location: a.location, added_by: 'kiosk' });
        touchedSlack = true;
      }
      break;
    case 'toggle_chore':
      await toggleChore(a.id, a.completed);
      break;
    case 'assign_logistics':
      await assignLogistics(a.id, a.parent);
      touchedSlack = true;
      break;
    case 'add_grocery':
      if (a.name.trim()) await addGrocery(a.name.trim(), null, 'kiosk');
      break;
    case 'grocery_status':
      await setGroceryStatus(a.id, a.status);
      break;
  }

  if (touchedSlack) after(() => refreshDinnerMessages(date));
  return NextResponse.json(await getKitchenState(date));
}
