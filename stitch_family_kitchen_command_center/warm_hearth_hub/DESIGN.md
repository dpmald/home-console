---
name: Warm Hearth Hub
colors:
  surface: '#faf9f5'
  surface-dim: '#dbdad6'
  surface-bright: '#faf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f4f0'
  surface-container: '#efeeea'
  surface-container-high: '#e9e8e4'
  surface-container-highest: '#e3e2df'
  on-surface: '#1b1c1a'
  on-surface-variant: '#59413b'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f2f1ed'
  outline: '#8d716a'
  outline-variant: '#e1bfb7'
  surface-tint: '#ae3110'
  primary: '#ab2f0d'
  on-primary: '#ffffff'
  primary-container: '#cd4725'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb4a2'
  secondary: '#003edb'
  on-secondary: '#ffffff'
  secondary-container: '#2958fe'
  on-secondary-container: '#eaebff'
  tertiary: '#006a46'
  on-tertiary: '#ffffff'
  tertiary-container: '#008559'
  on-tertiary-container: '#f6fff6'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdad2'
  primary-fixed-dim: '#ffb4a2'
  on-primary-fixed: '#3c0700'
  on-primary-fixed-variant: '#891d00'
  secondary-fixed: '#dde1ff'
  secondary-fixed-dim: '#b9c3ff'
  on-secondary-fixed: '#001356'
  on-secondary-fixed-variant: '#0035be'
  tertiary-fixed: '#8ef7c2'
  tertiary-fixed-dim: '#72daa7'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005235'
  background: '#faf9f5'
  on-background: '#1b1c1a'
  surface-variant: '#e3e2df'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 84px
    fontWeight: '800'
    lineHeight: 92px
    letterSpacing: -0.03em
  headline-glance:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 64px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 26px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-data:
    fontFamily: Space Grotesk
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Space Grotesk
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.08em
  numeral-badge:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 32px
    letterSpacing: -0.02em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1.25rem
  margin: 1.75rem
  space-xs: 0.375rem
  space-sm: 0.75rem
  space-md: 1.25rem
  space-lg: 1.75rem
  space-xl: 2.5rem
---

## Brand & Style
The design system powers an always-on, 24-inch landscape touch command center mounted in the heart of the home. Tailored for Daniela, Warren, and Wesley, it merges consumer electronic warmth with tactile hardware charm—drawing equal inspiration from modern ambient displays (Nest Hub Max), tactile audio hardware (Teenage Engineering), and modular Japanese bento layout architecture.

