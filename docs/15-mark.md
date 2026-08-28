# The mark

Seven concepts for the Revel mark, then a verdict.

---

## The existing placeholder

Three circles of equal radius, arranged in an inverted triangle (two side by
side at top, one centered below). Each circle carries a thick stroke in the
background colour, which creates visible separation where they overlap —
you can always see three distinct shapes, even at the crossing. In flat colour,
all three circles share that colour. In the face-palette variant: aqua, gold,
rose.

The placeholder encodes the **no-ghost-readers** thesis: a few people in a
place, everyone visible. It was drawn before the name existed. The question is
whether "Revel" makes it stronger, weaker, or irrelevant.

**Honest assessment.** The name helps. "Three overlapping circles" is a Venn
diagram; "three people at a revel" is a scene. The name supplies the warmth
that the geometry doesn't carry on its own. But the mark itself is static,
symmetrical, and diagrammatic — it encodes *presence* (everyone visible) more
than *pleasure* (everyone enjoying). A revel has energy. The three discs are
standing still.

---

## Concept 1: The Tilted Triad

### What it is

The same three-disc arrangement as the placeholder, rotated **18 degrees
clockwise** as a unit. Nothing else changes — same radii, same overlap, same
background-stroke separation. The rotation lifts one circle to the upper left,
drops another to the lower right, and shifts the third off the vertical axis.

### Geometry (100-unit square)

Rotate the existing centers (32,36), (68,36), (50,68) by 18 degrees around
the centroid (50, 46.7). Radius 21, stroke-width 7 in background colour. The
centroid doesn't move; the silhouette shifts from "resting on a base" to
"caught mid-turn."

### Rationale

A triangle standing on its base is a diagram. The same triangle tilted is a
thing that was moving when you looked at it. The tilt is the entire difference
between "people standing in a room" and "people mid-revel" — it turns the
placeholder from a fact into a moment. The construction is identical, so
everything that works about the existing mark still works.

### 16px behaviour

Identical to the placeholder — three dots in a tilted triangle. The tilt is
visible down to about 12px, where the dots merge into a cluster anyway.
Degrades cleanly.

### Multi-colour

Three face colours, same assignment as the current variant. The tilt makes
the colour arrangement feel less schematic and more like three distinct people
who happened to end up near each other, which is what a revel is.

### How it fails

It's the most conservative possible move — the same mark, rotated. Someone
who saw both versions a week apart might not register the difference. If the
existing mark doesn't say "revel," this doesn't either; it says it slightly
louder, in italics. Also: the tilted orientation has no single "right"
rotation. 18 degrees is a judgment call; 12 or 25 would read differently,
and the choice is essentially arbitrary. Every time the mark appears it'll
need to appear at the same rotation, which means either baking the tilt into
the symbol definition or enforcing it downstream. Neither is hard, but it's
a thing to get wrong.

---

## Concept 2: The Lean

### What it is

Three circles arranged in a **shallow upward arc** (a crescent curving
concave-up), overlapping in sequence: left overlaps center, center overlaps
right. Each pair shares about 30% of its diameter. Background-stroke
separation on each, same as the placeholder. The arc gives the cluster a
gentle curve — like three people leaning in toward a conversation, or three
heads tilting together to hear a secret.

### Geometry (100-unit square)

Three circles of radius 20. Centers placed on an arc of a circle with radius
~90 (much larger than the mark), so the curvature is subtle — roughly:

- Left: cx=22, cy=56
- Center: cx=50, cy=46
- Right: cx=78, cy=56

This puts the center circle ~10 units higher than the outer two. Stroke-width
7 in background colour. The overall silhouette is wider than tall — a landscape
shape, unlike the placeholder's roughly equilateral triangle.

### Rationale

Leaning in is the physical gesture of engagement. You lean toward the person
you want to hear, the story you're drawn to. A revel pulls you in. The arc
also gives the mark a faint "smile" quality — the three-dot curve bends
upward, which reads as warmth without being a literal smiley face. The
sequential overlap (left-over-center-over-right) creates a reading direction,
left to right, which sits naturally beside the wordmark.

### 16px behaviour

Three dots in a gentle arc. Readable, compact, wide-format. The curvature
may flatten at very small sizes, making it look like three dots in a row — but
even three dots in a row, overlapping, is a recognizable mark. The wider
aspect ratio is actually an advantage at 16px: it fills a wider footprint
than the triangular arrangement, which helps in tab bars and favicons.

### Multi-colour

