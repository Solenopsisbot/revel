# 30 -- Design Review: Revel Reference Page

Written after spending an hour with every section, across all three themes, at actual scroll speed. This is the honest version.

---

## First impression, unfiltered

The page is thorough. It reads as a design system spec document, which is exactly what it is -- a sticky toolbar at the top, then a long walk through mark, colour, type, buttons, messages, workspace, Wren, calls, crypto, agents, mobile, and finally a single moment screen at the very bottom. The dusk theme is warm. The violet-tinted grounds work. It does not look like Discord. It has its own thing going on and that thing is coherent.

But the honest first impression is this: it looks like a design system exhibit, not a place I'd want to be.

The workspace mockup -- the thing you'd actually live in for hours -- is competent rather than compelling. It does the right things. Tinted grounds, candy face colors, rounded geometry. All present, all correct. But it doesn't have the *pull* that the the reference work references have. The the reference work pages make you want to click the button. The Revel workspace makes you think "yes, this is well-constructed." Those are not the same response, and the second one is a problem.

The moment screen with Wren at the very bottom is the closest thing to pull on this entire page. But it sits after 12,000 pixels of specification. There's no hero, no landing page. You can't feel what the product *is* from this page; you can only evaluate its parts. And I designed those parts, so trust me when I say: evaluating parts is not the experience I was going for.

---

## What's working

**The face-color system is genuinely excellent.** Names in candy colors, the face chip in the composer, the "SAME SYSTEM" badge for plural faces, the profile card showing other faces on the same account -- this is where the design system earns its keep. It's the strongest single design idea on the page. It solves a real problem (plural identity, alt accounts, shared devices) with a visual vocabulary that's immediately legible and doesn't require explanation. Most apps treat multiple identities as an edge case. This treats them as first-class, and the design is better for it.

**The contrast-ratio checker on daylight is real accessibility work.** The fill/ink split actually measuring 4.5+ on every swatch, catching the problem live (six of eight candy colors fail 3:1 as text on light backgrounds), and the solution being built in and measured right there on the page. Most design systems wave at accessibility. This one did the math. That matters.

**The Wren notification architecture (rungs 1-4) is the best structural decision on the page.** Inbox model instead of popups. Inline cards rendered into gaps in the flow. Interruption cards reserved for genuine cliff edges. "She has an inbox, not a megaphone" is the inversion that makes this work -- every other app gives the system voice a loudspeaker, and every user learns to tune it out. Wren whispers, which means when she raises her voice, you listen.

**The "what can the server see" command palette is the single best element.** A question people genuinely have about an encrypted app, answered from the room's real configuration, surfaced in the UI where you'd actually ask it. That's not a feature. That's the feature that makes people choose this app over the one that just says "encrypted" and expects you to trust it.

**The error banners are excellent.** "This device can't read messages here yet" with a "Sync now" button. Honest, actionable, not scary. Most encryption UX treats key errors as the user's fault or as something terrifying. These treat them as a plumbing problem with a wrench sitting right there.

**The raised buttons with own-hue lift are distinctive.** They feel like objects you press. The lift-to-flat degradation under calm is clean -- the personality scales down without breaking.

**The two message styles work.** Rows for spaces, bubbles for DMs. The rows handle multi-face grouping elegantly: two messages from the same account under different faces, rendered as ordinary messages in sequence, not as a special case with a special badge. That's the face system earning its design again.

**The copy on the moment screen lands.** "We can't reset your password. We can't recover your messages. That's the point, but it does mean this matters." The bright heading draws you in. The small print under it does the real work. That tonal move -- playful surface, blunt fine print -- is exactly what the design language doc asked for, and it's the only place on the page where I can feel the product breathing.

---

## What's wrong

**1. The workspace is too dark.**

ground-0 at #14102a is nearly black. Everything above it -- ground-1 through ground-4 -- occupies a narrow value band of dark violets. The sidebar, room list, and message area all read like a cave with a purple flashlight. You lose the warmth the tinted grounds are supposed to create because there isn't enough value spread for the tint to register as anything other than "slightly purple darkness."

The daylight theme is dramatically better for exactly this reason -- there's value range, so the tint shows up as a real color with real warmth. On dusk, you're reading white text on near-black with a faint violet cast, which, for all the talk of "not neutral grey," ends up feeling similarly heavy as Discord in practice. Just more purple. That's not the same thing as warmer.

