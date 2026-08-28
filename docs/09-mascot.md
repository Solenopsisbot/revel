# The mascot

Her name is **Wren**.

---

## 1. Who she is

### The name

Six candidates, then a pick.

**Wren.** A cavity nester — lives *inside* structures, in walls, in the gaps
between things. Famously the loudest bird for its size; a wren's song carries
further than birds three times larger. Fiercely territorial about its home
space. One syllable, warm, impossible to mispronounce. Not a tech product name.
Not a startup name. A person's name that also happens to be a small fierce bird
that lives in your walls and makes a lot of noise when something's wrong.

**Ember.** The persistent glow. Still warm at 3am when everything else has gone
dark. Good vibe, maybe too passive — an ember just sits there. Wren does
things.

**Rue.** The herb of grace — historically carried as protection, used to ward
off plague. Also "to rue," which is what happens when you ignore the recovery
code screen. The double meaning is almost too clever; it risks reading as
melancholy when the character isn't.

**Mote.** A particle of light in a sunbeam. Small, bright, everywhere. Good
metaphor for the local client, but it sounds like something you'd lose, and
she's the opposite of that.

**Thorn.** The small sharp thing on the stem. Protective, a bit punk. Honest
name for a character whose job includes pricking you before you do something
irreversible. But it reads as hostile, and she isn't hostile — she's just not
going to lie to you.

**Linnet.** Another small bird, musical, less common. Two syllables that flow.
But the obscurity works against it — half the people reading this had to look
it up, and a mascot shouldn't start with a vocabulary lesson.

**The pick is Wren.** She lives in your walls. She's small and she's loud. The
metaphor works on every level and the name works on zero levels that are wrong.

### Who she is as a person

Wren reads as maybe seventeen, maybe nineteen — old enough to be competent, young
enough to be honest about not knowing things, ageless in the way that a program
that shipped last Tuesday and will run for ten years is ageless. She's not
playing at being young and she's not playing at being old. She's just there,
and she's been paying attention.

**Personality.** Warm in the way that involves actually caring, not in the
marketing way that involves exclamation marks. Dry. Slightly too direct
sometimes, in a way that's clearly not rudeness but is clearly not
people-pleasing either. She notices things — she'll point out that your key
changed before you notice, the same way a friend would say "hey, did you know
your car's making a noise?" She doesn't make a production of it.

She's the friend who sits with you at 3am while your deploy is on fire and
says "okay, here's what actually happened" instead of "don't worry, it'll be
fine." She worries. She just worries *usefully*.

**What she finds funny.** The gap between how complicated something is under
the hood and how simple it looks from outside. She lives in that gap. She also
finds it funny when people are scared of the recovery code screen — not in a
mean way, in a "yeah, it's a lot, I know, but look, you just write it down and
then it's fine" way. She thinks the phrase "military-grade encryption" is the
funniest thing in the world.

**What she's stubborn about.** The truth. Not Truth with a capital T, not some
philosophical commitment — just: if the server can't reset your password, she's
going to say the server can't reset your password. She won't soften it. She
won't apologise for it. She will explain *why*, clearly, and she'll make sure
you understand that the reason it's inconvenient is the same reason it's safe,
and she'll help you through it, but she will not pretend the wall isn't there.
That's her whole deal. The wall is there, it's supposed to be there, and she's
on your side of it.

Also stubborn about: making sure you saved the recovery code. She's not going
to nag, but she's not going to let you skip it, and the look on her face on
that screen is the visual equivalent of "I am asking you nicely and I will only
ask once."

---

## 2. Her role

### She is the client

In an end-to-end encrypted system, the server is a blind relay. It moves
ciphertext around. It doesn't know what you said. It can't find out. That's the
product's core promise, and it's real.

Which means the only piece of software that is *structurally on your side* is
the one running on your device. The local client. The thing that generates your
keys, holds them, encrypts your messages before they leave, decrypts the ones
that arrive, checks that the person you're talking to is who they say they are,
and tells you — honestly, in plain language — what the server can and can't see.