Left to right: three face colours. The sequential arrangement lets you
"read" the colours like a sentence, and the overlap zones show each colour
bleeding into the next — connection made visible. Suggested: coral, gold,
violet (warm-to-cool across the arc).

### How it fails

Three circles in a row is an **ellipsis** (...), a pagination indicator, a
loading state, a "more" menu. Those associations are strong, and the slight
arc may not be enough to override them. The mark also has a preferred
orientation — it only "leans" when it's horizontal. Rotated 90 degrees (as
it might be in a vertical wordmark stack), the lean disappears and you get
three circles in a column, which is just a list. The placeholder's triangle
is rotationally robust in a way the arc is not. Finally: three-in-a-row
implies sequence and order, which is subtly wrong for a revel. A revel is a
cluster, not a queue.

---

## Concept 3: The Bright Center

### What it is

The three-disc triangle from the placeholder, same positions, same overlaps
— but the **triple-intersection zone** (the small region where all three
circles cross) is visually distinguished. In flat colour: the three circles
are filled in the mark colour, and the triple-overlap zone is cut out to the
background (a small void at the heart of the cluster). In multi-colour: the
three circles are in their face colours, and the triple-overlap is filled
with a contrasting colour — the brand violet, or white — making it the
brightest point in the mark.

### Geometry (100-unit square)

Identical to the placeholder: centers at (32,36), (68,36), (50,68), radius
21. No background-stroke ring; instead, the fill rules change. Each circle
is filled. The triple-overlap region (a small curved triangle at approximately
the centroid) is either:
- **Flat variant:** knocked out (even-odd fill rule makes this trivial in SVG)
- **Colour variant:** painted in a fourth colour, overdrawn on top of the
  three circles

The double-overlap zones (where only two circles cross) remain filled in
whichever colour's circle is drawn last, per normal paint order. The
background-stroke separation from the placeholder is removed — the circles
genuinely overlap and merge, except at the center, where the void or
highlight creates the focal point.

### Rationale

The existing mark says "three people." This one says "three people and the
thing they made together." The revel is not the individuals — it's the shared
space that only exists because all three showed up. The void or highlight at
center IS the revel: the conversation, the joy, the thing you can't point to
but can feel when you're in it.

### 16px behaviour

