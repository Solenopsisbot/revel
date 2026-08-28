# Translation

Built in, not bolted on. A first-class client feature, because the architecture
means it can only ever be a client feature.

## The constraint that decides everything

The server cannot read messages. So there is **no server-side translation**, and
— more importantly — **no cloud translation either**. Shipping a decrypted
message to Google Translate or DeepL would hand the plaintext to a third party
and quietly undo the entire product. It is never an option, not as a fallback,
not behind a toggle, not "just for public rooms."

> **The rule:** a decrypted message never leaves the device to be translated.
> Translation happens on this device, or by a member of the room who is visibly
> in the roster.

That's the same shape as every other "but how do we do X without a server" answer
in this project (`02-architecture.md` "what the server can't do").

## The capability ladder

`packages/core/src/translate/` exposes one interface — `detect(text)`,
`translate(text, from, to)`, `availability(from, to)` — with backends tried in
order:

| Tier | Backend | Where it works |
| --- | --- | --- |
| 1 | **Browser `Translator` API** (`window.Translator` / `LanguageDetector`) | Chrome 138+ and Edge 148+, desktop. On-device, offline, free, no download managed by us. Edge covers 145+ language pairs, Chrome ~37. |
| 2 | **OS translation** via the native shell | Tauri desktop (Apple's on-device Translation framework on macOS); mobile OS APIs once native clients exist. |
| 3 | **Bundled models** — `transformers.js` running quantized **Marian / Opus-MT** pairs (small, one model per language pair) or NLLB-200-distilled for wider coverage | Anywhere. WASM is the stable runtime; WebGPU is still flaky for seq2seq, so treat it as opt-in acceleration, not the default. Models download on demand, per language pair, and are cached. |
| 4 | **A translator agent** — a key-holding member of the room that posts translations as annotations | Any room whose members want shared translation, on any device, including phones too weak for tier 3. Visible in the roster like any other agent (`11-people-and-agents.md`). |

Tiers 1–3 are **private**: nothing is posted, nothing leaves the device, and
nobody else in the room knows you needed a translation. Tier 4 is **shared and
visible** by construction. That difference is a feature and the UI names it.

`availability()` is what the UI branches on — it must be able to say "this
device can translate German→English offline" versus "this needs a 40 MB
download" versus "this device can't, but you could invite a translator."

## Local translation vs shared annotation

Two distinct things, deliberately not conflated:

**Local translation (default).** Your client translates for you. The result is
stored in your local database only. No event is created, the server sees nothing,
and other members have no idea. This is what "built in" means day to day.

**Shared translation.** You (or an agent) publish the translation as an
`m.annotation { kind: 'translation:de' }` event — encrypted like everything else,
visible to the room, attributed to whoever posted it. Useful when one bilingual
person is bridging a conversation, or when a room has a standing translator.

Local is the default because it's private and free. Sharing is an explicit act
with an explicit button.

## The controls

Three levels, all off by default, none of them surprising:

1. **Per message.** Every message has *Translate* in its hover/long-press
   actions. One tap, translation appears beneath, original stays. This always
   works and needs no configuration.
2. **Per room.** "Always translate this room to English." Set from the room
   header; shows a persistent, dismissible chip in the header while active
   (`Translating to English · Show originals`) so it is never ambiguous whether
   you are reading someone's words or a machine's.
3. **Global.** "Translate anything that isn't in a language I read." You list
   the languages you read; anything else gets translated. This is the
   set-and-forget option.

**The prompt.** The first time you see a message in a language you don't read,
a one-time inline offer appears under it: *"This is in German. Translate?"* with
*Just this once* / *Always for this room* / *No, and stop asking*. Dismissed
means dismissed — the discussion thread's "make sure you can turn it off" is a
hard requirement, and "stop asking" is permanent per room.

## Rendering — never pretend a machine wrote it

A translated message shows the translation in the message's normal position and
the original directly beneath in muted type, with a small globe glyph and the
language pair. Never replace the original silently; never hide it behind a
hover. If the reader wants to check a word, it must be right there.

- Translations are visually distinct — muted, with a rule down the left, the same
  treatment as annotations.
- The label always names the source: `Translated on this device` or
  `Translated by <agent name>`. A reader must be able to tell whether they're
  trusting their own device or another member.
- Failure is honest and quiet: "Couldn't translate this — the model for
  Icelandic isn't available on this device." With a *Download it* action if
  tier 3 could handle it.
- Emotes, mentions, code blocks and links are preserved by translating only the
  text runs of the `RichText` node tree, never the tree structure.

## Detection

Language detection runs on-device too (tier 1 gives it free; tier 3 uses a small
classifier). Detection results are cached per message id in the local store, not
recomputed on every render, and never sent anywhere.

Short messages are a known false-positive machine — "ok", "lol", emoji-only, a
bare link. The detector has a confidence floor and a minimum length below which
it simply declines to guess, because offering to translate "ok" from Dutch is
the kind of thing that makes people turn a feature off forever.

## Related: transcription and captions

Same architecture, same doc-level rule, different model. Voice clips get
on-device speech-to-text posted as a local transcript (or a shared
`m.annotation { kind: 'transcript' }`); live call captions run on the receiving
device. Both are covered by the same "on-device or a visible member" rule and
the same UI grammar. See `05-client-and-ux.md` §6.

## What this costs, stated plainly

- Model downloads on tier 3 — tens of megabytes per language pair. Metered, with
  a size shown before download and a "delete downloaded languages" control.
- Tier 3 on a low-end phone is slow. The UI shows real progress and offers the
  agent path instead.
- Machine translation is machine translation. The product should never imply the
  translation is authoritative, which is why the original is always visible.
