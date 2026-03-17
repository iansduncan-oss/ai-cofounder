# Mobile-Responsive Dashboard

## Context

The dashboard (`apps/dashboard`) is built with React + Tailwind v4 but was designed desktop-first. On mobile/tablet screens, the sidebar overlaps content, tables overflow, stat card grids don't stack, and the chat interface is unusable. Since the dashboard is a monitoring + control panel (not a marketing site), mobile support focuses on readability and core interactions — checking status, reading briefings, chatting with agents, and approving tasks.

No new packages needed. Tailwind's responsive utilities handle everything.

---

## 1. Sidebar: Collapsible Mobile Drawer

**File:** `apps/dashboard/src/components/layout/sidebar.tsx`

The sidebar already has `aria-expanded` and hamburger toggle state (added in Phase 22 a11y pass). Build on that:

- **Desktop (md+)**: Fixed sidebar, always visible (current behavior)
- **Mobile (<md)**: Hidden by default. Hamburger button in a sticky top bar shows/hides as a slide-over drawer with backdrop overlay
- Clicking a nav link closes the drawer on mobile
- The overlay already has `aria-hidden` — make sure it also prevents body scroll when open (`overflow-hidden` on `<body>`)

Key Tailwind classes: `md:translate-x-0`, `md:static`, `-translate-x-full`, `transition-transform`, `fixed inset-y-0 z-40`

---

## 2. Page Layouts: Stack on Mobile

**Files:** All route files in `apps/dashboard/src/routes/`

Audit each page and fix grid layouts:

| Page | Current | Mobile Fix |
|------|---------|------------|
| `overview.tsx` | 3-col stat grid | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` |
| `hud.tsx` | Multi-col HUD panels | Stack vertically on mobile, keep 2-col on tablet |
| `goals.tsx` | Table view | Horizontal scroll wrapper OR card view on mobile |
| `chat.tsx` | Sidebar + chat area | Hide conversation sidebar behind toggle on mobile |
| `cost-analytics.tsx` | Stat cards + chart | Stack cards, full-width chart |
| `patterns.tsx` | Grid of pattern cards | Single column on mobile |
| `personas.tsx` | Grid of persona cards | Single column on mobile |

For tables that can't easily become cards, wrap in `<div className="overflow-x-auto">`.

---

## 3. Chat Page: Mobile-First Redesign

**File:** `apps/dashboard/src/routes/chat.tsx` + `src/components/chat/`

The chat page is the most complex — it has a conversation sidebar, message list, and input area.

- **Mobile**: Full-screen message list. Conversation sidebar hidden behind a button (top-left). Input area sticky at bottom with reduced padding.
- **Tablet**: Side-by-side but narrower sidebar (200px instead of 280px)
- **Desktop**: Current layout unchanged

The message input should use `position: sticky; bottom: 0` and have adequate touch target sizes (minimum 44x44px for buttons).

Tool call cards and plan cards should truncate/collapse on mobile with an expand toggle.

---

## 4. Typography & Spacing Scale

**File:** `apps/dashboard/src/index.css` or Tailwind config

Add responsive font size adjustments if not already present:
- Headings: smaller on mobile (`text-lg` instead of `text-2xl`)
- Card padding: `p-3 sm:p-4 lg:p-6`
- Page padding: `px-4 sm:px-6 lg:px-8`

Don't override globally — apply per-component where the current spacing breaks on small screens.

---

## 5. Touch Targets & Interactions

Audit all interactive elements for mobile usability:

- Buttons: minimum `h-10 w-10` (40px) touch target, or `min-h-[44px]` for important actions
- Dropdown menus: ensure they don't overflow viewport on mobile
- Dialogs/modals: full-screen on mobile (`sm:max-w-lg` for desktop, `w-full h-full sm:h-auto` for mobile)
- Command palette: full-width on mobile with `top-0` instead of centered

---

## 6. Viewport Meta & Safe Areas

**File:** `apps/dashboard/index.html`

Verify the viewport meta tag is correct:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
```

If any elements are positioned at the bottom of the screen (chat input), add `pb-safe` (env safe-area-inset-bottom) for iOS notch devices.

---

## 7. Tests

Update existing dashboard tests if component structure changes (e.g., sidebar now renders differently). Add:

- `responsive.test.tsx` — test that sidebar renders as drawer on mobile viewport (mock `matchMedia`)
- Verify existing tests still pass with layout changes (they test functionality, not layout, so should be fine)

---

## Verification

1. **Build**: `npm run build` — compiles clean
2. **Tests**: `npm run test -w @ai-cofounder/dashboard` — all 188+ tests pass
3. **Manual — Mobile**: Open dashboard in Chrome DevTools responsive mode (375px iPhone, 768px iPad)
   - Sidebar collapses to hamburger drawer
   - All stat grids stack properly
   - Chat is usable with keyboard on mobile
   - No horizontal overflow on any page
   - Tables scroll horizontally or convert to cards
4. **Manual — Desktop**: No regressions — everything looks identical to current
5. **Manual — Tablet**: 2-column layouts work, sidebar visible but narrower

## Files to Modify

| File | Change |
|------|--------|
| `apps/dashboard/src/components/layout/sidebar.tsx` | Mobile drawer + backdrop + body scroll lock |
| `apps/dashboard/src/routes/overview.tsx` | Responsive grid classes |
| `apps/dashboard/src/routes/hud.tsx` | Responsive grid classes |
| `apps/dashboard/src/routes/goals.tsx` | Table overflow wrapper or card view |
| `apps/dashboard/src/routes/chat.tsx` | Mobile conversation sidebar toggle, sticky input |
| `apps/dashboard/src/routes/patterns.tsx` | Responsive grid |
| `apps/dashboard/src/routes/personas.tsx` | Responsive grid |
| `apps/dashboard/src/components/chat/conversation-sidebar.tsx` | Conditional render for mobile toggle |
| `apps/dashboard/src/components/chat/tool-call-card.tsx` | Collapsible on mobile |
| `apps/dashboard/src/components/common/command-palette.tsx` | Full-width on mobile |
| `apps/dashboard/index.html` | Viewport meta tag verification |
