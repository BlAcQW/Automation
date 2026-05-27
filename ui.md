# Bookly — UI / Design System Specification

> **Read this entire document before writing code.** This is the single source of truth for Bookly's visual identity, landing page, dashboard, and every page after. Implement it precisely. Where a choice is left open, pick the option that best matches the **stated design direction** below — do not invent a new direction.

---

## 1. Product Context

**Bookly** is a WhatsApp-first SaaS for small-business owners. Their customers chat with the business on WhatsApp; a bot handles routine work (bookings, FAQs, reminders, payments, lead capture); the owner runs everything from one dashboard.

- **Primary user:** non-technical small-business owner (salon, clinic, tutor, restaurant, repair shop, agency)
- **Secondary user:** their staff
- **Emotional promise:** "Your business runs itself on WhatsApp, and you finally feel in control."
- **Brand personality:** confident, warm, modern, a little cinematic. Not playful-cartoony. Not corporate-sterile. Think **Linear x WhatsApp x a luxury product launch video.**

---

## 2. Design Direction (commit to this, do not drift)

**One sentence:** *Cinematic dark-mode SaaS with a living, breathing green core — like a high-end product film for a tool that happens to live on WhatsApp.*

**Pillars:**
1. **Cinematic depth.** Every hero surface has layered depth: 3D scenes, parallax, soft glows, grain, atmospheric fog. Nothing flat.
2. **Confident green.** Green isn't an accent on white — it's an atmosphere. The product radiates green light.
3. **Editorial type.** Large display type with tight tracking. Hero claims read like a magazine cover, not a tagline.
4. **Quiet density.** The dashboard is dense and useful but never noisy. Generous spacing between sections; tight within them.
5. **Motion with intent.** Every animation pays for itself. One orchestrated reveal beats ten micro-twitches. Never animate just because you can.

**Reference vibes (study these — do not copy):** Linear, Vercel, Arc Browser launch, Rauno Freiberg's site, Cron (pre-Notion-Calendar), Raycast, Apple product pages.

**Anti-patterns — never do these:**
- Generic SaaS purple-to-pink gradients
- Glassmorphism cards floating on stock-photo backgrounds
- Stock "smiling team in office" illustrations
- Inter / Roboto / system fonts as the brand voice
- Bouncy spring animations on everything
- Emoji as decoration (✨🚀💚) in marketing copy

---

## 3. Color System

WhatsApp green pure (`#25D366`) is too "consumer messenger" for a B2B SaaS hero — used alone it makes Bookly look like a WhatsApp clone, not a product. The system below keeps WhatsApp green as a **signal color** (anything WhatsApp-related) and uses a deeper, more refined emerald as the **brand color**.

### 3.1 Tokens (paste into `tailwind.config.ts` and `globals.css`)