Same silhouette as the placeholder. At 16px the triple-overlap void may be
too small to perceive (it's about 3-4px across in a 16px render). The mark
degrades to three overlapping circles, which is still a readable cluster.
The center highlight only becomes visible at ~24px and above, which means
the mark has a "reveal" as it scales up — at favicon size it's the
three-disc cluster; at display size, the heart appears. This is either a
nice detail or a liability, depending on how you feel about marks that
change character with size.

### Multi-colour

Three circles in three face colours (aqua, gold, rose, as in the current
variant). The center — where all three cross — in brand violet or in white.
This is the most visually complex variant and the one where the "bright
center" concept pays off: the overlapping region becomes a jewel, the place
where three colours meet and become something else.

### How it fails

The central void (in the flat variant) may read as a **defect** — a hole in
the mark that looks like a rendering bug or a missing fill. People are
trained to see voids in shapes as errors, not features. The highlighted
center (in the colour variant) is better, but introduces a fourth element
into a mark that's already at its complexity budget for 16px. The concept
also requires more careful SVG construction than the placeholder: even-odd
fill rules, layered paths, or a clipping mask for the void. And
fundamentally: the "center as revel" metaphor is legible only if someone
explains it. Nobody looks at a mark and thinks "ah, the triple-intersection
region represents the emergent property of collective joy." They see three
circles with a dot in the middle.

---

## Concept 4: The Spark

### What it is

A radial burst: **six short lines** radiating from a common center, evenly
spaced at 60-degree intervals. Each line starts a short distance from the
center (leaving a void in the middle) and extends outward. Round endcaps,
generous stroke width. No central dot. The overall shape is a small, warm
starburst — the flash of a sparkler, not the blast of an explosion.

### Geometry (100-unit square)

Six line segments, each from radius 14 to radius 42 from center (50,50).
Angles at 0, 60, 120, 180, 240, 300 degrees. Stroke-width 10, round
linecaps. The inner void (radius 14) is roughly 28% of the outer extent,
keeping the center open and airy. The overall silhouette fits in a circle of
radius 42, leaving generous margin in the 100-unit square.

### Rationale

A revel is a burst of shared energy. The spark is the moment it catches — the
laugh that makes the whole table turn, the song that pulls everyone to their
feet. Six rays in all directions is the shape of connection radiating outward:
not aimed, not directed, just alive. It's also formally distinctive — no major
chat app uses a radial burst, while circles-in-a-triangle has near-collisions
with molecular diagrams, group icons, and Venn illustrations everywhere.

### 16px behaviour

A tiny starburst, roughly 6 strokes at 1-2px each. Readable and distinctive
— the radial symmetry holds at small sizes because the brain fills in the
pattern from even partial information. The six rays might reduce to a
perceived four at the very smallest sizes (where adjacent rays merge), but
the burst shape survives. The mark's silhouette is **circular** at every
size, which makes it a natural fit for circular favicon masks and rounded app
tiles.

### Multi-colour

Each ray in a different face colour. Six rays, eight palette colours — pick
any six, or repeat two. On a dark ground, six candy-colour rays radiating
from a dark center is genuinely beautiful and completely unlike any existing
chat-app icon. The colour variant IS the mark at its best; the flat variant
is the functional fallback.

### How it fails

It reads as **many other things**: an asterisk (footnote, required field), a
snowflake, a settings gear (in simplified versions), a loading spinner, a
"new!" badge, a compass rose, a decorative dingbat. The shape carries no
inherent people-content — nothing about it says "gathering" or "chat" or
"social" without the name next to it. The placeholder's three discs are
immediately parseable as "a group of people" by anyone who's seen a contact
icon; the spark requires the viewer to bring the metaphor themselves.

The mark would also be the only element in the design system built from lines
rather than filled shapes. The raised button, the candy palette, the face
dots, the avatar rings — everything else in the visual language is **round
and filled**. A stroke-only radial mark would be formally orphaned from its
own product.

---

## Concept 5: The Open Ring

### What it is

A single thick arc — roughly 280 degrees of a circle, leaving an 80-degree
gap — with **three small filled circles** clustered near the gap, partly
inside and partly outside the arc's implied boundary. The arc is the revel
(the gathering, the event, the warm enclosure); the gap is the invitation
(open, not sealed); the three dots are the people, arriving or about to
arrive.

### Geometry (100-unit square)

The arc: center at (50,50), radius 34, stroke-width 10, round linecaps.
Spans from about 50 degrees to 330 degrees (gap opens toward the upper
right). Three filled circles of radius 7, clustered near the gap:
- (76, 30) — just outside the arc
- (82, 44) — in the gap
- (70, 22) — just outside the arc, slightly further out

The exact positions should feel loose, not gridded — three friends arriving
at a party, not three data points on a chart.

### Rationale

A revel is an open invitation. You don't fence a celebration; people come
and go, the thing breathes. The open ring says "this space is warm and
you're welcome in it" without saying it in words. The three dots near the
gap are the moment just before joining — the best moment, the one where
you can hear the music from outside and you know it's going to be good.

### 16px behaviour

A C-shaped arc with one or two visible dots near the gap. The arc is the
dominant shape and reads cleanly at any size — it's a single stroke, high
contrast, unmistakable. The dots may merge to one or two at very small sizes.
The overall silhouette is **circular with a notch**, which is distinctive
among chat-app icons (most are solid shapes or closed outlines).

### Multi-colour

The arc in the brand violet or text colour. The three dots in three face
colours. This creates a clear hierarchy: the place (arc) is one thing, the
people (dots) are another, and the people are the colourful part. Matches
the product's philosophy — the infrastructure is neutral; the people bring
the colour.

### How it fails

A broken circle with dots is a **loading indicator**, a **progress ring**,
or a **circular menu** (the radial-menu pattern from Android, Creative
Suite, etc.). Those associations are immediate and strong. At small sizes
where the dots merge, it's just a C-shape, which reads as a partially-loaded
spinner or a Pac-Man. The asymmetric dot placement also means the mark has
a **preferred orientation** that's harder to control than a symmetric mark —
flip it and the dots are in the wrong place; rotate it and the gap points
the wrong way.

The concept is also two ideas bolted together — "ring" and "dots" — rather
than one idea. The best marks are a single formal move. This is a shape with
accessories.

---

## Concept 6: The Pinwheel

### What it is

Three arcs of equal length, each roughly 100 degrees, arranged in
**threefold rotational symmetry** around a center. Each arc curves inward
toward the center, like three arms of a slow spiral. The overall shape
suggests rotation, flow, a dance — three people whirling around each other,
or three conversations swirling into one.

### Geometry (100-unit square)

Three arcs, each traced on a circle of radius 28 centered at the three
offset points:

- Arc 1: center at (50, 28), drawn from ~210 degrees to ~310 degrees
- Arc 2: center at (31, 63), drawn from ~330 degrees to ~70 degrees
- Arc 3: center at (69, 63), drawn from ~90 degrees to ~190 degrees

Stroke-width 10, round linecaps, no fill. The three arcs don't touch — there's
a gap between each pair, and the gaps form a small triangle of negative space
at center. The overall silhouette is roughly circular, about 70 units in
diameter.

(The exact angles are tuned so each arc's endpoints are about 8-10 units from
the adjacent arc's endpoint, creating visible but not dominant gaps.)

### Rationale

A revel swirls. Three arcs in rotation capture the energy of people in
motion — dancing, talking over each other, passing a drink, turning to
include someone new. The rotational symmetry gives it formal elegance; the
gaps between arcs prevent it from reading as a closed circle or a yin-yang.
It's a gathering caught mid-turn.

### 16px behaviour

Three curved strokes forming a loose whorl. At 16px the individual arcs are
each about 3-4px of drawn line, which is at the limit of legibility. The
threefold symmetry helps — the brain recognises rotational patterns from very
little information. Below 16px (12px, 10px) the arcs merge into a fuzzy
circle, which is a graceful degradation (a circle is a fine fallback). The
mark does NOT degrade to three dots — it degrades to a continuous ring, which
is a different thing than the placeholder degrades to.

### Multi-colour

Each arc in a different face colour. Three arcs, three colours: aqua, gold,
rose (or any three from the palette). The rotation makes the colours chase
each other around the center, which is dynamic and playful. On a dark ground,
three bright arcs swirling together is visually arresting.

### How it fails

The **triskelion** — the three-legged symbol of the Isle of Man, Sicily, and
various neo-pagan movements. The form is ancient, heavily coded, and not
something a chat app should accidentally invoke. The distinction (these are
arcs, not legs; there's no central hub) may not be enough to prevent the
association. Separately: the **recycling symbol** is three arrows in
threefold rotation, and a simplified version of this mark could read as
"recyclable," which is a bewildering message for a chat app to send.

The mark is also **stroke-only**, which shares the formal-orphan problem
noted for the Spark — the product's visual language is built on filled shapes,
not drawn lines. And at the smallest sizes, the three-arc structure collapses
into a circle, which means the mark loses its identity right where it needs
it most (the favicon).

---

## Concept 7: The Rising Three

### What it is

Three filled circles arranged in a **diagonal cascade**, ascending from
lower-left to upper-right. Each circle is the same size. Each overlaps the
next by about 25-30% of its diameter, with the upper-right circle drawn on
top (in front). Background-stroke separation, same technique as the
placeholder, keeps each disc distinct at the crossings.

### Geometry (100-unit square)

Three circles of radius 19. Centers along a line from lower-left to
upper-right, at roughly 35 degrees from horizontal:

- Lower-left: cx=26, cy=68
- Center: cx=50, cy=50
- Upper-right: cx=74, cy=32

Stroke-width 7 in background colour. The frontmost (upper-right) circle is
drawn last, so it overlaps the center; the center overlaps the lower-left.
This creates a clear stacking order: the three are moving upward and to the
right, each one stepping forward.

### Rationale

Rising. That's the word. A revel lifts you — the energy rises, the voices
rise, you get up from your chair because sitting feels wrong when the room
is this alive. Three ascending circles are three people on the way up: not
arriving at a destination, not standing in formation, but in the act of
rising together. The diagonal also gives the mark a forward lean, which
sits well beside the wordmark — the mark moves toward the word, as if
introducing it.

### 16px behaviour

Three dots in a diagonal. Highly readable — the diagonal arrangement is
compact and distinctive, and the stacking order (which circle is "in front")
is legible even at small sizes because the overlap tells the eye which came
last. The overall shape is roughly square (the diagonal fills a square
footprint), which makes it a natural fit for square icon masks. This may
actually be the best-behaved concept at 16px: it's three dots, clearly
three, in a direction.

### Multi-colour

Three face colours, from lower-left (behind) to upper-right (in front).
Suggested: rose, gold, sky — warm to cool, grounding to bright, back to
front. The stacking order gives the colours a sense of depth, like cards
fanned in hand.

### How it fails

Three circles ascending diagonally is a **growth chart**, a **bar graph
going up**, a **status indicator** (good/better/best), a **signal strength
icon**. The association with metrics and progress is strong — strong enough
that the mark might read as "we're growing!" or "things are improving!"
rather than "people are celebrating." It's the shape of corporate optimism,
which is precisely the register this product wants to avoid.

The diagonal also has a preferred direction: it rises to the right. Flip
it horizontally and it's falling. Rotate it and it's... something else.
Unlike the triangular arrangement, which is roughly the same from any
angle, the diagonal is directional and fragile. In right-to-left language
contexts, the "rising" direction reverses, and the mark reads as descending.

---

## Top three

### 1. The Tilted Triad

The strongest option and the least exciting one, which is exactly the
combination that makes a good mark. Everything that works about the existing
three-disc placeholder still works — the people-in-a-place reading, the
background-stroke separation, the face-palette variant, the 16px
degradation. The tilt adds one thing: motion. And motion is the difference
between the placeholder (which encodes the thesis: *everyone visible*) and
the name (which encodes the feeling: *everyone enjoying*). The placeholder
is a diagram of a gathering. The tilted variant is a snapshot of a revel.

The rotation should be 15-20 degrees clockwise. Less than 15 and it reads as
a manufacturing error; more than 25 and it looks deliberately off-balance in
a way that suggests instability rather than energy. 18 degrees is the sweet
spot — enough to be obviously intentional, not enough to make you seasick.

### 2. The Bright Center

The most *conceptually* interesting option, and the one that does the most
work with the word "revel." The existing mark says "here are three people."
This one says "here are three people and the thing they're making between
them." The void or highlight at center is a genuinely elegant move — it
reframes the mark from being *about* the individuals to being about the
*shared space*, which is what a revel is. The word "revel" doesn't name the
people at the party; it names the party itself. This mark does the same.

Ranked second because the execution risk is real. The central void may read
as a bug. The central highlight adds a fourth visual element to a mark
that's already at its complexity ceiling. And the metaphor — beautiful as it
is — is invisible to anyone who doesn't have it explained to them. Marks
work by recognition, not by essay.

### 3. The Lean

The warmest option. Three people leaning in to hear each other is genuinely
lovely as a reading, and the upward arc gives the mark a quality the triangle
lacks — it *curves*, and curves are warm in a way that straight-edged
geometry isn't. The sequential overlap (left over center over right) also
creates a reading direction that pairs well with the wordmark.

Ranked third because the failure modes are significant. The ellipsis / three
dots in a row association is strong. The mark is directional in a way that
limits its use (it needs to be horizontal). And three-in-a-row reads as
sequence rather than cluster, which is subtly wrong for "gathering."

---

## Verdict: does anything beat the placeholder?

**The Tilted Triad beats it.** Narrowly, and by doing almost nothing — one
rotation, no new elements, no new construction. But the tilt earns its keep
because it solves the one problem the placeholder has, which is that it's
static. "Revel" is not a static word. Three circles standing in a stable
triangle is a diagram of a group; three circles tilted mid-turn is a moment
at a revel. The delta is small and the improvement is real.

The Bright Center is the better *idea* but the worse mark. It asks more
of the viewer and gives less back at small sizes. Save it as the animated
variant — on hover, on load, the center briefly pulses or appears — and use
the Tilted Triad as the static mark.

Everything else either carries failure modes that outweigh its merits (the
Lean's ellipsis problem, the Spark's no-people problem, the Pinwheel's
triskelion problem, the Rising Three's bar-chart problem, the Open Ring's
loading-spinner problem) or requires the viewer to bring a metaphor the
mark can't carry on its own.

**Recommendation:** adopt the Tilted Triad as the mark. Rotate the existing
placeholder 18 degrees clockwise around its centroid and call it done. It's
the existing mark graduating from placeholder to mark, not a replacement —
which is honest, because the placeholder was good. It just didn't know its
name yet.

---

## Adopted (2026-08-27): the Tilted Triad

Built and shipped into `design/index.html`. The tilt is **baked into the SVG
symbol definition**, not applied at call sites, so every usage inherits it and
nobody can accidentally ship the upright version — which was the one
implementation risk this concept carried.

Exact geometry, 100-unit viewBox, radius 21, stroke-width 7 in the surrounding
ground colour. Original centres rotated 18 degrees clockwise about the centroid
(50, 46.667):

| | upright | tilted |
| --- | --- | --- |
| A | (32, 36) | **(29.58, 42.08)** |
| B | (68, 36) | **(63.82, 30.96)** |
| C | (50, 68) | **(56.59, 66.96)** |

Verified by render at 48 / 32 / 24 / 16 / 12px in the reference page. The tilt is
legible at 16px and dissolves into an undifferentiated cluster around 12px,
which matches the concept's own prediction.

**Deferred:** *The Bright Center* is kept as the animated variant — the centre
appearing or pulsing on load or hover — per the verdict above. Not built; there
is no animation layer yet.
