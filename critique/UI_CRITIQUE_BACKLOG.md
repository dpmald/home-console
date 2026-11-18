# Home Console 24" Kiosk — Visual Critique Backlog

Generated from the 1920×1080 (24" horizontal display) `/critique-screen` audit.
All **P1** items have been resolved in `components/KioskBoard.tsx`, `components/ThemeToggle.tsx`, and `app/globals.css`.

---

## Completed (P1 — Critical)
- [x] **P1 #1 — Duplicate crescent-moon icons & undersized 38×38px utility buttons** (`Affordance`): Replaced `bedtime` with `power_settings_new` on the Sleep Display button and increased all three bottom-right utility buttons (`ThemeToggle`, `Kitchen Guide`, `Sleep Display`) from `38×38px` to `48×48px`.
- [x] **P1 #2 — Empty void & tiny touch targets in Ambient "Tonight's Dinner Decision" card** (`Composition` / `Affordance` / `Typography`): Added a pantry quick-ideas callout bar when `state.backlog.length === 0` and expanded the 2×2 chef assignment buttons into tactile hardware tiles (`minHeight: 108px`, `46×46px` color-coded icon badges, `1.05rem` bold headings + action subtitles, and high-contrast `var(--surface)` elevation in both light and dark modes).
- [x] **P1 #3 — Shifting bottom navigation dock across modes** (`Affordance` / `Composition`): Kept `Ambient`, `Dinner Hub`, `Chores & Schedule`, `Gemini`, `NPR Live`, and `Spotify` stationary in the bottom hardware dock across all views, with `Ambient` showing `.active` when on the home view and `min-height: 48px` across all `.dock-tab` buttons.

---

## Backlog: P2 — Important (Next Sprint)

### [ ] 1. Remove false primary emphasis on "Takeout / Delivery" in Dinner Hub claim banner
- **Dimension**: Visual Hierarchy (Emphasis) / Colour (Semantic Use) / Affordance (CTA Clarity)
- **Location**: `components/KioskBoard.tsx` (`STATE C: UNDECIDED DINNER`, ~line 3370)
- **Problem**: In the *"Nobody has claimed dinner tonight"* banner, `Takeout / Delivery` uses a saturated cobalt blue fill and blue text (`--cobalt-surface` / `--cobalt`), making it look either already selected or like the recommended primary CTA, while `Leftovers / Fend` uses recessed `--surface-well` (reading as disabled) and `Daniela's cooking` / `Warren's cooking` use white outline fills.
- **Fix**: Give all four unclaimed-dinner choice buttons uniform resting surface styling (`background: var(--surface)`, `border: 1.5px solid var(--border)`), using colored icon badges to differentiate each option and reserving solid/tinted fills exclusively for the selected state.

### [ ] 2. Make empty states in "Chores & Schedule" actionable and reclaim dead vertical space
- **Dimension**: Information Density (Content Priority) / Affordance (Action Discoverability) / Composition (Whitespace)
- **Location**: `components/KioskBoard.tsx` (~lines 4495 and 4880)
- **Problem**: When `state.events.length === 0` and `state.chores.length === 0`, both columns display a single narrow beige strip inside ~650px of empty white space (*"No calendar events match this filter."* / *"No chores scheduled yet."*) with no next action.
- **Fix**: Add a brief status explanation and an interactive button to each empty state (e.g., `Reset Filter` / `Sync Calendar` on the left; `+ Load Wesley's Daily Chores` on the right), and allow the bottom `Tonight's Dinner` and `Pantry Cart Staging` strips to expand when the upper lists are empty.

### [ ] 3. Fix truncated right-rail headings and sub-12px micro-badges in Dinner Hub
- **Dimension**: Typography (Readability & Scale Usage) / Information Density (Scanning Pattern)
- **Location**: `components/KioskBoard.tsx` (Dinner Hub right rail: `UPCOMING`, `TAKEOUT`, `MEAL PLAN`)
- **Problem**: `Wed: Warren Coo...` truncates *"Cooking"* on a single line despite ample vertical card space, and bottom metadata badges (`3 SCHEDULED`, `FAVORITES READY`, `~18–30m`, `6/7 DAYS`, `1 NEEDED`) render at `10px–11px`, which is too small to read comfortably on a 24" 1080p display.
- **Fix**: Allow right-rail card titles to wrap up to 2 lines (`lineClamp: 2`) and raise minimum badge/metadata font sizes to `12px–13px` (`0.75rem–0.8125rem`).

### [ ] 4. Replace hardcoded `Oct 25–27` date range in Dinner Hub `UPCOMING` card
- **Dimension**: Information Density (Cognitive Load)
- **Location**: `components/KioskBoard.tsx` (Dinner Hub right rail `UPCOMING` card)
- **Problem**: Displays a static `Oct 25–27` badge next to the live header clock, creating date confusion.
- **Fix**: Compute the upcoming 3-day date window dynamically from `now`.

---

## Backlog: P3 — Polish (When Capacity Allows)

### [ ] 5. Hide or reposition Next.js DevTools badge overlapping bottom-left dock tab
- **Dimension**: Composition (Proximity & Figure/Ground)
- **Location**: `next.config.ts`
- **Problem**: In local development, the floating `N` badge overlaps the bottom-left edge of the first `.dock-tab` button (`Ambient`).
- **Fix**: Set `devIndicators: false` in `next.config.ts`.

### [ ] 6. Widen `/guide` container at 1920×1080 so navigation pills fit on one row
- **Dimension**: Composition (Balance & Rhythm) / Typography (Consistency)
- **Location**: `app/guide/page.tsx`
- **Problem**: `maxWidth: 1080px` leaves 840px of horizontal margin on a 1920px screen and wraps `5. Cozyla 24" Kiosk Setup` onto an orphaned second row.
- **Fix**: Increase `maxWidth` to `1360px` on widescreen viewports so all 6 section pills stay on a single row.

### [ ] 7. Clean up `FRIDGE BACKLOG (0):` dangling colon when backlog is empty
- **Dimension**: Information Density (Cognitive Load) / Typography (Readability)
- **Location**: `components/KioskBoard.tsx` (Chores & Schedule bottom-left dinner strip)
- **Problem**: Renders `FRIDGE BACKLOG (0):` with nothing after the colon when `state.backlog.length === 0`.
- **Fix**: Render `No perishable kits waiting in fridge` (or hide the sub-line) when `state.backlog.length === 0`.
