# Design language

The rules. **`../design/tokens.css` is the machine-readable source of truth** and
`../design/index.html` is the running reference — open that in a browser, it's
the real deliverable.

Visual inspiration came from a friend's design work: warm saturated grounds,
tactile controls, and a playful surface over blunt small print. What follows is
ours. An early pass leaned far too heavily on that inspiration's *identity* —
its mark, wordmark, iconography and button treatment — and was redrawn from
scratch. Inspiration is a register, not a set of assets.

## What the design is

| Decision | |
| --- | --- |
| **Two dark themes**, `dusk` (violet, default) and `midnight` (navy), plus `daylight`. Grounds are always tinted, never neutral grey. | That single choice is most of why this feels warm and why most chat apps feel like an office. |
| **The mark** is three overlapping discs — a few people in a place, everyone visible. The product's thesis, not an ornament. See [`15-mark.md`](15-mark.md). | |
| **The raised button** sits above the surface and presses down, with the lift a darker shade of the button's own hue and no heavy outline. | Tactility is the idea; the costume is ours. |
| **Ambient haze** on moment screens — large, soft, blurred light. No cartoon props. | |
| **A fading hairline rule** marks "you're all caught up". A plain dot marks unread. | |
| **Fraunces** for voice, **Figtree** for reading. Deliberately not a rounded geometric. | |
| **Glow means state**, not decoration, once you're in the app: focus, active call, live mic. | |
| **The voice**: playful surface, blunt limits, in small type directly under the thing it qualifies. See [`08-voice-and-copy.md`](08-voice-and-copy.md). | |

## The central rule: moments vs workspace

The references are **landing pages** — looked at once, for thirty seconds. A chat
app is a surface you read ten thousand words a day on. Full maximalism in a
message list would be unusable; sanding it all off wastes what's good. So:

**Moments** — landing, sign-up, the three cliff screens, empty states, errors,
invites, the about/threat-model pages. **Full personality.** Gradient ground,
ambient haze, character art, display type at 48px+, the raised buttons, generous
whitespace. Rare screens you remember.

**Workspace** — room list, message list, member list, composer, settings.
**Shape and colour only.** No floating decoration, no gradient grounds, no
ambient glow. Personality survives as rounded geometry, violet-tinted surfaces,
candy face colours, and the raised button on primary actions. Type drops to a
readable 15px.

Exposed as a user pref, `--personality: full | calm`, beside density in the
customisation seam (`05-client-and-ux.md` §7). `calm` zeroes the button lift and
the glow. Default `full`.

## Colour

Grounds are **tinted, never neutral grey** — that single decision is most of why
the reference feels warm and why Discord feels like an office.

Five surface steps per theme (`--ground-0` … `--ground-4`) plus `--line`; text is
`--text` / `--text-dim` / `--text-mute`. Three themes: **dusk** (violet, default),
**midnight** (navy), **daylight** (light).

**The candy set** — eight accents: `gold`, `rose`, `violet`, `sky`, `mint`,
`coral`, `lilac`, `aqua`. Not decoration-only: they're the **face palette**.
Every headmate and member picks one and it drives their name colour, avatar ring
and bubble tint.

**Fill vs ink — measured, not guessed.** The bright candy values are tuned for
dark grounds. As *text* on the light theme, six of the eight fall under 3:1 —
which would make every member's name unreadable on daylight. So each has an
`--face-*` ink twin: identical on the dark themes, darkened same-hue on daylight,
every one ≥4.5:1.

> **The rule:** `--gold` paints a star. `--face-gold` writes a name.

The reference page measures this live and prints the ratio under every swatch.
That checker is what caught the failure; keep it working.

## Type

Two families, not three.

| Role | Face | Used for |
| --- | --- | --- |
| UI | **Figtree** | everything in the workspace, and button labels. Legible at 15px for hours. |
| Display | **Fraunces** (soft axis) | section headings and moment screens. Characterful and warm without being the reference's rounded-geometric look. |
| Mono | **JetBrains Mono** | code, recovery codes, safety numbers, fingerprints. |

Self-hosted, subset, `font-display: swap`, with a system fallback chain — no
remote font CDN (CSP, and asking Google for a font on every load would be an
embarrassing thing for a privacy app to do).

## Shape, elevation, motion

- **Radii:** `pill` 999px, `lg` 20px, `md` 14px, `sm` 10px, `xs` 6px.
- **The lift:** `0 var(--lift) 0 <darker shade of the button's own hue>` plus a
  soft ambient shadow and an inner top highlight. `:active` translates down by
  the lift and the offset collapses to zero. Primary actions only.
- **Glow** is state, not decoration, once you're in the app: focus rings, active
  call, live mic.
- **Motion:** 120 / 200 / 320ms. `ease-out`, except the button, which gets a
  slight overshoot. All of it dies under `prefers-reduced-motion` or the pref.

## Two message styles

The reference shows **bubbles**; a busy room wants **grouped rows**. Both are
built; default follows the room kind, user-overridable per room.

- **Bubbles** for DMs and group DMs — avatar, name, timestamp, bubble tinted in
  the sender's face colour.
- **Rows** for space rooms — consecutive messages from one face grouped under a
  single header, hover-reveals actions. Reads fast at volume.

Both share `Avatar`, `AuthorLine`, `RichText`, `Reactions`, `Annotations`.

## Icons, and the no-emoji rule

**No emoji anywhere in the product's own surfaces.** Not in buttons, not in
empty states, not in headings, not in system messages, not in settings labels,
not in notifications, not in the docs. Zero.

The only emoji that ever appear are the ones **a person chose**:

- inside the emoji picker, which is a grid of them by definition;
- in a reaction someone added;
- in the text of a message someone wrote.

That's the line: emoji are *user content*, never *product chrome*. A product
that decorates its own UI with emoji is doing tone with someone else's typeface,
and it ages badly. Kith reached the same conclusion late and had to strip them
out (`f763b06`, "ban emojis in product surfaces"); here it's a rule from the
first commit.

So every glyph in the interface is a **drawn icon**: a 24×24 stroke SVG,
`currentColor`, 2px stroke, round caps and joins, no fills. They live in one
sprite and are referenced by `<use>`, so a colour or weight change is one edit.
The starter set is in the reference page — attach, emoji picker, send, reply,
more, plus, close, check, chevron, voice, globe (translation), search, people.

Custom emotes are images a community uploaded, so they're user content too and
render as images, not text.

## The mascot

She's a design element with a real architectural role, so she has her own doc:
[`09-mascot.md`](09-mascot.md). The short version — she is **the client,
personified**, living on your device inside the encryption boundary. She is
deliberately *not* a bot in your rooms, because a mascot who could read your
chats would be exactly the ghost reader we promise doesn't exist.

Her art slot is the dashed box on the moment screen in the reference page.

## Still needs a person, not a plan

**Character art.** The references work substantially *because* of the characters
in them. I can't draw, and a generated placeholder would set the wrong bar. Either
Viola draws her, we commission her, or moment screens ship as light-and-type only
— which looks fine but is a good chunk of the charm. The brief for an artist is in
`09-mascot.md`.

## Not doing

- Padlock iconography, shield badges, "secure" green ticks. This is a chat app
  built honestly, not a "privacy app".
- Glassmorphism in the workspace. Blur is expensive and hurts text.
- A component library (DaisyUI, shadcn). We have a specific look; `packages/ui`
  is ours.
- Anything that reproduces the inspiration's identity. Same warmth, different
  person.