```css
:root {
  /* Brand greens */
  --bookly-emerald-50:  #ECFDF5;
  --bookly-emerald-100: #D1FAE5;
  --bookly-emerald-200: #A7F3D0;
  --bookly-emerald-300: #6EE7B7;
  --bookly-emerald-400: #34D399;
  --bookly-emerald-500: #10B981;  /* primary brand */
  --bookly-emerald-600: #059669;
  --bookly-emerald-700: #047857;
  --bookly-emerald-800: #065F46;
  --bookly-emerald-900: #064E3B;
  --bookly-emerald-950: #022C22;

  /* WhatsApp signal (use ONLY for WA-related UI: badges, channel chips, "Open in WhatsApp" CTAs) */
  --wa-green: #25D366;
  --wa-teal:  #128C7E;
  --wa-dark:  #075E54;

  /* Cinematic neutrals (dark mode is primary) */
  --ink-1000: #050807;  /* deepest background */
  --ink-950:  #0A0F0D;  /* page background */
  --ink-900:  #0F1614;  /* surface */
  --ink-800:  #161E1B;  /* elevated surface */
  --ink-700:  #1E2825;  /* border */
  --ink-600:  #2A3632;  /* divider */
  --ink-500:  #3D4B46;
  --ink-400:  #5C6B65;
  --ink-300:  #8A9994;  /* muted text */
  --ink-200:  #B6C2BD;  /* secondary text */
  --ink-100:  #DCE5E1;
  --ink-50:   #F2F6F4;  /* primary text on dark */

  /* Accent — used sparingly for highlights, focus rings, data-viz */
  --mint:   #5EEAD4;
  --lime:   #BEF264;
  --amber:  #FBBF24;  /* warnings only */
  --rose:   #FB7185;  /* errors only */

  /* Atmospheric */
  --glow-emerald: 0 0 80px rgba(16, 185, 129, 0.35);
  --glow-soft:    0 0 120px rgba(110, 231, 183, 0.15);
  --grain-opacity: 0.04;
}

/* Light mode (toggle, not default) */
[data-theme="light"] {
  --ink-1000: #FFFFFF;
  --ink-950:  #FAFBFA;
  --ink-900:  #F2F6F4;
  --ink-800:  #E7EDEA;
  --ink-700:  #D4DEDA;
  --ink-50:   #0A0F0D;  /* primary text on light */
  --ink-200:  #3D4B46;
  --ink-300:  #5C6B65;
}
```

### 3.2 Semantic mapping

| Token | Use |
|---|---|
| `--ink-950` | Page background |
| `--ink-900` | Cards, modals, sidebar |
| `--ink-800` | Hover state, raised surfaces |
| `--ink-700` | Hairline borders (`1px solid`) |
| `--ink-50` | Primary text |
| `--ink-200` | Secondary text |
| `--ink-300` | Muted/placeholder |
| `--bookly-emerald-500` | Primary CTAs, brand accents, active states |
| `--bookly-emerald-400` | Hover on primary |
| `--bookly-emerald-300` | Glow underlays, highlights, gradient stops |
| `--wa-green` | ONLY WhatsApp signal UI (channel badges, "Connected to WhatsApp" pill, "Open chat in WhatsApp" buttons) |
| `--mint`, `--lime` | Data viz, sparingly |

### 3.3 The "Bookly glow"
A signature radial gradient used behind the hero, inside primary CTAs on hover, and behind active sidebar items:

```css
.bookly-glow {
  background: radial-gradient(
    ellipse at center,
    rgba(16, 185, 129, 0.45) 0%,
    rgba(16, 185, 129, 0.15) 30%,
    transparent 70%
  );
  filter: blur(60px);
}
```

---

## 4. Typography

**Reject Inter, Roboto, system fonts.** Use these:

