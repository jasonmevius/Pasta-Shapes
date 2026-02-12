# Responsive Design Proposals (Tablet + Desktop)

These proposals keep the same focused feeling as the mobile homepage while making better use of larger screens.

## Core principle

On wider viewports, preserve **single-task clarity** by keeping one dominant action area and reducing visual noise.

## Proposal A: Centered "Focus Column" (recommended baseline)

- **Viewport range:** 768px and up.
- Keep content in a centered container (`max-width: 960px` on tablet, `max-width: 1120px` on desktop).
- Preserve mobile card stack, but increase whitespace and typography scale.
- Keep primary action cards (Search + Identify) above the fold.

### Why it works
- Feels familiar to mobile users.
- Minimal engineering risk.
- Strong readability and clear hierarchy.

## Proposal B: Two-Panel Task Layout

- **Viewport range:** 900px and up.
- Convert homepage main area into two balanced columns:
  - Left: search by name
  - Right: identify by questions
- Each panel keeps the same card styling used on mobile.
- Add subtle panel headers and concise helper text.

### Why it works
- Larger screens can expose both pathways at once.
- Users can compare options without scrolling.

## Proposal C: Hero + Task Rail

- **Viewport range:** 1024px and up.
- Top section includes compact value statement (1 sentence).
- Under hero, present two prominent action cards in a horizontal rail.
- Optional: lightweight "recently viewed" strip under task rail.

### Why it works
- Gives desktop users context without overwhelming them.
- Retains action-first behavior.

## Suggested breakpoints and spacing

- **Mobile:** up to 767px (current behavior).
- **Tablet:** 768-1023px.
- **Desktop:** 1024px+.
- Increase horizontal page padding by breakpoint:
  - Mobile: 16px
  - Tablet: 24px
  - Desktop: 32px
- Keep line length comfortable (`max 65-75ch` for paragraphs).

## Interaction and visual guidance

- Maintain one visually dominant primary CTA per section.
- Keep navigation low-emphasis relative to task cards.
- Use consistent card heights in two-column layouts to reduce visual jitter.
- Preserve generous touch targets (at least 44px) even on desktop.

## Implementation order

1. Ship Proposal A as the baseline responsive upgrade.
2. Test Proposal B behind a small CSS/layout flag branch.
3. Optionally layer in Proposal C only if homepage messaging needs stronger context.

## Acceptance checks

- Homepage has no cramped text at 768px, 1024px, and 1440px widths.
- Primary tasks are immediately visible without scrolling on common laptop heights.
- Visual hierarchy still emphasizes Search and Identify over secondary content.