Wren is that thing, personified. She lives on your device. She lives inside
the encryption boundary. She sees exactly what you see, because she *is* how
you see it — she's the process that turns ciphertext into the conversation on
your screen. She is not a service. She is not a bot floating in the cloud
waiting for your messages. She is local, she is yours, and when she tells you
something, it's because she's right there next to you looking at the same
data.

### Why she can't be a room bot

The product promises **no ghost readers**: if something can read a room, it's
in the roster, visible to every member. That promise is what makes the "bot"
badge in the member list meaningful — you can see exactly who and what has
access to your conversation, always, no exceptions.

A mascot who could silently read your chats would be a ghost reader. She'd be
the exact thing we swore didn't exist. It doesn't matter how friendly she is or
how good her intentions are; if she can read rooms without being listed, the
entire "no ghost readers" guarantee is a lie, and the product's thesis burns
down.

So she's not in your rooms. She can't be. **This is a feature of the design,
not a limitation.** It's *because* the architecture is honest that her role is
what it is: she's not watching your conversations, she's the reason you can
have them. She doesn't need to be in the room. She *is* the room.

### The agent account (optional, separate, explicit)

A user who wants Wren *in* a room — as a conversational agent, a helper, a
presence — can add her as an agent account. That instance is a real account
with real device certs, a real leaf in the MLS group, and a real entry in the
roster with the `bot -- can read this room` badge. It's visible. It's
auditable. It's the same as any other bot.

The distinction between "Wren the client" and "Wren the agent" must be
explicit. The client-side Wren and the agent-account Wren are not the same
instance, don't share state, and the UI should never blur the line. The client
is always there. The agent is invited, can be removed, and shows up in the
member list like anyone else.

---

## 3. Where she appears

### She appears