The personality balances clarity with calm domestic friendliness. Because the screen lives in shared kitchen space, it eschews aggressive tech-noir aesthetics, excessive high-gloss glass, and dense enterprise dashboards in favor of an inviting alabaster paper canvas, tactile extruded card surfaces, and rich, cheerful functional accents. The visual hierarchy satisfies dual operational modes:
1. **Glance Mode (6–10 feet):** Immediate, high-contrast, bold display metrics (time, today's schedule, ambient weather, family member current statuses, and timers).
2. **Touch Interaction Mode (Arm's length):** Generous 56px–72px touch targets, soft mechanical pill toggles, audio playback bars, chore checklists, and quick-tap note pads designed for quick inputs with damp, busy hands.

## Colors
The color architecture grounds itself in physical materials: unbleached clay, soft ceramics, warm paper, and matte enameled buttons.

- **Canvas & Backgrounds:** The base canvas is `#F7F6F2` (Warm Alabaster), transitioning to `#FAF8F5` for primary surface tiles and `#FFFFFF` for active interactive items. This eliminates harsh glare while retaining clean, modern radiance in daylight and soft evening kitchen light.
- **Ink & Typography:** High-legibility deep charcoal `#1D1E20` anchors all primary data and bold numerals, preventing the fatigue associated with pure `#000000`. Secondary labels and metadata employ `#5C5E62`, with muted timestamps in `#8C8E94`.
- **Primary Accent (Warm Burnt Coral - `#E85A36` / `#FF6842`):** Used for urgent timers, active states, key alarms, and primary callouts.
- **Secondary Accent (Cobalt Blue - `#2B59FF` / `#3D68FF`):** Dedicated to Warren's family tasks, calendar integrations, and connectivity toggles.
- **Tertiary Accent (Fresh Sage & Mint - `#3AA677` / `#EAF6EE`):** Applied to grocery items, pantry tracking, Daniela's reminders, and completed status badges.
- **Supporting Accents:** 
  - **Solar Gold (`#F5A623`):** Weather status, Wesley’s school badges, and morning alert states.
  - **Soft Terracotta (`#D96B43`):** Gentle ambient notes and secondary timer alerts.

## Typography
Typography is tuned for variable distances. `Plus Jakarta Sans` delivers soft, geometric humanist energy that feels warm and personal while maintaining maximum legibility across the room. `Space Grotesk` is paired exclusively for functional badges, audio timeline counters, micro-caps labels, and hardware-inspired metadata.

- **Glance Distance (6–10ft):** `display-hero` (84px) and `headline-glance` (56px) render current time, kitchen timers, and today's weather temperature. Bold weights are mandatory here to maintain contrast under ambient daylight.
- **Touch Distance (Arm's length):** `headline-md` and `body-lg` form comfortable reading hierarchies for chore lists, recipe steps, and family notes.
- **Hardware Dial Readouts:** Numbers on sliders, volume dials, and timer dials are set in `Space Grotesk` with tabular figures enabled to prevent layout jittering during real-time countdowns.

## Layout & Spacing
Designed explicitly for a fixed 16:9 landscape 24-inch 1080p/4K surface, the spatial layout treats the screen as a modular, high-efficiency bento system.

- **Grid Architecture:** 12-column modular grid with standard margins of `1.75rem` (28px) and inter-card gutters of `1.25rem` (20px). Modules can span 3, 4, 6, 8, or 12 columns with standard row module heights based on a 48px base increment.
- **Zonal Partitioning:**
  - **Left Rail (Persistent Family Anchor, Col 1-3):** Daniela, Warren, and Wesley presence status chips, circular date stamp badge, house ambient status (weather, temperature, home modes).
  - **Center Canvas (Flexible Bento Focus, Col 4-9):** Active kitchen timers, shared master calendar, meal plan schedule, or full-width cooking recipe instructions.
  - **Right Rail (Action & Quick Media, Col 10-12):** Interactive grocery/to-do checklist, sound system waveform player, and sticky memo voice drops.
- **Touch Padding Standards:** All touch items maintain minimum outer hit-boxes of 56px with minimum 12px dead-space separation between adjacent interactive touch targets.

## Elevation & Depth
Depth is physical, tactile, and grounded, emulating precision-molded consumer products rather than floating ethereal windows.

- **The Base Bed:** The screen surface is completely flat `#F7F6F2`.
- **Level 1 (Bento Tile Surface):** Resting bento cards use `#FAF8F5` or pure `#FFFFFF`. They feature a double shadow: an ultra-subtle ambient drop shadow (`0 4px 20px -2px rgba(29, 30, 32, 0.04)`) combined with a crisp 1px structural outer border (`rgba(29, 30, 32, 0.06)`) and a faint top white reflection highlight.
- **Level 2 (Pushed-In / Well Containers):** Input fields, search bars, track scrubber bars, and nested switch tracks feature a subtle debossed inner shadow (`inset 0 2px 4px rgba(29, 30, 32, 0.05)`), creating the sensation of physical carved grooves in plastic or lacquered wood.
- **Level 3 (Tactile Raised Controls):** Interactive pills, hardware-style toggle buttons, and floating timer triggers employ a firm physical drop shadow (`0 6px 14px -3px rgba(232, 90, 54, 0.25)` for primary coral; `0 4px 12px rgba(29, 30, 32, 0.08)` for neutral cards) that visually presses down 2px on touch active states (`:active`).

## Shapes
The shape language uses friendly, structural soft curves reminiscent of high-end consumer hardware.

- **Bento Modules & Master Cards:** Rounded using `rounded-xl` (1.5rem / 24px) for welcoming framing.
- **Interactive Controls & Buttons:** Full pill geometry (`rounded-full` / 9999px) for buttons, status capsules, tag chips, and member tokens.
- **Circular Badges:** Circular (1:1 ratio) geometry for calendar date locks, avatar presences, and rotary timer presets.
- **Micro-containers:** Checkbox markers and mini icons use `rounded-md` (0.5rem / 8px).

## Components

### 1. Buttons & Tactile Pills
- **Primary Action (Burnt Coral):** Solid `#E85A36` background, crisp `#FFFFFF` bold typography, full pill radius. 56px standard height for rapid thumb hits. On press, slight scale reduction (`scale: 0.98`) with reduced elevation shadow.
- **Secondary Action (Warm Ceramic):** Background `#FFFFFF` with 1px border (`#1D1E20` at 10% opacity) and deep charcoal text (`#1D1E20`).
- **Icon Actions:** 48px × 48px circular buttons with centered micro-icons (microphone, camera shutter, timer plus).

### 2. Family Presence & Member Badges
- **Member Chips (Daniela, Warren, Wesley):** Pill-shaped cards featuring a 40px circular photo/avatar, member first name in `headline-sm`, and an ambient status dot (Home: `#3AA677`, Away: `#8C8E94`, In Transit: `#F5A623`).
- **Tactile Toggle:** Tapping a member's badge flips open their individual day agenda and chore allocation with an effortless spring animation.

### 3. Date & Time Badges
- **Circular Date Lockup:** A 72px × 72px ceramic circle featuring the day numeral in `numeral-badge` (28px weight 800) centered above the month in `label-caps` (12px bold, uppercase).
- **Glance Clock:** Giant, uncluttered digital readout (`display-hero`) paired with a tactile coral notification pip when an active timer is running in the background.

### 4. Waveform Audio & Intercom Widget
- **Waveform Visualizer:** Vertical audio bars representing active smart home intercom notes or streaming kitchen music. Bars use 4px width, 3px pill rounding, animating smoothly between `#E85A36` and `#2B59FF`.
- **Playback Capsule:** Scrubbing track set inside a debossed surface container with a tactile floating draggable scrubber head.

### 5. Checklists & Pantry Inputs
- **Interactive Checkboxes:** 28px × 28px rounded squares (`rounded-md`). Unchecked states use a soft warm border with cream fill. Checked states snap into `#3AA677` fill with a bold white checkmark and strikethrough animation across the item label.
- **Input Fields:** Recessed "groove" style with `#EFECE6` fill, no harsh borders, subtle inner shadow, and prominent 18px touch-friendly typing or speech-to-text dictate icon.

### 6. Kitchen Timer Cards
- Dedicated stacked cards showing active countdowns with dual controls: a large pause/play circular button and an instant `+1m` pill bump button. Active timers pulse with an ambient burnt coral rim glow.