# Bookly design system

> **Your shop, always open.** The voice is friendly, warm, simple and confident, with no tech jargon.

Use this guide whenever you build or migrate a page. Visual reference: `/design-system`, at
`src/app/(internal)/design-system/`. It is not linked from anywhere and is `noindex`. It shows
every component in the light and dark themes.

## Where things live

| What | Where |
|---|---|
| **All shared components** (canonical home) | `packages/ui/src/components/*`, imported from `@bookingflow/ui` |
| Tailwind tokens (colours, type scale, radius, shadows, fonts) | `packages/ui/src/tailwind-preset.ts` |
| CSS variables (light `:root`, dark `.dark`), global focus, LogoReveal keyframes | `apps/web/src/app/globals.css` |
| Font faces (self-hosted) | `apps/web/src/app/fonts.css`, files and licences in `apps/web/public/fonts/` |
| Toasts (the one web-only helper, because it depends on react-hot-toast) | `apps/web/src/components/brand/toast.tsx` |
| App shell | `apps/web/src/components/dashboard/{shell,sidebar,header,bottom-tab-bar,nav-items,shell-skeleton}.tsx` |
| Legacy marketing styles (`fs-*`), to be deleted by the marketing rebuild | `apps/web/src/app/marketing.css` |
| Cedi and Ghana phone helpers | `packages/ui/src/format.ts` (tested in `format.test.ts`) |

Do not create page-local copies of these components. If you need something new and reusable, add it to
`packages/ui` and export it from `src/index.ts`.

## Tokens

### Colour: semantic classes (use these)

| Token | Light | Dark (planned) | Classes |
|---|---|---|---|
| `bg` | cream `#FAF6EE` | charcoal `#1F2328` | `bg-bg` (page) |
| `surface` | white | `#2A2F35` | `bg-surface` (cards, inputs, bars) |
| `surface-2` | `#F4EFE5` | `#343940` | `bg-surface-2` (hover rows, sunken areas, table head) |
| `text` | charcoal | cream | `text-text` |
| `muted` | `#5F6672` (AA 5.4:1 on cream) | `#B5AFA3` | `text-muted` |
| `border` | `#E7E1D6` | `#40454C` | `border-border` (bare `border` uses this too) |
| `primary` (green) | `#0F6B4F` | same | `bg-primary`, `text-primary`, `bg-primary-hover`, `bg-primary-soft`, `text-primary-fg` |
| `accent` (gold) | `#E8A317` | same | `bg-accent`, `bg-accent-hover`, `bg-accent-soft`, `text-accent-fg` (charcoal on gold) |
| `success` | green | `#3FB68B` | `bg-success`, `bg-success-soft`, `text-success-fg` |
| `warning` | gold | gold | `bg-warning`, `bg-warning-soft`, `text-warning-fg` (`#8A6100`, readable) |
| `error` | `#C0392B` | `#E8735F` | `bg-error`, `bg-error-soft`, `text-error-fg` |
| `focus` | gold | gold | `ring-focus` (the global `:focus-visible` outline is already gold) |
| Fixed hues | | | `gold`, `gold-dark`, `green`, `green-dark`, `charcoal`, `cream` (these do not flip with the theme) |

All semantic colours accept opacity modifiers, for example `bg-primary/10` or `border-text/20`.

**Colour rules**
- Aim for roughly 60% background (cream or charcoal), 30% green and 10% gold.
- **Gold is used sparingly.** Use it for the single most important element on a screen: one accent button, the
  active marker, or the awning. Use gold only for backgrounds, icons and large headings. **Never use gold for body
  text**: gold on cream is 2:1. For gold-ish text, use `text-warning-fg`.
- All text must meet WCAG AA (4.5:1). `text-muted` is the lightest you may go for reading text.
- **Status is always icon + word + colour, never colour alone.** Use `<StatusPill>`.
- Use the WhatsApp greens (`wa-green`, `wa-teal`, `wa-dark`) only for WhatsApp-specific UI.

### Type

