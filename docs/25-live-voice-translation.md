# Live voice translation — is it doable?

Short answer: **yes for subtitles, on desktop-class hardware, today. Marginal on
phones. Speech-to-speech dubbing is a stretch goal, and probably a worse product
anyway.**

The longer answer is more interesting, because our architecture hands us two
advantages most products don't have.

## The pipeline and its latency budget

```
  mic ─▶ VAD ─▶ streaming ASR ─▶ machine translation ─▶ caption
                                            └─▶ (optional) TTS ─▶ dubbed audio
```

| Stage | Realistic cost |
| --- | --- |
| Voice activity detection (Silero-class) | ~10 ms |
| Streaming ASR, partial hypotheses | 200–500 ms per chunk; **1–2 s** before text stabilises |
| Machine translation of a settled sentence | 50–300 ms on-device (`10-translation.md` tier 1–3) |
| TTS, if dubbing | 200–800 ms |

So **captions land 1–2.5 s behind the speaker**, and **dubbed speech 2–4 s
behind**. That gap is the whole design problem, and it's why the recommendation
below is captions rather than dubbing.

## The two advantages we happen to have

**1. Per-speaker audio tracks.** LiveKit gives every participant their own
track. Every "translate the meeting" product has to solve *diarization* — who is
speaking — on a mixed stream, and it's the main source of garbage. We never mix,
so ASR runs per speaker with no diarization at all. Overlapping speech, which
destroys single-stream transcription, is just two independent streams here.

**2. It's structurally free under E2EE.** Everyone in the call already decrypts
the audio. Doing ASR and MT locally needs no key sharing, no server, no new
trust boundary — which is exactly the constraint that would normally kill this
feature, and here it costs nothing. Contrast with the cloud approach, which we
couldn't do even if we wanted to (`10` "the rule").

## Where the work should happen — ASR at the source, MT at the destination

The obvious design is "every listener transcribes what they hear." It's the
wrong one.

> **The speaker's device transcribes the speaker**, and publishes the text as an
> encrypted event. **Each listener translates that text into their own
> language**, locally.

Three reasons this is better:

- **Quality.** The speaker's device has the raw microphone signal before
  encoding, packet loss and jitter. A listener is transcribing audio that has
  been compressed and shipped over a network. Source-side ASR is meaningfully
  more accurate for free.
- **Cost.** One ASR run per speaker instead of one per listener per speaker.
  In a five-person call that's 5 instead of 20.
- **Bandwidth.** Text is nothing. It rides the same encrypted event log as
  everything else (`04` §2, an `m.annotation` of kind `transcript`), to the same
  audience that can already hear the speech — so it leaks nothing new.

Translation stays at the destination because it's cheap, and because everyone
wants a different target language.

**Fallbacks, in order:** if the speaker's device can't run ASR (a weak phone), a
listener may transcribe locally for themselves; if nobody can, a **captioner
agent** joins the call as a visible member (`21`, `23`). All three paths already
exist in the architecture.

## Hardware reality, 2026

| Device | Streaming ASR + MT |
| --- | --- |
| Laptop/desktop with a neural engine or discrete GPU | comfortable — runs Whisper-class models real-time with headroom |
| Recent flagship phone | plausible with a small streaming model (Moonshine/Parakeet-class, or distil-Whisper), and it will cost battery |
| Mid-range phone | no. Don't ship a toggle that produces a slideshow |
| In a browser | WebGPU where available; WASM is too slow for real-time streaming ASR |

This is the same shape as the translation ladder in `10` and gets the same
honest treatment: the capability check decides what the UI offers, and a device
that can't do it says so rather than degrading.

## Why captions beat dubbing

Dubbing is the flashier demo and the worse product:

- **Turn-taking collapses.** If you're hearing a translation 3 s behind, you
  will talk over people, constantly. Captions keep the speaker's *actual voice*
  in your ears — you retain their timing, their prosody, when they're winding
  down — while reading the meaning. The social protocol of a conversation
  survives.
- **You lose the person.** Their laugh, their hesitation, their accent. For a
  product about friends talking, replacing someone's voice with a synthetic one
  is a strange thing to do.
- **Errors are invisible.** A wrong caption sits next to the audio and you can
  often catch it. A wrong dub is asserted confidently in a neutral voice.

So: captions, with the original always available — the same principle as text
translation (`10` "never pretend a machine wrote it").

## The failure modes, stated

- **ASR errors compound into MT errors.** Garbage in, garbage translated, and
  the second stage makes the first stage's mistakes fluent and plausible.
- **Accents are the weak point** — and the thread that started this project
  specifically asked about understanding a Middlesbrough accent, which is
  precisely the hardest case. Whisper-class models are better than most and
  still degrade. Promising this specific use case would be overselling.
- **Names, jargon and in-jokes** transcribe badly. A per-room vocabulary hint
  (member names, custom emote names, recent message text) measurably helps and
  is cheap to build, since the client already has all of it locally.
- **Code-switching** — people mixing two languages mid-sentence — is poor
  across the board.

## What to build, in order

1. **Live captions, original language.** Source-side ASR, published as encrypted
   transcript events. Useful immediately for accessibility and noisy rooms, and
   it's the whole pipeline minus translation.
2. **Translated captions.** MT at the destination, reusing `10`'s ladder
   entirely. Per-listener target language.
3. **Save the transcript.** A call transcript is genuinely useful, and it must
   be explicit — captions never silently become messages in the room (`21`).
4. **Speech-to-speech.** An experiment behind a clearly-labelled toggle, if the
   latency ever gets under about a second. Not a v1 promise.

Belongs in the roadmap after voice ships (`06` Phase 5), not inside it.