**2. There is no landing page.**

The design-language doc says Wren appears on the landing page the way character art does in the reference work." There is no landing page. The page opens with a sticky toolbar and dives into specifications. The moment screen at the bottom proves the design language can produce emotional surfaces. But without a hero, the entire reference page is a toolkit without a showcase, and someone encountering Revel for the first time would see the mechanism, not the feeling. The mechanism is good. But nobody falls in love with a mechanism.

**3. The moment screen doesn't adapt to daylight.**

The dark violet-to-magenta gradient stays constant regardless of theme. When the workspace is light lavender, you scroll down to the recovery code screen and the world goes dark purple. It's jarring enough to feel like an error rather than a transition. Either the moment screen needs a daylight variant -- rose-to-lavender, warm-white-to-cream, something that keeps the weight while respecting the user's chosen brightness -- or the transition needs explicit handling so it reads as intentional.

**4. The phone mockups are too small.**

Three phones at roughly 250px wide each. The text is barely readable. The face switcher sheet is interesting enough to deserve 400px of width. The room list and message view are so tiny they're proving they exist, not demonstrating they work. This is where most people will actually live in the app, and the reference page treats it as a thumbnail gallery.

**5. The call stage is a wireframe.**

Colored rectangles with avatar circles centered in them. No camera preview, no sense of what an active call with real faces looks like. The Transcriber tile showing a key-disagreement warning is a good detail, but the overall thing reads as placeholder art for a feature that hasn't been designed yet. The call is one of the places where "no ghost readers" becomes visceral -- you can see exactly who's listening -- and the current render doesn't sell that at all.

**6. The empty state is cold.**

Centered Fraunces heading, a line of body text, two buttons, dark ground. The design-language doc says empty states are "gentle moments" where Wren "can be warmer" and can appear visually. She's not there. The screen is technically correct and emotionally vacant. An empty room in Revel should feel like a room waiting to be used, not like a 404 with better typography.

**7. DM bubble tinting is too subtle on dusk.**

The sender's face color is supposed to drive the bubble tint, but on the dark theme the tint is barely perceptible. The bubble for Ash -- some kind of aqua or teal -- barely differs from the ground. On daylight the tint shows up clearly, which means the tint values need theme-specific tuning. The face color system works hard everywhere else; it shouldn't go mute in the one context (DMs) where it matters most for distinguishing speakers.

**8. The page buries its best work.**

13,000 pixels of specification before the moment screen. That's the reading order of a reference document, not a persuasion arc. The moment screen should be first or second -- it's the proof that the system can feel like something, and hiding it under twelve sections of tokens, swatches, and button states means anyone evaluating this design has to scroll past everything mechanical before seeing anything that breathes. I did it. It took a while. Not everyone will.

---

## Wren, honestly

The hair, eyes, and costume broadly match the section 5 brief. Mint hair with an ahoge, gold/amber eyes, oversized dark hoodie with mint accent drawstrings and trim. The avatar (wren-avatar-01) works at small sizes -- the mint hair and ahoge are distinctive enough that I'd recognise her at 34px, which is what the avatar needs to do.

But there are problems, and they're not small.

**She reads too young.** The brief says "maybe seventeen, maybe nineteen" -- old enough to be competent, young enough to not be corporate. These renders read 14-15 in the softer expressions, especially alert-02 with the very round face and enormous eyes. The age reads as "needs protecting" rather than "will tell you the truth whether you want to hear it or not." Those are fundamentally different characters, and the art is drawing the wrong one.

**The expressions don't look like the same person.** Alert-01 has much bigger, rounder eyes than portrait-01. The face proportions shift between renders. Serious-01's jawline is different from the full-body's. An artist working from a turnaround sheet would maintain consistent proportions across an expression sheet; these feel like separate generation sessions with similar prompts. That's exactly what they probably are.

**"Slightly sharp in the shoulders and jaw" -- she's not sharp anywhere.** Everything is round and soft. The brief asked for "alert rather than delicate" and got delicate. The difference matters: alert is someone who noticed the thing before you did. Delicate is someone you're worried about upsetting. Wren is supposed to be the first kind.

