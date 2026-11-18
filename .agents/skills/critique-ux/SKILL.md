---
name: critique-ux
description: Run a focused UX critique on a rendered screen — visual hierarchy, affordances, and information density — and output a prioritised P1/P2/P3 fix list. Use for quick functional feedback without a full visual polish audit.
---
# critique-ux
Run a focused functional critique on a screen. Covers the three dimensions most likely to block task completion: whether actions are discoverable, whether the right information is present, and whether priority is clear.

Input: a screen name, screenshot path, or Figma URL. Kiosk screenshots live in `critique/screenshots/`.

## Steps
1. **Visual hierarchy** — Identify entry point and whether the primary action reads clearly using the `critique-visual-hierarchy` skill.
2. **Affordance** — Evaluate clickability signals, state visibility, CTA clarity, and action discoverability using the `critique-affordance` skill.
3. **Information density** — Assess cognitive load, content priority, scanning patterns, and progressive disclosure using the `critique-information-density` skill.
4. **Prioritise** — Collect every flagged issue and rank them:
   - **P1 — Critical**: Blocks task completion or hides a required action; fix before shipping.
   - **P2 — Important**: Slows the user or creates confusion; fix in current sprint.
   - **P3 — Polish**: Minor friction or clarity improvement; address when capacity allows.

## Output
A prioritised fix list grouped by level. Each item includes:
- **Issue**: what is wrong
- **Dimension**: Hierarchy / Affordance / Density
- **Fix**: the specific change required

Conclude with one sentence summarising the biggest functional risk on the screen.