| Role | Font | Size (mobile → desktop) | Class |
|---|---|---|---|
| Hero | Clash Display 600 | 40 → 72px | `font-display text-hero` (or `.type-hero`) |
| Page title (one `h1` per page) | Clash Display 600 | 28 → 40px | `<PageHeader>`, or `font-display text-page-title` |
| Section heading | Bricolage 700 | 20 → 24px | `<SectionHeading>`, or `text-section-heading` |
| Body | Bricolage 400 | 16px, never smaller for reading copy | `text-body`, or the default |
| Small / labels | Bricolage 500 | 14px | `text-small` |

Use Clash Display (`font-display`) **only** for the logo, page titles and hero headlines. Everything else uses
Bricolage Grotesque (`font-sans`, the default). Both fonts are self-hosted; do not add Google Fonts `<link>`s.

### Radius, spacing and shadow
- Radius: `rounded-control` is 12px (inputs, buttons, chips, menus). `rounded-card` is 20px (cards). `rounded-card-lg`
  is 24px (hero and feature cards, modals). The stock keys are retuned: `rounded-xl` is 12, `rounded-2xl` is 20 and
  `rounded-3xl` is 24.
- Spacing: a 4px scale (4, 8, 12, 16, 24, 32, 48, 64), which is Tailwind's `1 2 3 4 6 8 12 16`. Do not use
  arbitrary spacing values.
- Shadows are warm brown, never black: `shadow-soft` (buttons, small chips), `shadow-card` (cards), `shadow-card-hover`,
  `shadow-card-lg` (modals) and `shadow-lift`.
- Tap targets are at least 44×44 px. Every component here already meets that.

### Motion
| Use | Timing | Helper |
|---|---|---|
| Hover, press, toggle | 200ms, ease-out | `duration-ui ease-brand-out` |
| Dropdowns, tabs, toasts | 250ms | `durations.short` |
| Modals, drawers, page transitions | 300ms | `durations.medium` |
| Hero and logo reveal | 500–700ms maximum | `<LogoReveal>` |
| List / card stagger | 50–80ms between items (60ms default) | `<Stagger>` + `<StaggerItem>` |
| Button press | scale 0.97 | built into `<Button>` (`pressScale`) |
| Success | draw the tick, then a light spring bounce | `<TickPop>` |

- Elements enter with ease-out and leave with ease-in. Springs are only for ticks and icons.
- **Reduced motion:** every component checks `useReducedMotion()`. The global CSS also cuts animations and
  transitions to about 0ms. Never make meaning depend on motion.
- **Never ship content that stays invisible until JS hydrates on marketing or public pages.** `PageTransition` and
  `Stagger` start at opacity 0, so use them only in the signed-in app. Public pages use the CSS classes
  `.site-enter` and `.site-reveal` (the resting state is visible). `<LogoReveal>` is pure CSS.
- Loading uses skeletons, not spinners. `BooklyDots` is only for tiny inline "loading more" states.

## Components (`@bookingflow/ui`)