| Role | Font | Source | Why |
|---|---|---|---|
| **Display** (h1, hero, big numbers) | **Cabinet Grotesk** | [Fontshare](https://www.fontshare.com/fonts/cabinet-grotesk) | Geometric, slightly editorial, distinctive lowercase `g` and `a`. Weighty without being a slab. |
| **Body** (everything else) | **Satoshi** | [Fontshare](https://www.fontshare.com/fonts/satoshi) | Clean, modern, very readable at small sizes, pairs with Cabinet without competing. |
| **Mono** (code anim, numeric data, tabular UI) | **JetBrains Mono** | Google Fonts | Excellent ligatures, designed for code. |

Install both Fontshare fonts via their CSS or self-host the woff2 files in `/public/fonts/` for performance.

### 4.1 Type scale (Tailwind extend)

```ts
fontSize: {
  // Display — Cabinet Grotesk, tracking tight
  'display-2xl': ['clamp(3.5rem, 8vw, 7rem)', { lineHeight: '0.95', letterSpacing: '-0.04em', fontWeight: '700' }],
  'display-xl':  ['clamp(2.75rem, 6vw, 5rem)', { lineHeight: '1.0',  letterSpacing: '-0.035em', fontWeight: '700' }],
  'display-lg':  ['clamp(2.25rem, 4vw, 3.5rem)', { lineHeight: '1.05', letterSpacing: '-0.03em', fontWeight: '600' }],
  'display-md':  ['2rem',   { lineHeight: '1.1',  letterSpacing: '-0.025em', fontWeight: '600' }],

  // UI — Satoshi
  'h1': ['2rem',   { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
  'h2': ['1.5rem', { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '600' }],
  'h3': ['1.25rem',{ lineHeight: '1.3', letterSpacing: '-0.01em',  fontWeight: '600' }],
  'body-lg': ['1.125rem', { lineHeight: '1.6', fontWeight: '400' }],
  'body':    ['1rem',     { lineHeight: '1.55', fontWeight: '400' }],
  'body-sm': ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
  'caption': ['0.75rem',  { lineHeight: '1.4', letterSpacing: '0.02em', fontWeight: '500', textTransform: 'uppercase' }],
},
fontFamily: {
  display: ['"Cabinet Grotesk"', 'sans-serif'],
  sans:    ['Satoshi', 'system-ui', 'sans-serif'],
  mono:    ['"JetBrains Mono"', 'monospace'],
}
```

### 4.2 Type rules
- Hero headlines use `font-display`, weight 700, tracking `-0.04em`, line-height `0.95`.
- Body copy never goes below `0.875rem` for primary content.
- Eyebrow labels (above headlines): `caption` style — uppercase, tracked out, `text-bookly-emerald-400`.
- Numbers in dashboards: `font-mono` with `font-feature-settings: "tnum"` for tabular figures.

---

## 5. Tech Stack (install exactly these)

```bash
# Core
next@14 react@18 typescript tailwindcss

# UI primitives
@radix-ui/react-* (via shadcn/ui)
lucide-react
class-variance-authority clsx tailwind-merge

# Motion
motion              # (formerly framer-motion) — primary animation lib
gsap @gsap/react    # ScrollTrigger + complex timelines
lenis               # buttery smooth scrolling

# 3D
three @react-three/fiber @react-three/drei
@react-three/postprocessing  # bloom, depth-of-field, grain

# Code animation
shiki               # syntax highlighting (NOT prism — shiki gives VS Code-quality colors)

# Forms & data
react-hook-form zod @hookform/resolvers
@tanstack/react-query
@tanstack/react-table

# Charts (for dashboard)
recharts            # or visx if needs are advanced

# Utilities
date-fns
sonner              # toast notifications
vaul                # iOS-style bottom sheets on mobile
```

**Initialize shadcn/ui** with the "new-york" style, base color `neutral`, then override with our tokens.

---

## 6. Global Setup

### 6.1 File structure (Next.js App Router)

```
app/
  (marketing)/
    layout.tsx           # marketing nav + footer
    page.tsx             # landing
    pricing/page.tsx
    features/page.tsx
    about/page.tsx
  (auth)/
    login/page.tsx
    signup/page.tsx
  (app)/
    layout.tsx           # dashboard shell (sidebar + topbar)
    dashboard/page.tsx
    inbox/page.tsx
    contacts/page.tsx
    bot/page.tsx
    bookings/page.tsx
    settings/page.tsx
  layout.tsx             # root: fonts, providers, theme
  globals.css

components/
  ui/                    # shadcn primitives, restyled to our tokens
  marketing/
    Hero3D.tsx
    HeroScene.tsx        # R3F canvas
    CodeAnimation.tsx
    FeatureCard.tsx
    Marquee.tsx
    PricingTable.tsx
    FooterCinematic.tsx
  app/
    Sidebar.tsx
    Topbar.tsx
    StatCard.tsx
    ConversationList.tsx
    ChatPane.tsx
    BotFlowBuilder.tsx
  primitives/
    GlowButton.tsx       # signature CTA
    MagneticLink.tsx
    GrainOverlay.tsx
    NoiseBackground.tsx
    ScrollReveal.tsx

lib/
  fonts.ts
  utils.ts
  motion.ts              # shared easings, variants

public/
  fonts/                 # self-hosted Satoshi + Cabinet Grotesk woff2
  grain.png              # 200x200 noise texture, ~30kb
```

### 6.2 Root layout essentials

```tsx
// app/layout.tsx — sketch
export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="dark" className={`${cabinet.variable} ${satoshi.variable} ${jetbrains.variable}`}>
      <body className="bg-ink-950 text-ink-50 font-sans antialiased selection:bg-bookly-emerald-500/30 selection:text-ink-50">
        <GrainOverlay />     {/* fixed, pointer-events-none, 4% opacity */}
        <LenisProvider>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </LenisProvider>
      </body>
    </html>
  );
}
```

### 6.3 Grain overlay (always on)
A 200×200 PNG of monochrome noise, fixed-positioned, `mix-blend-overlay`, opacity `0.04`. This single detail prevents the dark UI from looking flat and "rendered." Without it, the cinematic feel collapses.

### 6.4 Smooth scroll
Wrap the app in Lenis for buttery scrolling. Sync GSAP ScrollTrigger to Lenis ticker. Disable on `prefers-reduced-motion`.

---

## 7. Landing Page — Section by Section

The landing page is the showpiece. Build it in this order, ship each section polished before starting the next.

### 7.1 Top navigation (sticky, glassy)

- 72px tall, fixed top, `bg-ink-950/60 backdrop-blur-xl border-b border-ink-700/50`
- Left: Bookly wordmark (Cabinet Grotesk, weight 700, with a small emerald dot after the "y")
- Center: links (Features, Pricing, Customers, Changelog) — body-sm, `text-ink-200`, hover → `text-ink-50` with underline-from-left animation (200ms)
- Right: "Sign in" (ghost), **"Start free" (primary GlowButton)**
- On scroll past hero, nav background darkens to `bg-ink-950/85`

### 7.2 Hero — the cinematic moment

**Layout:** full-viewport-height, dark, with the 3D scene living BEHIND the text. Text is on top, scene is the world.

**Composition (desktop, 1440px frame):**
- Eyebrow (caption style, emerald-400): `WHATSAPP × AUTOMATION × ZERO CODE`
- Headline (display-2xl, max-width 16ch, centered or left-aligned):
  > **Run your whole business**
  > **inside one WhatsApp.**
  
  Last word "WhatsApp" has a subtle emerald gradient text-fill OR is wrapped in a soft underline-glow.

- Sub-headline (body-lg, ink-200, max-width 52ch):
  > Bookly turns WhatsApp into your bookings desk, customer support, and sales pipeline — handled by a bot you can configure in minutes.

- CTA row: **`Start free — no card` (GlowButton primary)** + `Watch 90s demo →` (ghost button with play icon)
- Trust strip below CTAs: tiny text "Trusted by 2,000+ businesses across 14 countries" with 6 monochrome logos (use placeholder logos initially)

**The 3D scene (`HeroScene.tsx`) — React Three Fiber:**

Default concept (build this, don't deviate without reason):

A **floating, slowly rotating smartphone** (use a low-poly device model — `@react-three/drei` has `useGLTF`; or build from primitives: rounded box + slightly inset screen). The screen displays a live WhatsApp conversation that types itself out (HTML overlay positioned over the screen using `<Html>` from drei).

Around the phone:
- 5–8 **floating message bubbles** in 3D space, each a rounded plane with text on it, drifting slowly with sinusoidal motion
- Soft **emerald point light** behind the phone casting a glow
- A **second rim light** from front-right in cool mint
- **Ground fog**: a large transparent plane with a radial gradient texture
- **Bloom** + **chromatic aberration** + **vignette** + **noise** via postprocessing

Camera: slow orbit around Y axis (15° amplitude, 20s period), with mouse parallax (subtle, ±5°).

**Mobile fallback:** disable R3F on `<lg` screens; show a still hero image (export the scene to a PNG) with CSS-animated glow underneath. R3F kills mobile battery — do not run it there.

**Performance budget for the scene:**
- ≤ 30k triangles total
- Single 1k texture for the phone
- 60fps on M1 MacBook Air; 30fps minimum on mid-range Android
- Use `<Preload all />` and `<Suspense>` with a CSS-only skeleton

### 7.3 The Code Animation section (signature moment)

This is the section that makes the page memorable. Headline:

> **Configure your bot the way you'd talk to it.**

Below the headline, a split layout:

**Left side — code editor pane:**
- Window chrome (3 dots, "bot-flow.bookly" filename in mono)
- A live-typing animation cycling through 3 scenarios:
  1. A booking flow (YAML-ish DSL)
  2. An FAQ auto-reply
  3. A payment reminder
- Uses **Shiki** for syntax highlighting (theme: a custom "Bookly Dark" — base on `vesper` or `poimandres`, swap accents to our emerald)
- Typing speed: ~40ms per character with humanized jitter; pauses on punctuation; cursor blinks
- Between cycles, a 400ms "erase" animation, then start next

**Right side — rendered WhatsApp chat:**
- A faithful WhatsApp conversation UI (dark theme) that responds in real-time AS the code on the left is typed
- Customer message appears → bot processes (typing indicator with three dots) → response materializes
- Use the actual WhatsApp message bubble shapes (the small tail on the first bubble in a sequence)
- Background: subtle WhatsApp doodle pattern at 5% opacity

The synchronization between left and right is the magic. Implement with a shared state machine (XState or a simple reducer) driven by the typing animation's progress.

**Implementation note for Claude Code:** start by getting the typing animation working on the left alone, then layer the right-side reactions. Do not try to build both simultaneously.

### 7.4 Feature grid (bento layout)

Headline: **"Everything your business does, in one chat."**

Bento grid, 3 columns desktop / 1 mobile. Cards have varying sizes (some span 2 cols, some 1). Each card:
- Dark surface (`ink-900`) with `border-ink-700`
- Top: a small animated icon or mini illustration (Lottie or SVG with CSS animation)
- Title (`h3`)
- One-line description (`body-sm`, `ink-200`)
- On hover: border shifts to `bookly-emerald-500/40`, faint glow underneath, icon animates

Suggested cards (6–8 total):
1. **Smart inbox** — unified WhatsApp inbox across team members
2. **No-code bot** — drag-to-build conversation flows
3. **Bookings** — calendar sync, reminders, no-shows handled
4. **Payments** — request, confirm, reconcile inside chat
5. **Contacts CRM** — auto-tagged, segmented, exportable
6. **Broadcasts** — compliant bulk messaging that doesn't get you banned
7. **Analytics** — response time, conversion, revenue per chat
8. **Multi-agent** — your whole team in one number

### 7.5 "How it works" — scroll-driven section

A 3-step explainer that animates as the user scrolls. Use GSAP ScrollTrigger pinned for the duration.

Steps:
1. **Connect your WhatsApp Business number** (10 seconds)
2. **Design your bot's behavior** (no code, drag and drop)
3. **Go live, sleep better** (Bookly handles routine, you handle the interesting stuff)

Visual: a horizontal timeline with the step illustration changing as you scroll. Active step has emerald accent and scaled illustration.

### 7.6 Social proof

Two parts:
- **Logo marquee:** infinite horizontal scroll of customer/integration logos. Monochrome, hover reveals color. Pause on hover.
- **Testimonial trio:** 3 testimonial cards in a row, each with avatar (real-looking, not stock-corporate), quote (50-80 words), name, business name, country. Cards subtly tilt on mouse-move (small parallax).

### 7.7 Pricing teaser

Don't put the full pricing table on the homepage — link to `/pricing`. On the homepage, show 3 plan cards in a simplified form:
- **Starter** — Free, 1 number, 500 chats/mo
- **Growth** — featured (emerald border + subtle glow) — $X/mo
- **Scale** — for multi-location, custom

Each card: plan name (h3), price (display-md, mono for the number), 4–6 bullet points (lucide check icons in emerald), CTA button.

### 7.8 Final CTA

Full-bleed section, deep dark with a large emerald glow centered behind text.

> **Your customers are already on WhatsApp.**
> **Meet them there, professionally.**

Single primary CTA: `Start free — 14-day trial of Growth`

### 7.9 Footer

Cinematic, oversized footer:
- Massive Bookly wordmark (display-2xl) faintly visible behind the link columns
- 4 columns: Product, Resources, Company, Legal
- Bottom row: copyright, locale switcher, social icons, status dot ("All systems operational" with emerald pulse)

---

## 8. Dashboard / App Pages

The dashboard is where users live every day. It must be **fast, dense, and calm**. Cinematic flourishes belong in marketing; the app rewards restraint.

### 8.1 Shell layout

- **Sidebar** (left, 240px expanded / 64px collapsed):
  - Bookly mark at top
  - Workspace switcher (dropdown, shows business name + avatar)
  - Nav items with lucide icons: Inbox, Bot, Bookings, Contacts, Broadcasts, Analytics, Settings
  - Active item: emerald left-border (3px) + `bg-ink-800` + emerald icon
  - Hover: `bg-ink-800/50`
  - Bottom: user avatar, name, settings cog
- **Topbar** (h-14, sticky, `border-b border-ink-700`):
  - Page title (h2)
  - Center: command palette trigger (⌘K) — pill-shaped, `bg-ink-900`, `border-ink-700`
  - Right: notifications bell, "Connected to WhatsApp" status pill (wa-green dot + label), avatar
- **Content area**: max-w-7xl, generous padding (`px-8 py-6`)

### 8.2 Inbox page (the heart of the product)

3-column layout:
- **Col 1 (320px)** — conversation list: searchable, filterable (Unread, Assigned to me, Bot-handled, Needs attention). Each row: avatar, name, last message preview, timestamp, unread badge (emerald).
- **Col 2 (flex-1)** — chat pane: faithful WhatsApp-style messages but in our dark theme. Top: contact name + WhatsApp signal pill. Bottom: composer with attachment, emoji, send. AI suggestion chips above composer ("Suggested reply: ...").
- **Col 3 (320px, collapsible)** — contact panel: profile, tags, notes, booking history, custom fields.

### 8.3 Bot builder page

Canvas-based flow editor (use **React Flow** / `@xyflow/react`). Nodes for: Trigger, Message, Question, Condition, Action (booking, payment, handoff). Dark canvas with dot-grid, emerald connection lines, glowing active node.

### 8.4 Dashboard (home) page

- Hero row: 4 StatCards (Active chats, Bookings this week, Revenue from chats, Bot resolution rate). Each: large mono number, label, sparkline, % change pill (emerald if up, rose if down).
- Below: 2-col grid — recent activity feed + weekly chart (Recharts, emerald gradient area).
- Right rail (optional): "Quick actions" + onboarding checklist (if incomplete).

### 8.5 Other pages
Follow the same patterns. Always: dark `ink-950` background, `ink-900` cards, `ink-700` borders, emerald accents only on interactive/active elements.

---

## 9. Component Library

### 9.1 GlowButton (signature CTA)

```tsx
// Primary variant:
// - bg gradient: linear from emerald-500 to emerald-600
// - text: ink-1000 (near black) for max contrast — DO NOT use white on green, it's a contrast failure
// - h-12, px-6, rounded-xl, font-medium
// - On hover: brightness +5%, shadow grows to var(--glow-emerald)
// - On press: scale 0.98, shadow shrinks
// - Inner light sweep on hover: a 20%-opacity white gradient that translates across the button (1.2s ease-out)
```

Variants: `primary` (above), `ghost` (transparent, border `ink-700`, text `ink-50`), `wa` (uses `--wa-green`, only for WhatsApp-bound actions).

### 9.2 Card
- `bg-ink-900`, `border border-ink-700`, `rounded-2xl`, `p-6`
- Hover (when interactive): border → `bookly-emerald-500/40`, subtle inner glow

### 9.3 Input
- `h-11`, `bg-ink-900`, `border border-ink-700`, `rounded-lg`, `px-4`
- Focus: border → `bookly-emerald-500`, ring `4px ring-bookly-emerald-500/15`
- Label above (caption style), helper text below (body-sm `ink-300`)

### 9.4 Toast (Sonner)
- Dark surface, emerald left-border for success, rose for error, amber for warning
- Slide in from bottom-right, 4s default duration

### 9.5 Modal / Dialog (Radix + restyle)
- Overlay: `bg-ink-1000/80 backdrop-blur-md`
- Content: `bg-ink-900 border-ink-700 rounded-2xl`, max-w-md default, animated scale+fade in (180ms)

### 9.6 Badge / Pill
- `h-6 px-2.5 rounded-full text-xs font-medium`
- Variants: `default` (ink-800 / ink-200), `success` (emerald-500/15 / emerald-300), `wa` (wa-green/15 / wa-green), `warning`, `danger`

### 9.7 Command palette (cmdk)
- Triggered by ⌘K / Ctrl+K from anywhere
- Modal-style, dark, with fuzzy search across pages, contacts, bot flows, settings

---

## 10. Motion System

### 10.1 Easings (define once, use everywhere)
```ts
// lib/motion.ts
export const ease = {
  out:    [0.16, 1, 0.3, 1],       // expo out — default
  inOut:  [0.65, 0, 0.35, 1],
  spring: { type: 'spring', stiffness: 260, damping: 24 },
} as const;

export const durations = {
  micro: 0.18,   // hover, focus
  short: 0.32,   // reveals, toggles
  medium: 0.6,   // section enters
  long: 1.2,     // hero orchestration
} as const;
```

### 10.2 Page/section reveal (default pattern)
Each marketing section uses a `ScrollReveal` wrapper that fades + translates children up 24px when 30% in view. Stagger children by 80ms.

### 10.3 Rules
- Never bounce unless it's a deliberate playful moment (and Bookly rarely has those — it's a tool).
- Hover transitions: 180ms max.
- Page transitions in marketing: 400ms crossfade with slight scale (1.02 → 1).
- Inside the dashboard: animations are 150ms or less. The app must feel fast, not animated.
- Respect `prefers-reduced-motion`: disable parallax, 3D camera motion, marquees. Replace with static.

---

## 11. Responsive Strategy

**Mobile-first. Test at 375px, 768px, 1024px, 1440px, 1920px.**

- Hero: 3D scene off below `lg` (1024px). Replace with static image + CSS glow. Headline scales down via `clamp()`.
- Code animation section: stacks vertically on mobile — code on top (collapsed by default with "Tap to expand"), chat below.
- Bento grid: 3-col desktop → 2-col tablet → 1-col mobile.
- Dashboard sidebar: drawer on mobile (slide-in from left with Vaul), full sidebar on desktop.
- Inbox: on mobile, list and chat are separate views (back button), not side-by-side.
- Tap targets: minimum 44×44px. No exceptions.

---

## 12. Accessibility (non-negotiable)

- Contrast: every text/background pair must meet WCAG AA. Verify text on emerald — `ink-1000` on emerald-500 passes; white does not.
- All interactive elements have visible focus rings (emerald, 2px offset).
- 3D scene has a fully-functional non-3D fallback for screen readers + reduced motion.
- All animations respect `prefers-reduced-motion`.
- Form inputs always have associated labels (visible or `aria-label`).
- Semantic HTML: `<nav>`, `<main>`, `<article>`, `<section>` — not div soup.
- Keyboard: every flow completable without a mouse. Command palette is the power-user path.

---

## 13. Performance Budgets

- Lighthouse Performance: ≥ 90 on desktop, ≥ 75 on mobile (3D pages exempt only on desktop)
- LCP: < 2.5s
- Total JS on landing: < 220kb gzipped (defer R3F until after hero is interactive)
- Fonts: self-host as woff2, `font-display: swap`, preload Cabinet Grotesk 700 + Satoshi 400/600
- Images: `next/image`, AVIF + WebP, lazy below the fold
- 3D scene: lazy-loaded, suspended, with skeleton fallback

---

## 14. Implementation Order (do not reorder)

**Phase 1 — Foundation (do this first, completely):**
1. Install dependencies, set up Tailwind config with all tokens
2. Install Fontshare fonts, wire up via `next/font/local`
3. Create `globals.css` with CSS variables, grain overlay, base styles
4. Build the component primitives: `GlowButton`, `Card`, `Input`, `Badge`, `ScrollReveal`
5. Set up shadcn/ui and restyle the primitives we'll use

**Phase 2 — Landing page (top to bottom):**
1. Top navigation
2. Hero — but ship it FIRST without the 3D scene (use a placeholder image). Verify layout + typography sing.
3. Hero 3D scene (separate task, dedicated polish pass)
4. Code animation section
5. Feature bento grid
6. How-it-works scroll section
7. Social proof + testimonials
8. Pricing teaser
9. Final CTA + footer

**Phase 3 — Other marketing pages:** Pricing (full table), Features (deep-dive), About, Changelog. Reuse landing components.

**Phase 4 — Auth pages:** Login, Signup, Forgot password. Split layout (form left, atmospheric visual right with the Bookly glow).

**Phase 5 — Dashboard shell:** Sidebar + Topbar + empty dashboard page.

**Phase 6 — Dashboard pages:** Inbox first (it's the core), then Bot Builder, then Dashboard home, then the rest.

**Phase 7 — Polish pass:** every page reviewed against this doc, motion polished, responsive checked on real devices, a11y audit.

---

## 15. Definition of Done (per page)

A page ships only when:
- [ ] Matches the design direction (cinematic, dark, emerald, editorial type)
- [ ] Renders correctly at 375 / 768 / 1024 / 1440 / 1920
- [ ] All animations respect `prefers-reduced-motion`
- [ ] Lighthouse Perf ≥ 85, A11y = 100
- [ ] No `console.error` in dev or prod
- [ ] All text uses semantic tokens, no hard-coded hex
- [ ] All interactive elements keyboard accessible with visible focus
- [ ] Dark mode is correct; light mode is at least usable (full polish optional)
- [ ] Reviewed against this doc line-by-line

---

## 16. Decisions left to the human (flag these, don't guess)

- Final wordmark / logo file (current spec assumes wordmark in Cabinet Grotesk 700 with emerald dot)
- Final hero headline copy (above is a strong default — A/B later)
- Phone model for 3D scene: iPhone-shaped or generic? (Generic is safer legally; iPhone is more familiar)
- Pricing exact tiers and amounts
- Testimonial / logo content (use realistic placeholders until real customers say yes)

---

## 17. Notes for Claude Code specifically

- Build component-first. Do not start a section by writing 400 lines of JSX. Extract `<Hero>`, `<HeroScene>`, `<HeroCopy>` immediately.
- When in doubt about a color, **always** use a token from §3.1. Never inline a hex.
- Type everything. No `any`.
- Server Components by default; `'use client'` only where state, motion, or 3D requires it.
- Co-locate component-specific motion variants inside the component file.
- For the 3D scene: build it in isolation in a `/sandbox/scene` route first, get it right, THEN integrate into the hero.
- After completing each section, take a screenshot at the 5 breakpoints and self-review against §15.
- If something in this doc conflicts with a later product requirement, **ask before deviating**. Consistency beats cleverness.

---

**End of spec. Build with intention. Cinematic is in the restraint, not the noise.**