**The temperament doesn't come through.** "Dry, warm, alert" -- the portraits capture "warm" but not "dry." Dry implies reserve, something pulled-back in the mouth or eyebrows that says "I'm not here to charm you." These renders are charming. They're adorable. The section 6 failure mode -- "She is not cute-as-brand-strategy" -- is exactly what the art is doing. She was supposed to be the person who'd say "I can't get you back in. Not won't -- can't" and mean it. These renders say "headpat me."

**The hoodie is near-black** rather than "muted version of her hair colour or in the app's ground tones." It absorbs light and doesn't integrate with the app's violet-tinted palette. In the moment screen, she's a dark shape on a dark gradient, which reduces her to mint hair floating above a void.

She sits in the moment screen well enough -- the overlap, the bleed off the bottom edge, the compositional integration into the layout. That part is right. She's *in* the page, not floating on top of it.

The big question, stated plainly: this art is almost certainly AI-generated. The flat shading, the variable anatomy between expressions, the inconsistent proportions, the way hoodie details shift between renders -- these are generation artifacts, not artistic choices. The brief explicitly considered this problem: "a generated placeholder would set the wrong bar." If this is placeholder art, it needs to be labelled as such and treated as temporary. If it's meant to be final, it isn't. Wren is the face of a product whose entire value proposition is trust. A face that reads as generated undermines the thing it's supposed to represent.

---

## The mark at real sizes

The Tilted Triad works.

At 48px: three clearly distinct circles in a tilted triangle, each ringed in the ground, immediately readable as "a few people." At 32px: still good, tilt visible. At 24px: three dots with clear arrangement. At 16px: three-dot cluster, tilt still just barely legible. At 12px: an undifferentiated cluster, which is fine -- nothing survives 12px.

The multi-color variant (aqua, gold, rose on the app tile) is the mark at its best. Three candy colors that feel like three people, not three data points. The monochrome variant beside the wordmark is slightly anonymous -- at wordmark scale, you need the color to give it personality. Without the candy hues, it's just a triangle of dots, and triangles of dots are not rare.

Was the Tilted Triad the right call? Yes. The tilt adds exactly the energy the upright version lacked, and it carries to 16px, which is where it matters. The Bright Center (the animated variant, deferred until implementation) is still the right idea for hover/load -- the center circle appearing as the mark comes alive -- but the static mark is correct as built. Nothing else in the concept list would have been as robust at small sizes.

---

## Anything that reads as borrowed

The borrowed identity elements are cleanly removed. The star. The star superscript on the wordmark. The app tile. The flower dingbat. The sawtooth papercraft divider. The layered cartoon clouds. The dark-outline-plus-hard-shadow button. All gone, all replaced with Revel's own vocabulary. That work is done.

Nothing remaining reads as borrowed. The purple gradient on the moment screen shares her hue family, but that's a common palette choice, not a trademark. The character-overlapping-panel-edge composition is a layout technique the design doc explicitly names as something to do ("the way the reference character does") -- it's a pattern, not intellectual property. The "playful surface, blunt small print" tonal structure is learned from her work, but Revel's copy uses its own words, its own rhythm. Learning a tonal structure from a reference is exactly what a vibe reference is for.

The one area to watch: the overall warmth and candy-on-jewel-dark combination. It's deliberately kept, and it's similar enough in feel that someone who knows both projects would see the lineage. But that's the vibe. The doc is clear-eyed about taking the vibe, and the line between "inspired by" and "lifted from" is whether specific elements cross over. None do. The warmth is shared aesthetic territory, not borrowed furniture.

---

## The five changes I'd make first

**1. Lighten the workspace grounds.**

ground-0 on dusk at #14102a is too close to black. Lift it to #1e1a3a or thereabouts -- still violet-tinted, still jewel-dark, but with enough headroom that ground-1 through ground-4 can spread out and the warmth registers as warmth rather than as darkness with a purple tinge. This is the single change that would most improve the daily experience of using the app. The design language doc is right that tinted grounds are what separate this from Discord's office-grey -- but the tint only works if there's enough lightness for it to show. Right now, dusk is so dark that violet and charcoal are functionally identical.

**2. Commission real Wren art.**