| Component | Notes |
|---|---|
| `Button` | variants `primary` (default) · `accent` (gold, once per screen) · `secondary` (outline) · `ghost` · `destructive`. Sizes `sm`/`md`/`lg`/`xl`/`icon`, all at least 44px. Props `isLoading`, `loadingText`, `fullWidth`. Legacy variant names `default`/`outline`/`glow` still work. |
| `Input`, `DashboardInput` | `label`, `hint`, `error` (inline, with icon), `icon`. Password inputs get a show/hide toggle. |
| `Select`, `Textarea`, `Field` | Same label, hint and error pattern. `Field` wraps any custom control. `controlClasses` styles native controls. |
| `PhoneInput` | Fixed `+233` prefix. Groups `24 412 3456` as you type. `onChange(display, e164 \| null)`. |
| `MoneyInput` | Fixed `GH₵` prefix, decimal keypad. `onChange(text, amount \| null)`. |
| `formatCedi(n, { fromPesewas?, compact? })` | `GH₵ 1,250.00`. Use it for **every** money value. |
| `formatGhanaPhone`, `normalizeGhanaPhone`, `isValidGhanaPhone` | Display, store (E.164) and validate Ghana numbers. |
| `Card` (+`CardHeader`, `CardTitle`, `CardContent`) | 20px radius, hairline border, warm shadow. `hover` makes it lift. |
| `StatCard` | Dashboard figure, with an optional change pill. |
| `StatusPill` | `status="paid"` gives a green tick, `"pending"` a gold clock, `"failed"` a red x. It maps most domain statuses. You can override with `tone`. |
| `Badge` | Labels that are not statuses: `neutral`, `success`, `warning`, `error`, `info`, plus the legacy names. |
| `Modal` | Bottom sheet on phones, centred dialog on desktop. Optional `description` and `footer`. Escape and backdrop close it. |
| `Drawer` | Slides in from `right`, `left` or `bottom`. |
| `ConfirmDialog` | For **every destructive action**. Focus starts on the safe button. |
| Toasts (`@/components/brand/toast`) | `notify.success('Booking saved')`, `notify.error()` (shows the friendly default), `notify.promise(p, {...})`. |
| `Skeleton`, `SkeletonLine`, `SkeletonCard`, `SkeletonTableRow`, `SkeletonList` | Wrap them in `aria-busy="true"` plus a visually hidden "Loading…". |
| `EmptyState` | icon, title, one line and **one** action button. |
| `ErrorState` | "Oops, that didn't work. Let's try again." plus next steps and a retry button. |
| `PageHeader` | Clash page title (the page's `h1`), with `subtitle`, `actions` and `eyebrow`. |
| `SectionHeading` | Bricolage 700 `h2`/`h3`, with `description` and `actions`. |
| `Tabs` | Arrow-key navigation, optional counts, animated underline. |
| `SearchInput`, `FilterChips` | Search with a clear button. Chips are toggle buttons and scroll sideways on phones. |
| `ResponsiveTable` | A `<table>` from `md` up and cards below. `hideOnMobile` keeps the cards short. |
| `AwningDivider` | The scalloped gold stripe (`tone`: `gold`, `gold-green` or `solid`; `size`: `sm`, `md` or `lg`). Use it once per view. |
| `TickPop` | Success moment (booking confirmed, order paid, settings saved). Change its `key` to replay it. |
| `BrandLogo` | `variant`: `wordmark`, `icon` (B monogram) or `lockup`; `tone`: `default` or `inverse`. **The one place to swap in the real logo.** |
| `LogoReveal` | Homepage "shop opening" animation. Pure CSS and visible at rest. |
| `PageTransition`, `Stagger`, `StaggerItem`, `useReducedMotion` | App-only motion helpers (see the Motion section). The dashboard shell already wraps every page in `PageTransition`. |

The app shell is handled for you. Every dashboard route's `layout.tsx` uses `DashboardShell`, which provides the
collapsible desktop sidebar, a header with the awning, the mobile bottom tab bar (safe-area aware), a page transition
and a skeleton while loading. Navigation labels live in `components/dashboard/nav-items.ts`.

## LEGACY ALIASES (temporary)

These names still compile so that unmigrated pages keep working. They are re-pointed at the new brand. **Do not use
them in new code.** Remove each one from your page as you migrate it. Every alias is marked `LEGACY ALIASES — remove
when pages migrate` in `tailwind.config.ts`, `tailwind-preset.ts` and `globals.css`.

| Legacy | Now resolves to | Replace with |
|---|---|---|
| `emerald-*`, `bookly-emerald-*`, `teal-*`, `accent-50…950`, `accent-alt` | green scale (600 = `#0F6B4F`) | `primary`, `primary-hover`, `primary-soft`, `success` |
| `slate-*` | warm neutrals: 50 cream … 200 border … 400 `#6B7280` … 500 muted … 900 charcoal | `bg`, `surface`, `surface-2`, `border`, `muted`, `text` |
| `ink-*` (theme-flipping) | 50 = text, 300 = muted, 700 = border, 900 = surface, 950 = page, 1000 = input | `text`, `muted`, `border`, `surface`, `bg` |
| `forest-*` (`brand`, `cream`, `glow`, `ink`, `night`, `card`, `frame`, `paper`, `muted`, `device`) | green, cream, gold, charcoal … | the semantic token |
| `mint`, `lime`, `bookly-amber`, `bookly-rose` | green-100, gold, gold, error | `primary-soft`, `accent`, `warning`, `error` |
| `on-accent` | white | `text-primary-fg` |
| `text-display-*`, `text-h1/h2/h3`, `text-body-lg/-sm`, `text-caption` | brand sizes | `text-hero`, `text-page-title`, `text-section-heading`, `text-body`, `text-small` |
| `shadow-glow*`, `shadow-bookly-*` | warm shadows | `shadow-soft`, `shadow-card`, `shadow-lift` |
| `.glass`, `.glass-card`, `.gradient-*`, `.text-gradient*`, `.bg-orb*`, `.bookly-glow*`, `.status-dot` | flat brand equivalents (orbs hidden) | `Card` / `bg-surface` |
| CSS vars `--forest-*`, `--mint`, `--lime`, `--amber`, `--rose`, `--accent-*-rgb`, `--ink-*-rgb` | brand values | `rgb(var(--c-<token>-rgb))` |
| `marketing.css` `fs-*` / `.theme-site` | brand colours | Tailwind + components (delete the file once marketing is rebuilt) |
| `BooklyWordmark`, `BooklyIcon` | `BrandLogo` | `BrandLogo` |
| `white` (was remapped to off-white) | real `#FFFFFF` again | `bg-surface` |

Stock Tailwind palettes such as `amber-*`, `red-*`, `blue-*` and `green-*` are **not** aliased. Replace them with
`warning`, `error` or `success` when you touch a page.

## Migrating a page: checklist

Work through the checklist from top to bottom for each page you own.

1. **Restyle only.** Do not change data fetching, API calls, auth, routing semantics, validation rules or existing
   aria attributes. Copy changes are welcome (see step 9).
2. **Header:** use `<PageHeader title subtitle actions>`, which gives you one `h1` in Clash. Use `<SectionHeading>` for
   sub-sections. Remove hand-rolled title markup.
3. **Replace legacy classes** using the alias table above. When you finish, the page should contain no `emerald-`,
   `slate-`, `ink-`, `forest-`, `bookly-`, `accent-<number>`, `teal-`, hex colours (`[#…]`) or `dark:` overrides that
   duplicate a semantic token. Semantic tokens flip in dark mode on their own. Run
   `grep -nE "(emerald|slate|ink|forest|bookly|teal)-|accent-[0-9]|\[#" <file>` to check.
4. **Use the components:** `Button`, `Card`, the inputs, `StatusPill`, `Modal`/`Drawer`, `ConfirmDialog`, `Tabs`,
   `SearchInput` + `FilterChips`, `ResponsiveTable`. Delete local look-alikes.
5. **Every data view has three states.** Loading uses a skeleton that matches the layout. Empty uses `EmptyState` with a
   helpful line and one button, for example "No bookings yet. Share your WhatsApp link to get your first one!". Error
   uses `ErrorState` with retry. Spinners only appear inside buttons (`isLoading`).
6. **Mobile first** at 360, 768, 1024 and 1440. There must be no horizontal scroll: tables become cards via
   `ResponsiveTable`, and long rows wrap. Tap targets are at least 44px. Primary actions are reachable by thumb.
7. **Money** always goes through `formatCedi` / `MoneyInput`. **Phones** always go through `PhoneInput` /
   `formatGhanaPhone`.
8. **Status** uses `StatusPill` (icon + word). **Destructive actions** use `ConfirmDialog`. **Quick feedback** uses
   `notify.*`. Use `TickPop` on the big success moments.
9. **Copy voice:** friendly, short, plain ("Your bookings", not "Appointment Management"). Use sentence case and no
   jargon. Errors say what happened and what to do next.
10. **Gold** appears at most once per screen. Never use it for text.
11. **Motion:** in app pages, stagger lists with `Stagger` if it helps. In public/SSR pages, never set an initial
    opacity of 0. Check that the page still works with reduced motion turned on.
12. **Accessibility:** inputs have labels, icon-only buttons have `aria-label`, focus is visible (gold), and the page
    is fully usable with the keyboard.
13. **Verify:** run `npx tsc --noEmit -p apps/web`, then `npx next build` **in your worktree only** (never in the live
    `/root/home/Automation/apps/web`). Take screenshots at 360 and 1440, in light mode and with `.dark`.
