# Wren's notices — copy deck

Every notice Wren surfaces in the panel. For each: the short title the user
sees, one or two lines of body (never more than ~30 words), and the action
button label(s). Developers paste from this; if this doc and a mockup disagree,
this doc wins.

Voice rules from `08-voice-and-copy.md` and `09-mascot.md` apply. No emoji.
No exclamation marks unless something is genuinely delightful. She speaks about
state, never about behaviour.

---

## 1. Keys and devices

**Recovery code never confirmed saved**

> **You don't have a safety net yet**
>
> If you forget your password and haven't saved your recovery code, that's the
> account. I can't get you back in. Nobody can.
>
> [Save recovery code]

**Only one device enrolled**

> **Your keys live on one device**
>
> If something happens to this device, your recovery code is the only way back.
> A second device means your keys exist in two places.
>
> [Add a device]

**Passkey available but not set up**

> **You could skip the password**
>
> A passkey lets you unlock with your face or fingerprint. It also gives you
> another way back in if you forget your password.
>
> [Set up a passkey]

**Device not seen in 90 days**

> **Haven't seen [device label] in a while**
>
> It's been 90 days. If you still use it, nothing to do. If you lost it or
> stopped using it, revoking it locks it out of your account.
>
> [Revoke device]  [It's fine]

**Contact's key changed**

> **[name]'s encryption key changed**
>
> Usually a new device or a reinstall. If you weren't expecting it, ask them
> before you keep going. I'd rather you check.
>
> [Verify with [name]]  [I expected this]

---

## 2. Who can read this

**Adding an agent to a room**

> **[bot name] will be able to read this room**
>
> Same access as any member — every message, past and future. Everyone in the
> room will see it in the member list.
>
> [Add anyway]  [Cancel]

**Turning on history-for-new-members in a room with 50+ members**

> **New members will get the full backlog**
>
> This room has [n] people. Turning this on means anyone who joins from now on
> can read everything that came before them.
>
> [Turn on]  [Keep it off]

**Invite link is long-lived and high-use**

> **This invite link is doing a lot of work**
>
> It's been used [n] times and doesn't expire. Anyone with the link can still
> join. You can replace it without breaking existing members.
>
> [Replace link]  [Set an expiry]  [Leave it]

**Posting in a room with a bot you may have forgotten**

> **[bot name] is in this room**
>
> Added [timeframe] ago. It can read everything here, same as any member. Just
> making sure you remember.
>
> [View member list]  [Got it]

---

## 3. Getting more out of it

**Room is mostly in a language you don't read**

> **Most of this room is in [language]**
>
> I can set up translation so you read it in [your language]. Messages stay
> encrypted — translation happens on your device.
>
> [Turn on translation]  [No thanks]

**Someone keeps sending voice clips**

> **A lot of voice messages here**
>
> I can transcribe them so you can read along. Runs on your device, nothing
> leaves.
>
> [Turn on transcription]  [No thanks]

**Never opened the command surface**

> **There's a command bar, if you want it**
>
> Press [shortcut] to open it. Search, switch rooms, manage devices, the
> usual. Faster than clicking around.
>
> [Open it now]  [Dismiss]

---

## 4. Housekeeping

**Downloaded language models never used**

> **[model name] is taking up [size]**
>
> You downloaded it for translation but haven't used it in [timeframe]. I can
> free up the space.
>
> [Delete model]  [Keep it]

**Rooms you left that still hold local history**

> **Local history from [n] rooms you left**
>
> Taking up [size]. You left these rooms, but the messages are still on this
> device. Clearing them is permanent.
>
> [Clear history]  [Keep it]

**General storage**

> **Local storage is at [n]% of the limit**
>
> Mostly [largest category]. I can clear old caches and expired media without
> touching your messages.
>
> [Free up space]  [Show details]

---

## 5. The three interrupting popups

These are the only notices allowed to break someone's flow. Each must justify
itself in its first line. At most one per session, three per week. Over budget,
they degrade to panel notices.

**Irreversible action — deleting your account**

> **This deletes your account permanently**
>
> Your messages in rooms will stay (other members hold their own copies), but
> your keys, your faces, your device list — all gone. There's no undo and I
> can't recover it afterward.
>
> [Delete my account]  [Go back]

**Safety condition — contact's key changed mid-conversation**

> **[name]'s key just changed, mid-conversation**
>
> That's unusual. It can be legitimate — a new device, a reinstall — but the
> timing is worth a second look. Messages you send now go to whoever holds the
> new key.
>
> [Verify with [name]]  [I expected this]  [Stop sending]

**Time-sensitive — single device, no confirmed backup**

> **You have one device and no backup confirmed**
>
> If you lose this device right now, your account is gone. Your recovery code is
> the only way back in, and I don't have a record of you saving it.
>
> [Save recovery code]  [I already saved it]

---

## Things she must never say

These are notices that would be wrong for Wren. Each one violates a specific
principle. If you're writing a new notice and it sounds like any of these, stop.

**"You've been chatting a lot today."**
Comments on behaviour, not state. Her job is the system, not your social life.

**"Great job setting up your passkey."**
Praise is patronising. She's not a rewards system. The passkey is set up; that's
the end of the interaction.

**"It's been a while since you opened the app."**
Engagement nudging. She works for you, not for a retention metric.

**"Your messages are safe with us."**
"Trust us" is banned (`08-voice-and-copy.md`). She shows architecture, she
doesn't ask for trust.

**"For your security, we recommend..."**
Corporate hedging voice. She doesn't recommend. She notices a state and offers to
fix it.

**"Don't forget to check your privacy settings."**
Nagging about a thing the user already decided. If the settings are wrong, she
says what's wrong. She doesn't send you to a page to figure it out yourself.

**"Someone new joined your room — say hi."**
Social coaching. None of her business. She doesn't have opinions about your
relationships.

**"Time to update the app."**
She's not a software updater. If an update matters for a security reason, the
security reason is the notice, not the update.

**"You haven't posted in [room] in a while — it's busy, though."**
This one was in this deck, as a real notice, until `12-wren-as-guide.md` cut it
during review and the copy here outlived the decision. It is the hardest of
these to see, because it reads as pure state: a count and a recency, both true,
both things the client already knows. But "busy room you never post in" is one
abstraction step from *we noticed you're not engaging*, which is where every bad
notification system ends up. **Lurking is not a problem to solve.** Muting stays
a normal feature a click away; Wren just doesn't bring it up.
