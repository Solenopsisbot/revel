# Wren -- character art generation record

Reproducible record of Wren's character art. Regenerate any image from the
prompts, seeds, and settings below.

## Setup

- **Host:** a workstation with enough VRAM for SDXL-class inference
- **Software:** Automatic1111 stable-diffusion-webui, API mode (`--api --nowebui`)
- **API endpoint:** `http://127.0.0.1:7861` (local only, not exposed)
- **Model:** `JANKUTrainedNoobaiRouwei_v60.safetensors [70ba3a56ff]`
- **VAE:** Automatic (model's built-in)
- **Size:** 768x1248
- **Sampler:** DPM++ SDE
- **Scheduler:** Karras
- **Style preset:** "Anime Girl" -- appends `1girl, solo, portrait, smile, best quality, masterpiece,` to the prompt and `EasyNegative, 2girls, siblings, sisters, multiple girls, everyone, from below, s...` to the negative

### Why not bunny_v4

The original plan called for `bunny_v4.safetensors` with `pastel-waifu-diffusion.vae.pt`.
bunny_v4 loads but cannot generate on this MPS setup -- every inference fails with
`Cannot convert a MPS Tensor to float64 dtype`. This is a PyTorch/MPS incompatibility
that would require restarting the server with `--no-half` or `--upcast-sampling`.
The Noobai model (Illustrious XL-based, strong anime output) works cleanly and
produced good results. The pastel-waifu VAE is an SD 1.5 VAE and produces heavy
corruption artifacts when paired with this SDXL-class model -- use Automatic.

---

## Final images

All in `design/wren/`.

### wren-portrait-01.png -- the hero portrait

**Expression:** neutral-warm with fang. Tousled messy hair, knowing smile, gold
eyes. The "I'm here, what do you need" face. This is the primary Wren image.

**Prompt:**
```
short messy mint green hair, aqua colored hair tips, gradient hair, asymmetric bangs, ahoge, gold eyes, bright eyes, sharp jawline, slight smile, fang, confident expression, oversized black hoodie, hood down, mint green drawstrings, accent stripe on sleeve, dark top underneath, small build, upper body, looking at viewer, dark purple background, <lora:style_rurudo:0.5>
```
**Negative:**
```
EasyNegative, bad-hands-5, text, logo, writing, long hair, lavender hair, white hair, purple vest, bow in hair, cyan eyes, black dress, ruffled dress, thigh-highs, red eyes, pink eyes, chibi, child, loli, blush stickers, watermark
```
**CFG:** 7.5 | **Steps:** 18 | **Seed:** 1620953972
**LoRA:** style_rurudo @ 0.5

---

### wren-portrait-02.png -- clean portrait (avatar source)

**Expression:** neutral-warm, subtle fang. Simpler composition, cleaner rendering.
Best candidate for small-size use. `wren-avatar-01.png` is a 768x768 square crop
of this image (offset 50px from top).

Same prompt/negative/settings as portrait-01.
**Seed:** 1620953973

---

### wren-avatar-01.png -- square avatar crop

768x768 crop of portrait-02, face-centered. Cropped with:
```
sips -c 768 768 --cropOffset 50 0 wren-portrait-02.png --out wren-avatar-01.png
```

---

### wren-fullbody-01.png -- standing pose for art-slot

**Expression:** neutral-warm. Standing, hands in pockets, quiet smile. Fits the
dashed `art-slot` on moment screens (recovery code screen has a 240x350 slot).

**Prompt:**
```
full body, standing, short messy mint green hair, aqua colored hair tips, gradient hair, asymmetric bangs, ahoge, gold eyes, bright eyes, fang, slight smile, confident pose, hands in pockets, oversized black hoodie, hood down, mint green drawstrings, dark shorts, sneakers, small slim build, dark purple gradient background, <lora:style_rurudo:0.45> <lora:kedama-XL-v31-ep20:0.35>
```
**Negative:**
```
EasyNegative, bad-hands-5, text, logo, writing, long hair, lavender hair, white hair, purple vest, bow in hair, cyan eyes, black dress, ruffled dress, thigh-highs, red eyes, pink eyes, chibi, child, loli, blush stickers, watermark, sitting, cropped
```
**CFG:** 8 | **Steps:** 20 | **Seed:** 1280781436
**LoRAs:** style_rurudo @ 0.45, kedama-XL-v31-ep20 @ 0.35

---

### wren-serious-01.png -- serious-caring (recovery code screen)

**Expression:** serious-caring. Direct eye contact, level mouth, slightly drawn brow.
The face for "I can't get you back in. Not won't -- can't."

**Prompt:**
```
short messy mint green hair, aqua colored hair tips, gradient hair, asymmetric bangs, ahoge, gold eyes, bright eyes, serious expression, concerned, slight frown, caring expression, looking directly at viewer, oversized black hoodie, hood down, mint green drawstrings, small build, upper body, dark purple background, <lora:style_rurudo:0.5>
```
**Negative:**
```
EasyNegative, bad-hands-5, text, logo, writing, long hair, lavender hair, white hair, purple vest, bow in hair, cyan eyes, black dress, ruffled dress, thigh-highs, red eyes, pink eyes, chibi, child, loli, blush stickers, watermark, smile, grin, happy
```
**CFG:** 7.5 | **Steps:** 18 | **Seed:** 3421240870
**LoRA:** style_rurudo @ 0.5

---

### wren-alert-01.png -- alert (key-change, new device)

**Expression:** alert. Wide gold eyes, three-quarter angle, looking slightly to the
side, small parted lips. "Noticed something before you did."

**Prompt:**
```
short messy mint green hair, aqua colored hair tips, gradient hair, asymmetric bangs, ahoge, gold eyes, wide eyes, alert expression, head tilt, surprised, curious, looking slightly to the side, parted lips, oversized black hoodie, hood down, mint green drawstrings, small build, upper body, dark purple background, <lora:style_rurudo:0.5>
```
**Negative:**
```
EasyNegative, bad-hands-5, text, logo, writing, long hair, lavender hair, white hair, purple vest, bow in hair, cyan eyes, black dress, ruffled dress, thigh-highs, red eyes, pink eyes, chibi, child, loli, blush stickers, watermark, smile, grin
```
**CFG:** 7.5 | **Steps:** 18 | **Seed:** 3124517542
**LoRA:** style_rurudo @ 0.5

---

### wren-alert-02.png -- softer alert variant

Same as alert-01 but a softer, more curious read. Wide gold eyes, looking slightly
up. Could serve as an alternative for less urgent notifications.

Same prompt/negative/settings as alert-01.
**Seed:** 3124517544

---

## What worked

- **style_rurudo** at 0.5 was the breakthrough. It made the faces dramatically more
  expressive -- punchy eyes, readable emotion at small scale. Without it, the Noobai
  model produced competent but flat faces.
- **kedama-XL-v31-ep20** at 0.35 stacked with rurudo at 0.45 worked well for the
  full-body -- it added cleaner linework without fighting rurudo's expression quality.
- **"fang"** as a tag gave Wren a signature detail that reads even at avatar size.
  It appeared naturally in Round 1 and was promoted to a deliberate element.
- **Mint drawstrings** on the black hoodie provided the candy-accent-on-dark-ground
  pattern from the design language without generating garbled text.
- The **dark purple background** ties directly into the app's dusk-theme ground tones.
- **"text, logo, writing"** in the negative mostly suppressed hoodie text, though it
  still broke through on some seeds.

## What didn't

- **"geometric pattern on sleeve"** generated garbled text/logos on the hoodie chest
  instead of sleeve geometry. Dropped in Round 2.
- The hair never quite achieved a clean **mint-to-aqua gradient** as the spec
  describes. It reads as uniform mint/teal with occasional lighter or aqua sections
  rather than a deliberate root-to-tip shift. An img2img pass with a colour-masked
  gradient could fix this, or inpainting the tips to shift them toward #35D6D6.
- **Coral eyes** were never tested. The gold eyes work so well against the mint hair
  that the alternative path wasn't explored. Worth a future session.
- **The "pleased" and "explaining" expressions** from the expression set in
  09-mascot.md are not yet generated. The current set covers neutral-warm, serious-
  caring, and alert.

## With more time

- Generate the remaining three expressions (pleased, apologetic, explaining).
- Try img2img or inpainting to push the hair tips toward true aqua (#35D6D6).
- Test coral (#FF7A5C) eyes as an alternative -- the spec lists it.
- Try the cozy_anime LoRA for warmer, softer moment-screen variants.
- Regenerate on bunny_v4 if the MPS issue is resolved (restart with `--no-half`).
- ~~Produce transparent-background versions for compositing into the layout.~~
  Done in Round 3, below.

---

## The bunny_v4 two-step

`bunny_v4` fails on a direct switch (`Cannot convert a MPS Tensor to float64
dtype`) — which is why this run used the Noobai model. **The workaround is to
load `rabbit_v7` first and then `bunny_v4`.** Loading the SD 1.5 model appears
to reset dtype state that a direct SDXL-to-SDXL switch leaves broken. Worth
re-running the final prompts on bunny_v4 this way to compare.

---

## Round 3 -- the cutout pass (nano banana)

**This closed the transparent-background gap.** Every image above has a solid
dark ground, so dropping one into a layout produced a visible rectangle, and
naive chroma-keying was never going to work: the background is near-black and
her hoodie is also black, so keying dark pixels eats the character.

The fix was the one the last section predicted -- edit the kept renders in
**nano banana** rather than re-rolling the generator. Six images came back with
real alpha, a consistent character across all of them, and the hoodie's mint
accents intact.

All in `design/wren/`, named `wren-cut-*` so the cutout ones are obvious in a
directory listing -- that is the property you are choosing on.

| File | Source | What it is |
|---|---|---|
| `wren-cut-warm.png` | 1024x1024 | Neutral-warm, fang showing. The "here, what do you need" face. |
| `wren-cut-serious.png` | 1024x1024 | Serious-caring. Level mouth, direct eye contact. |
| `wren-cut-alert.png` | 1024x1024 | Alert. Wide eyes, parted lips. |
| `wren-cut-standing.png` | 768x1376 | Full body, hands in pockets, quiet smile. |
| `wren-cut-leaning.png` | 768x1376 | Full body, leaning, one foot crossed. Waiting rather than answering. |
| `wren-cut-seated.png` | 896x1200 | Seated, chin on hand. Sits on a white plinth that is part of the image. |

The three portraits share a framing, so they can be swapped in place without
the composition moving -- which is what makes a per-screen `pose` prop worth
having rather than a single mascot image.

### Derived web assets

`apps/web/static/wren/`, generated from the sources above:

```sh
# Full-body: trim to the alpha bounding box so CSS positions her by her
# silhouette rather than by the generator's padding, then 2x the largest
# on-screen height (620px).
magick wren-cut-standing.png -trim +repage -resize x1240 -quality 88 standing.webp
magick wren-cut-leaning.png  -trim +repage -resize x1240 -quality 88 leaning.webp
magick wren-cut-seated.png   -trim +repage -resize x1000 -quality 88 seated.webp

# Expressions, at panel size and at avatar size.
magick wren-cut-warm.png -resize 512x512 -quality 90 warm.webp
magick wren-cut-warm.png -resize 128x128 -quality 90 warm-sm.webp   # and serious, alert
```

412 KB for the whole set, against 892 KB for the single dark-background PNG it
replaced.

### What changed in the app

- `Moment.svelte` and the landing hero **no longer carry the CSS edge mask.**
  That mask existed only to fade out the corners of a rectangular dark render;
  with real alpha it was actively harmful, because it dimmed her face.
- What replaced it is a soft drop shadow. It is doing real work rather than
  being decoration: her hoodie is near-black and the moment ground is a dark
  violet gradient, so without a shadow the silhouette merges into the
  background and only the mint accents survive.
- `Moment.svelte` takes a `pose` prop. Full-body poses hang from the bottom
  edge; the expression portraits sit lower and larger, so her face lands at
  about headline height.
- Screen assignments: recovery code and forgotten-password get `serious`,
  because those screens have to be believed rather than liked. Device pairing
  gets `alert`. The landing page and sign-in get `leaning` -- the two screens
  where she is waiting on you. Ordinary sign-up gets `standing`.

`seated` is exported but unused. The white plinth she is sitting on is part of
the image, so it needs a layout with somewhere to sit; it is not a drop-in
replacement for the other two.

## Still open

- **The hair gradient.** Round 3 reads as a mint-to-aqua shift far better than
  the SD renders did, but it is still not the deliberate root-to-tip gradient
  the spec describes.
- **The pleased and explaining expressions** from `09-mascot.md` are still not
  generated. The cutout set covers neutral-warm, serious-caring and alert.
- **Coral eyes** have never been tested. The gold works, so the alternative in
  the spec has not had a fair hearing.
- **Poses for the app shell.** Everything so far is a moment-screen figure.
  The Wren panel (`docs/12`) will want something that reads at 32px and in a
  narrow column, which is a different problem.
