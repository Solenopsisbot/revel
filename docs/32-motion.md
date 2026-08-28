# Motion

"Lots of subtle animation everywhere" is the brief. The risk with that brief is
an app that feels busy rather than alive, so this is the vocabulary — what
moves, how far, how fast, and the things that must never move.

## The rule everything follows

> **Motion explains what happened. It never decorates, and it never claims
> something is finished when it isn't.**

That second clause matters more here than in most products. A message that
slides confidently into place before the server has accepted it is lying, and
in an app whose entire pitch is that it tells you the truth about what's
happening to your data, a lying animation is a real cost. Optimistic states
look *provisional* until they aren't.

## The scale

From `design/tokens.css`. Nothing invents its own duration.

| Token | Duration | For |
| --- | --- | --- |
| `--t-fast` | 120 ms | hover, focus, press, toggles, anything under the cursor |
| `--t-base` | 200 ms | most state changes: panels, menus, list insertions |
| `--t-slow` | 320 ms | full-view transitions, drawers, modal entry |

| Easing | Curve | For |
| --- | --- | --- |
| `--ease` | `cubic-bezier(.22,.61,.36,1)` | almost everything — decelerating, no overshoot |
| `--ease-toy` | `cubic-bezier(.34,1.56,.64,1)` | the raised button, and only it. Overshoot reads as physical |

**Nothing exceeds 320 ms.** A chat app is a tool people use for hours; anything
slower stops being polish and starts being latency you added on purpose.

## What moves

**Arrival.** A new message fades in over `--t-base` and rises 4px. Four pixels,
not twenty — the eye needs to know something appeared, not watch it travel. The
list does **not** reflow around it: the message list is bottom-anchored, so
inserting at the bottom shifts nothing above.

**Optimistic send.** Your own message appears instantly at 60% opacity with no
motion at all — it is already where it will be. When the server confirms, it
fades to full over `--t-fast`. If it fails, it goes coral and stays put. The
message never moves, because moving it would imply it went somewhere.

**Room switching.** The room content cross-fades over `--t-fast` while the
sidebar selection moves under `--t-base`. Deliberately asymmetric: the selection
is the thing you did, so it gets the visible motion; the content is a
consequence, so it just resolves. A slide here would fight the local-first
promise that switching is instant.

**Drawers, on touch.** Finger-tracked 1:1 with no easing at all while dragging —
easing during a drag feels like lag. The snap on release uses `--t-slow`.

**The raised button.** Down 3px on press over `--t-fast` with `--ease-toy`. The
only overshoot in the product.

**Typing dots.** A 1.3 s loop, three dots, staggered 180 ms. The one genuinely
ambient animation, and it earns it by encoding real information.

**Reactions.** The chip scales 1 → 1.15 → 1 over `--t-fast` when the count
changes. Enough to catch the eye in peripheral vision.

**Unread.** The dot fades in. It does **not** pulse — a pulsing dot in the
corner of your eye for eight hours is an accessibility problem, not polish.

**Wren's notices.** Slide in 8px from the right over `--t-base`, staggered 40 ms
when several arrive. Her panel is the one place a small flourish is welcome,
because it is opened deliberately rather than lived in.

**Face switching.** The composer chip cross-fades its colour and avatar over
`--t-base`. The colour change *is* the feedback — you are about to speak as
someone else, and that should register somewhere other than the text.

## What must not move

- **The message list, on scroll.** No parallax, no fade-at-edges, no reveal
  animations tied to scroll position. It is a document you read.
- **Anything behind the composer** while you type.
- **Tiles in a call** when someone speaks. The ring lights; the grid holds
  still. A grid that reshuffles on every utterance is unusable at four people.
- **Unread counts and badges.** They update instantly. A number that animates
  is a number you can't read.
- **Anything on a crypto state change.** "This device can't read messages here
  yet" appears; it does not slide in charmingly. Softening a security state with
  motion is exactly the wrong instinct.

## Performance

- Compositor-only properties: `transform` and `opacity`. Never `height`,
  `top`, `width` or `margin` in an animation.
- The message list is virtualised, so entry animations run **only on genuinely
  new events**, never on items scrolling into view. Animating recycled rows is
  the classic virtual-list bug and it looks like flickering.
- Every animation is interruptible. Switching rooms twice quickly must not queue
  two transitions.
- Budget: 60 fps on a mid-range phone (`docs/29` §5). Motion that misses it is
  removed, not tuned.

## Reduced motion

`prefers-reduced-motion` and the in-app reduce-motion pref both kill every
transition and animation in one place (`design/tokens.css`). Not "shorten them" —
kill them. State still changes; it changes instantly.

This is not a degraded mode. Everything above is designed so the app is fully
usable with all of it switched off — motion carries emphasis, never information.
If a state is only legible because of how it animated, that's a bug in the
static design.