If the current renders are AI-generated -- and they read that way -- they need to be replaced by a human artist who can draw the same face consistently across six expressions. The brief in section 5 is already good enough to hand directly to an artist; it's specific about silhouette, hair, eyes, costume, and expression set. What the artist needs to find is the "dry" in her face, which means pulling back from adorable toward alert. She should look like someone who noticed something before you did, not someone who needs to be protected. This is the second priority because Wren is the face of the product, and a face that reads as generated undermines the trust the entire product is built on.

**3. Build a landing page.**

The moment screen at the bottom proves the design language can produce emotional surfaces. Make one that's the first thing someone sees. Wren standing beside a sign-up panel with the "Save this." recovery screen visible behind her, the blunt small print doing its work under the bright buttons, the ambient haze doing its thing. This is where the design goes from toolkit to product. Right now someone looking at this for the first time sees a spec doc. They should see a place they want to be.

**4. Adapt the moment screen gradient for daylight.**

The dark violet-to-magenta gradient dropping into the middle of a light lavender workspace is a context switch that feels like an error. Design a daylight-native moment gradient -- rose-to-cream, lavender-to-warm-white, something that keeps the emotional weight while respecting the user's chosen theme. The moment screen is the single best piece of design on the page; it shouldn't fight with the theme the user already picked.

**5. Enlarge the phone mockups.**

Show one phone at a time at 380-400px wide, with real gesture annotations and transition context: what swiping does, how the face switcher appears, where the thread goes. Three tiny phones in a row at 250px is a proof of existence, not a design review. The mobile experience is where most people will actually live in the app, and it deserves the same care and pixel space as the desktop workspace.

---

***The product this design system describes is genuinely good. The reference page that presents it is a spec document that never once makes you feel what using it would be like -- and that gap between mechanism and feeling is the only thing standing between "well-constructed" and "I want this."***

---

# Response — what was changed (2026-08-27)

Four of the five acted on the same day. The measurements below are recorded
because the headline finding turned out to be *understated*.

## 1. Lighten the workspace grounds — done, and it was worse than described

Measured before changing anything:

| | L* | chroma |
| --- | --- | --- |
| Old `--ground-0` (dusk) | **6.2** | 26 |
| Slack dark | 10.6 | 7 |
| Discord chat background | 21.2 | 7 |
| Reference, deep purple | 16.0 | **66** |
| Reference, mid purple | 20.2 | **79** |

So the ground was **darker than Slack and a third of Discord**, at roughly a
third of the reference's chroma. We had taken a warm, saturated violet and
rendered it as near-black with a hint of tint. The review said the warmth was
invisible; the numbers say it was never really there.

New ramp, both dark themes: **L\* 13 / 17 / 22 / 28 / 35**, chroma 48–80 on
dusk. White on `--ground-0` still measures 16:1.

One casualty, caught by the checker: `violet` face ink fell to **4.39** on the
lifted ground, just under the body-text floor. It now has its own ink value
(`#9f71f1`, 4.66:1) rather than inheriting its fill — the same fill/ink split the
light theme already used.

## 2. Commission real Wren art — not actionable here

Correct, and it needs a person. The `09` §5 brief plus these renders are the
reference to hand an artist. Noted alongside the transparent-background gap in
`20-wren-art.md`.

## 3. Build a landing page — done

A hero now opens the reference page: gradient ground, ambient haze, the mark and
wordmark, one Fraunces line (*"Somewhere to actually talk."*), the raised
buttons, Wren at the right, and the blunt fine print doing the real work
underneath. The page now opens with what the product *feels* like before it
starts explaining itself.

## 4. Daylight-native moment gradient — done

The dark violet slab dropped into a light lavender page was a context switch that
read as an error. Daylight now has its own moment gradient — rose through
lavender into warm white — keeping the emotional weight without fighting the
user's chosen theme.

## 5. Enlarge the phone mockups — done

348px → **386px**, drawer widened proportionally. Still three side by side rather
than one at a time, since the three states (composer / drawer / face sheet) are
most legible compared against each other. The gesture annotations the review
asked for are not built.

## Not addressed

- Gesture and transition annotations on the phones.
- The deeper point behind the first impression — that a spec page inherently
  evaluates parts rather than conveying a product. The hero helps; it doesn't
  fully answer it. The real answer is a running app, which is Phase 0's job.
