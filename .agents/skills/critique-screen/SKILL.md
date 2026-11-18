---
name: critique-screen
description: Run all seven visual critiques (hierarchy, brand, composition, typography, colour, affordance, density) on a rendered screen and output a single prioritised P1/P2/P3 fix list. Use when the user asks for a full visual critique of a screen, screenshot, or Figma frame.
---
# critique-screen
Run a full visual critique of a screen across hierarchy, brand, composition, typography, colour, affordance, and information density.

Input: a screen name, screenshot path, or Figma URL. Kiosk screenshots live in `critique/screenshots/`.

## Steps
1. **Visual hierarchy** — Analyse entry point, eye flow, weight, and emphasis using the `critique-visual-hierarchy` skill.
2. **Brand consistency** — Check mood, voice, and token alignment using the `critique-brand-consistency` skill (skip any dimension whose reference file is missing).
3. **Composition** — Evaluate balance, whitespace, rhythm, and gestalt using the `critique-composition` skill.
4. **Typography** — Audit scale, readability, consistency, and token compliance using the `critique-typography` skill.
5. **Colour** — Audit contrast ratios, palette coherence, semantic colour use, and accessibility using the `critique-color` skill.
6. **Affordance** — Evaluate clickability signals, state visibility, CTA clarity, and action discoverability using the `critique-affordance` skill.
7. **Information density** — Assess cognitive load, content priority, scanning patterns, and progressive disclosure using the `critique-information-density` skill.
8. **Prioritise** — Collect every flagged issue from all seven critiques and rank them:
   - **P1 — Critical**: Breaks usability, accessibility, or brand compliance; fix before shipping.
   - **P2 — Important**: Degrades experience or creates inconsistency; fix in current sprint.
   - **P3 — Polish**: Minor visual refinement; address when capacity allows.

## Output
A single prioritised fix list grouped by priority level. Each item includes:
- **Issue**: what is wrong
- **Dimension**: Hierarchy / Brand / Composition / Typography / Colour / Affordance / Density
- **Fix**: the specific change required

Conclude with a one-paragraph overall assessment noting the strongest and weakest dimension.
