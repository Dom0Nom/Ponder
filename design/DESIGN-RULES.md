# Design rules (from user feedback)

Reference screen: `Space Screen v2.dc.html` → 2a (light) and 2b (dark). Every new screen follows it.

- Neutral grays only, no warm/beige tint. Light: chrome #f6f6f6, content #fff, borders #e6e6e6/#efefef, text #111 / #404040 / #6b6b6b.
- Color only for meaning (red delete, green/red right-wrong). Solid black (or white in dark) only for 1–2 primary actions per area. Selected items = light gray fill, never solid black.
- One font: IBM Plex Sans everywhere. No mono/uppercase labels; section headings are 12px 600 gray.
- Minimal: no captions, decorative labels, filler, fake accounts or features the app doesn't have.
- One clear control instead of several; buttons must match real app behavior. Icon-only buttons need clear meaning or a tooltip.
- Important info big and readable (e.g. timer 56px). Use empty space well.
- Simulations of real objects (e.g. TI-30XS) must match the real thing closely.
- Back decisions with real desktop apps (Mobbin) when unsure.

# Workflow per page
Every page needs light + dark. Order: design light → design dark → review light → fix light → fix dark → review light → review dark → fix light and dark.