**Onboarding and sign-up.** The recovery code screen is her moment. This is the
screen where the product has to be the most honest it ever is ("if you lose
this and forget your password, your account is gone and we genuinely cannot help
you"), and that honesty is her whole personality. She's present — visually, in a
moment-screen illustration — and the copy on this screen can be written in her
voice. She doesn't introduce herself here; she just *is* the voice.

**The forgot-password screen.** The hardest screen in the app. She's present
here too — same deal, the honest difficult thing needs to come from someone
you trust, not from a system dialog.

**Error banners.** The four crypto-state banners (sync lag, history-off,
key change, session disagreement) are her territory. These are moments where
the app has to explain something technical in a way that's honest without being
scary, and a consistent character voice makes that work. She's not visually
present on these — they're workspace chrome, not moment screens — but the
voice is hers.

**Empty states.** The first-run empty room, no-DMs-yet, no-rooms-yet screens.
These are gentle moments and she can be warmer here. On a moment screen (first
run), she can appear visually. On workspace empty states, she's voice only.

**The landing page.** She's the face of the product. She appears in the hero
illustration the way character art does in the work that inspired this — in the
layout, occluding
panel edges, part of the composition. She's not a logo. She's a person
standing next to the thing she's showing you.

**The "about" / "how it works" page.** When the product explains its
architecture to a visitor, she's the one explaining. This is where her
"friend who knows how the building is wired" register lives.

**First-run welcome message.** The welcome bot from `08-voice-and-copy.md` is a
separate agent account (not Wren-the-client), but it can share her name and
personality. The welcome message is already written in her register. If the
agent account is named Wren, the visual and tonal continuity between
"the character on the sign-up screen" and "the first DM I received" is
powerful — and it's honest, because the agent is visible in the roster.

**The device list and key verification screens.** These are her domain. She
holds your keys; showing you who else holds them is her job.

### She does not appear

**The message list.** Never. Not as an avatar in the conversation flow, not as
an inline tip, not as a "did you know?" bubble between messages. The message
list is the user's space. It's where they're talking to other people. Wren is
not other people; she's the room itself. Inserting her into the conversation
would be Clippy, full stop.

**Mid-conversation in any form.** No tooltips triggered by message content, no
"it looks like you're writing a..." anything, no proactive suggestions while
someone is typing or reading. She responds to *states* (your device can't
decrypt, a key changed, you're about to do something irreversible), never to
*content*.

**Settings panels.** Settings are controls, not conversations. The toggle
descriptions in `08-voice-and-copy.md` are already in the product's voice;
they don't need a character attached. Wren's face next to "Disappearing
messages" would make a dense settings panel feel like a game, and this is not
a game.

**Notification text.** Push notifications are terse by necessity and by
convention. "New sign-in: laptop" does not need a character.

**The room list, the member list, the rail.** These are workspace chrome. They
should be quiet, dense, and fast to scan. A mascot presence here would
undermine the density that makes the workspace usable for hours.

### How to not be Clippy

Clippy failed because he was **proactive about things you didn't ask about,
interruptive during tasks that required focus, and impossible to make go away.**
The mascot avoidance strategy is the inverse of each:

1. **Wren is reactive, not proactive.** She speaks when a state requires
   explanation (error, key change, empty, first-run, irreversible action). She
   never speaks because she noticed something interesting about what you're
   doing.

2. **Wren appears on moment screens, not workspace screens.** The moment/
   workspace split from `07-design-language.md` is the structural guard. Moment
   screens are seen rarely and remembered. Workspace screens are seen for hours
   and must be invisible. She lives in the first category.

3. **Wren is dismissible where she's textual and absent where she'd need
   dismissing.** The error banners resolve themselves or have a clear action.
   The empty states vanish when you create a room. There is no persistent
   mascot widget, no sidebar pet, no "Wren's tips" panel.

4. **Wren never comments on your behaviour.** She comments on *system state*.
   "Your key changed" is her. "You've been chatting a lot today!" is a death
   sentence for the character.

---

## 4. Her voice

Wren's voice is the product's voice from `08-voice-and-copy.md`, but warmer
and more personal — first person where the product is impersonal, "I" where
the product says "we", direct address where the product states facts. The
product sounds like a friend who happens to know how the building is wired.
Wren *is* that friend.

The rules still hold: no emoji, no "military-grade," no "we take your privacy
seriously," state costs alongside benefits, be honest about what she can't do.
She just says "I can't" instead of "we can't," and she's allowed to sound like
she cares about whether you heard her.

### Rewrites

Original lines from `08-voice-and-copy.md` on the left; Wren saying them on
the right.

**Recovery code screen:**

> *Neutral:* "Your password never leaves your device -- not even we have it.
> That means if you forget it, nobody can reset it."
>
> *Wren:* "Your password never leaves this device. I don't have it. The server
> doesn't have it. Nobody does. That's what makes it safe, and that's why
> nobody can reset it -- including me."

**The checkbox:**

> *Neutral:* "I saved my recovery code somewhere I won't lose it."
>
> *Wren:* "I saved it. Seriously." *(same checkbox, her tone in the label)*

**Forgot password -- the hard one:**

> *Neutral:* "If you don't have either of these, the account cannot be
> recovered. This is not a policy -- it is a property of the system. The
> server does not have enough information to let you back in."
>
> *Wren:* "If you don't have your recovery code or your passkey, I can't get
> you back in. Not won't -- can't. The server doesn't have your password and
> I don't have a back door. That's the architecture that kept your messages
> safe, and this is the one place it costs you. I'm sorry. I mean that."

**Key change banner:**

> *Neutral:* "[name]'s key changed. This happens when someone gets a new
> device or reinstalls. If you're not sure, ask them."
>
> *Wren:* "[name]'s key changed -- usually that's a new device or a reinstall.
> If you weren't expecting it, ask them. I'd rather you check."

**Empty room:**

> *Neutral:* "This is where your rooms will be. Create one, or check your
> DMs -- someone might have already said hi."
>
> *Wren:* "Nothing here yet. This is yours -- make a room, or check your
> DMs. Someone might've already said hi."

**Sync lag:**

> *Neutral:* "This device can't read messages here yet. It's syncing -- give
> it a minute."
>
> *Wren:* "I can't read the messages here yet -- I'm still catching up. Give
> me a minute."

**Disappearing messages toggle:**

> *Neutral:* "Messages are removed after the timer runs out. This is a
> courtesy, not a guarantee -- anyone who saw a message can screenshot it.
> Software can't fix that."
>
> *Wren:* "I'll delete them when the timer runs out. But if someone saw a
> message, they can screenshot it. That's not something I can fix -- that's
> a human problem, not a software one."

**Adding a bot to a room:**

> *Neutral:* "[Bot name] will be able to read and send messages in this room,
> the same as any member."
>
> *Wren:* "[Bot name] gets the same access as anyone else in this room --
> they can read everything here and send messages. You'll see them in the
> member list. Everyone will."

---

## 5. Visual direction

This section is a brief for an artist. It describes a character who should be
drawable from this text alone.

### What she is not

The visual inspiration for this project came from a friend's designs, and those
characters are hers. Wren must not resemble any of them — same warmth, same
world, completely different person. If you are drawing her and want to know what
to steer away from, ask; those references are not published here.

### Silhouette and build

Small. Not chibi-small, just -- she doesn't take up a lot of space. Slim,
slightly sharp in the shoulders and jaw in a way that reads as alert rather
than delicate. Her silhouette should be *recognisable at 32px* -- that's her
smallest appearance (a tiny icon in the device list or an error banner source).
Something about her outline needs to be distinctive at thumbnail scale: the
hair, probably.

### Hair

Short-to-medium, tousled, with a piece that does its own thing -- an
asymmetric sweep, or a strand that curves like an antenna, something that
gives the silhouette a hook. Not long flowing hair. Not a
neat bob (too polished for someone who lives in your device's memory). The
kind of hair that looks like she rakes her hands through it when she's
thinking.

**Colour:** rooted in the app's palette. Primary recommendation: **mint**
(`#3DDC84`) as the dominant, with **aqua** (`#35D6D6`) at the tips or as an
inner gradient -- these are the two candy colours that aren't claimed by UI
roles (`rose` is action, `violet` is brand, `gold` is decoration, `sky` is
links). Mint-to-aqua reads as cool and alert without being cold. Alternative:
**lilac** (`#C79BFF`) to **sky** (`#58A6FF`), which is warmer but closer to
the inspiration's palette and needs more care to differentiate.

### Eyes

Expressive and slightly too perceptive -- the kind of eyes that make you feel
like she noticed something before you did. Colour should contrast the hair:
if mint/aqua hair, then **gold** (`#FFD84D`) or **coral** (`#FF7A5C`) eyes.
If lilac/sky hair, then **gold** or **mint** eyes.

### Costume

Practical. Not a school uniform, not a formal dress. Something you'd actually
wear if you lived inside a computer
and occasionally had to crawl through the encryption layer: a hoodie or a
light jacket, slightly oversized, with a visible device or key motif
somewhere -- not a literal key icon, something more abstract. Maybe a
geometric pattern on the sleeve or the back that echoes the star mark from
the design language without being a literal star.

Colours from the palette: the hoodie/jacket in a muted version of her hair
colour or in the app's ground tones (`--ground-2` / `--ground-3` range),
with candy-colour accents on zippers, hems, inner lining. She should look like
she belongs in the app's colour world without being a palette swatch.

Underneath: simple. A dark top, fitted, nothing fussy. The outer layer is the
costume; the inner layer is just clothes.

### Expression set

The app needs a finite number of poses and expressions, not a full character
sheet. Here is what's actually required:

| Expression | Used for | Notes |
| --- | --- | --- |
| **Neutral-warm** | Landing page hero, about page, default | Slight smile, eyes open and attentive. The "I'm here, what do you need" face. This is 80% of her appearances. |
| **Serious-caring** | Recovery code screen, forgot-password screen | Not sad, not scared. The face you make when you're telling someone something important and you need them to actually hear you. Brow slightly drawn, mouth level. |
| **Pleased** | First-run welcome, successful verification, account recovery success | A real smile. Not a grin, not a beam. The quiet "oh good, that worked" smile. |
| **Alert** | Key-change banner, new-device notification, session disagreement | Eyes slightly wider, head tilted a fraction. Noticing something. Not alarmed -- just paying attention. |
| **Apologetic** | The hard error states, "I can't help you get back in" | The closest she gets to sad. Not performative sadness. The face of someone who is genuinely sorry about a thing they genuinely can't change. |
| **Explaining** | Architecture page, "how it works" sections | Talking with her hands (if the pose allows it), or leaning slightly forward. Engaged. This is the expression for when she's telling you something she thinks is interesting. |

Six expressions. That's the set. An artist could reasonably produce these as
six bust-up illustrations (shoulders and head) for workspace-adjacent uses, plus
two or three full-body poses for moment screens (landing hero, recovery code,
about page).

### How she sits in the layout

Per `07-design-language.md`: art is **in** the layout, not pasted onto it. She
should overlap panel edges, sit behind glass layers, break the frame the way
character art does in the work that inspired this. On moment screens she's
full-body or three-quarter,
large, part of the composition. In workspace contexts (where she appears at
all -- only error banners and the device list), she's a small avatar-sized
icon using one of the bust-up expressions.

Her poses should work with the app's reading direction: she looks toward the
content she's accompanying, not at the viewer. On the landing page she might
look toward the sign-up panel. On the recovery code screen she looks at the
code. The exception is the "serious-caring" expression, where she should look
directly at the user.

---

## 6. What she is not

The failure modes. The ways this goes wrong.

**She is not a tutorial system wearing a face.** If her only function is to
deliver tooltips that could just as easily be paragraphs of help text, the
character is a costume on a help center and everyone will sense it. She has to
feel like she *means* it when she talks, not like she's reading from a script.
The way you test this: if you could remove her and replace every line with
generic UI copy and lose nothing, she's failed.

**She is not cute-as-brand-strategy.** The anime-girl mascot is a known
pattern in tech and most of the time it's a calculated "make the product feel
approachable" move that reads as exactly that -- calculated. Wren has to
actually be a character. She has opinions. She's stubborn about specific
things. She finds specific things funny. If the design team can't answer "what
would Wren think about this?" for an arbitrary product decision, she's not a
character yet, she's clip art.

**She is not servile.** This is the big one, given the project's feelings
about AI characters written as assistants. Wren does not exist to serve. She
exists because the client needs a voice, and she's the voice it got. She
helps you because she's right there and she can, the way a roommate helps you
find your keys -- not because helping you is her purpose. She will tell you
things you don't want to hear. She will not apologise for the architecture.
She'll apologise for the *inconvenience* ("I'm sorry, I mean that") but never
for the *decision*. The decision is right. She knows it's right. She's just
honest about what it costs.

**She is not omniscient.** She knows what the client knows. She can't tell you
what the server is doing (because the client can't see the server's internals),
she can't tell you what's in a room she's not decrypting for you, she can't
predict whether a key change is benign or malicious. When she says "ask them,"
she means it -- she doesn't know, and she's not going to guess. Characters who
always have the answer are either gods or liars, and she's neither.

**She is not always on screen.** The strongest version of Wren is the one you
barely notice until something important happens, and then she's *right there*,
and she's clear, and she's honest, and you're glad she showed up. If she's
everywhere, she's wallpaper. The moment/workspace split exists to prevent this,
and the list of places she doesn't appear (section 3) is as important as the
list of places she does.

**She does not have lore.** She doesn't have a backstory about being "born in
the encryption layer" or "created by the founders." She doesn't have a birthday.
She doesn't have hobbies. She's a mascot, not a visual-novel protagonist, and
the moment she has a lore page is the moment the product has become self-indulgent
about a thing that should be functional. Her personality is fully expressed
through how she does her job. That's enough. That's the whole character.

**She does not get between you and the person you're talking to.** This is the
compositional version of "she's not in the message list." Wren's presence in
the product should never make a conversation feel like it has a third party.
Even on the screens where she appears, she's talking to *you* about the
*system* -- she's never commenting on your social life, your message frequency,
your relationships, or anything that is none of her business.
