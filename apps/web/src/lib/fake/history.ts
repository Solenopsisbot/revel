/**
 * A generated backlog, so search has something to search.
 *
 * The hand-written fixtures in `data.ts` are the *recent* messages — the ones
 * chosen to exercise a particular rendering: a spoiler, a tombstone, an audio
 * file, a link card. Twenty-seven of them is plenty for looking at a room and
 * nowhere near enough for looking at search. A result list that can never hold
 * more than three rows does not test ranking, does not test scope widening,
 * does not test the date filter, and cannot be honestly called verified.
 *
 * So this walks backwards from each room's oldest hand-written message and
 * fills in a few weeks of plausible history behind it.
 *
 * ## Rules it follows
 *
 * - **Deterministic.** A fixed seed, so the same message is at the same place
 *   on every reload. A corpus that reshuffles is one nobody can review, and a
 *   search bug that only appears on some page loads is one nobody can fix.
 * - **Written per room.** Every room has its own vocabulary, because the point
 *   of the corpus is that widening a search from a room to the space to
 *   everything visibly changes what comes back. A shared pool of filler would
 *   make every scope return the same thing and prove nothing.
 * - **Deliberately overlapping.** A handful of terms — contrast, radii, epoch,
 *   recovery code — appear in more than one room on purpose, so widening the
 *   scope has something to find.
 * - **Clustered in time.** People talk in bursts and then go to bed. Messages
 *   arriving at a steady cadence would make every date range look identical.
 */
import type { Attachment, Message } from './data.js';

/**
 * mulberry32. Small, fast, and good enough for fixture data — the property
 * that matters here is that it is seeded and stable, not that it is uniform.
 */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MIN = 60_000;
const HOUR = 60 * MIN;

interface Voice {
  /** Who talks here. Drawn from the room's roster. */
  faces: string[];
  /** How many messages of history to lay down. */
  count: number;
  /** Typical gap inside a burst, in minutes. */
  beat: number;
  lines: string[];
}

/**
 * What each room sounds like.
 *
 * These are written rather than templated. A room's search results should read
 * like that room — "loss curve" belongs in #runs and nowhere else, and
 * "epoch" means something specific in #crypto-review that it doesn't mean in
 * #off-topic. Generated filler would flatten exactly the distinction search is
 * supposed to surface.
 */
const VOICES: Record<string, Voice> = {
  design: {
    faces: ['rae', 'emeri', 'june', 'viola', 'ash'],
    count: 64,
    beat: 4,
    lines: [
      'the radii are inconsistent again, the cards say 14 and the sheets say 20',
      'i keep coming back to the idea that a button should look like it can be pressed',
      'contrast on the mute variant is 3.1:1, which is under',
      'can we agree the pill radius is only for things that are actually pills',
      'the hover state is doing two things at once and neither reads',
      'shipped the ink twins so names stop failing on daylight',
      'i measured all eight against ground-0 and six of them fail as text',
      'the focus ring is drawing twice on the composer',
      'that is a shadow pretending to be a border',
      'the toy easing on the send button is the only overshoot in the product and it should stay that way',
      'off-white is not a colour, it is an apology',
      'why does the avatar sit a pixel high on the author line',
      'because the badge is centring on baseline and everything else is centring on the box',
      'fixed. one optical line, everything hangs off --line-h',
      'do we want bubbles in space rooms at all or is that a DM thing',
      'a busy DM wants rows though, so it cannot be decided by kind alone',
      'made it a per-room override with the kind as the default',
      'the density tokens are fighting the touch target floor',
      'compact should take padding out, never the ability to hit the thing',
      'the gradient on the space icon is doing the whole job of identity here',
      'i want the empty state to be a sentence, not an illustration',
      'nobody has ever been comforted by a cartoon inbox',
      'can the unread divider stop crawling upward while i am reading',
      'it is frozen at open now, so it stays where it was',
      'the jump-to-present pill is landing 50px left of where it starts',
      'translate and transform compose, that is the whole bug',
      'reactions are annotations, not buttons, and they should not look like buttons',
      'except on touch where they have to be 44 tall, which looks chunky and i have made peace with it',
      'the scrollbar is the last piece of OS chrome in the whole app',
      'the timestamp on grouped messages should be in the gutter not inline',
      'kerning on Fraunces at display sizes is doing something strange',
      'that is the soft optical axis, it is meant to do that',
      'i do not want a rounded geometric, that lane belongs to someone else',
      'the mint reads as success everywhere else so it cannot also mean voice',
      'reserved the aspect ratio before the bytes arrive so images stop shoving the room around',
      'spoilered images should be covered until asked for, not blurred',
      'blur is a promise you can undo with a screenshot',
      'the reply banner needs to square off the top of the composer',
      'it does now, border radius zero on the top two corners when replying',
      'the member list rows turned into white boxes on main',
      'that is a div promoted to a button without resetting the UA styling',
      'every icon should sit on the same 24 grid or two of them read at different sizes',
      'twenty of them did not, worst was the key at 1.75 units off',
      'measured the bounding box rather than eyeballing it, 56 of 57 land now',
      'play keeps half a unit because a right-pointing triangle centred by its box looks left-heavy',
      'the drawer should follow your thumb one to one or it is not a drawer',
      'axis lock in the first 10px so a vertical scroll still wins',
      'commit past halfway or on a flick, and the flick is what makes it feel right',
      'do not animate a theme change, you asked for it and it should already be true',
      'thirty two transition declarations all firing at once reads as lag',
      'the haze blobs are the only decoration and they bleed off the edge on purpose',
      'i will fight for the send button pressing down like an object',
      'calm personality strips the lift and the stars and keeps everything else',
      'that is the low distraction escape hatch, not a downgrade',
      'we should show what the server can see per room, generated from the real config',
      'a hardcoded reassurance that stops matching reality is worse than none',
      'the agent badge is a security statement and should never be customisable',
      'someone will ask for a custom label within a week of launch',
      'the answer is no and the reason is in docs eleven',
      'i like that the face colour is also the voice ring in a call',
      'plural systems get that for free, the tile shows the face not the account',
      'lightbox needs to not restart the video when you step to the next one',
      'the emoji picker tone strip should not steal horizontal drags from the drawer',
      'gave it touch-action auto and a data-no-swipe, done',
    ],
  },
  general: {
    faces: ['rae', 'emeri', 'june', 'viola', 'ash', 'kiko'],
    count: 52,
    beat: 9,
    lines: [
      'morning',
      'is anyone actually awake',
      'define awake',
      'standup in ten, or whenever, it is not that kind of standup',
      'i am going to be late, train is doing train things',
      'the deploy went out and nothing caught fire',
      'that is the first time i have typed that sentence',
      'who wants to write the release notes',
      'nobody, historically',
      'moved the roadmap doc, link is in the pinned message',
      'can someone look at the recovery code copy before it ships',
      'it is the highest stakes screen in the product and it reads like a form',
      'agreed, it should read like someone talking to you',
      'i keep forgetting we renamed the org',
      'the old name is still fossilised in three paths and a domain',
      'that is fine, paths are allowed to be historical',
      'weekly numbers are up but that is counts not content, we cannot see content',
      'which is the point, but it does make the dashboard boring',
      'boring dashboard, good product',
      'lunch',
      'someone has left a voice room open with nobody in it since tuesday',
      'that is a ghost participant and there is a beacon for exactly this',
      'the beacon only fires on pagehide, and the tab was killed',
      'so it is doing the right thing and the thing still happened',
      'welcome to distributed systems',
      'do we have a position on emoji in chrome',
      'yes: no. words are right there',
      'reactions and the picker are user content, those are fine',
      'i have been asked twice this week whether we sell the data',
      'we should answer that somewhere people will actually read it',
      'the about screen already says it, but nobody opens about',
      'put it in the sign-up flow then, one sentence',
      'the evaluation and training tracks are genuinely different and blurring them is how trust goes',
      'opt out of one, opt in to the other, and never move the line',
      'has anyone else had a device drop out of the list',
      'iOS unsubscribes silently after a restart, it is known',
      'and there is no background sync so nothing arrives until you open it',
      'we say so on the notifications screen now rather than shipping a dead toggle',
      'good',
      'someone put a 900mb video in a DM and my phone is unhappy',
      'the media cap is meant to stop exactly that',
      'it is capped, it just is not adjustable yet',
      'it is now',
      'old media evicts before old messages, which is the right order',
      'text is small and precious, images are large and re-fetchable',
      'i love that we wrote that down',
      'reminder that the search index never leaves the device',
      'the server is the search adversary, there is nothing to query server-side',
      'which is also why search has to say when it cannot see everything',
      'a search that quietly returns half the results teaches people the message does not exist',
      'going to be offline for a bit, messages will queue',
      'they will go out on their own, that is what the outbox is for',
    ],
  },
  'off-topic': {
    faces: ['rae', 'june', 'ash', 'emeri'],
    count: 44,
    beat: 6,
    lines: [
      'i have opinions about keyboard switches and nobody has asked',
      'ask received',
      'tactile, not clicky, i am not a monster',
      'the cat has learned to open the door and i am out of ideas',
      'get a rounder door handle',
      'that is a design solution and i respect it',
      'three in the morning is a legitimate working hour',
      'it is a legitimate hour, it is not a legitimate habit',
      'i made bread',
      'photograph or it did not happen',
      'it happened, it was flat, we are not discussing it',
      'what is everyone reading',
      'a paper about byte level models and a novel about a lighthouse',
      'those are the same amount of fog',
      'i genuinely cannot tell if this song is good or if i am just tired',
      'those are also the same thing',
      'has anyone found a decent monospace with a real italic',
      'the one we use has an italic, it is just shy',
      'my desk plant has entered a difficult phase',
      'water it less, they hate you for caring',
      'i have been thinking about how every chat app eventually becomes an email client',
      'that is the most depressing sentence in this room',
      'it is not wrong though',
      'the trick is to not add folders',
      'the moment you add folders it is over',
      'we are not adding folders',
      'someone said radii in a meeting and i felt seen',
      'the plural of radius is a hill i will die on',
      'radiuses is not a word',
      'it is in the dictionary',
      'the dictionary has given up',
      'is anyone else physically unable to name a variable badly',
      'yes and it costs me twenty minutes a day',
      'i have started naming things wrong on purpose to save time',
      'how is that going',
      'i renamed it back',
      'the weather has decided to be personal about it',
      'took a walk, it did not help, ten out of ten would walk again',
      'what does everyone call the thing at the top of the sidebar',
      'the header',
      'no it has a name, in kith it was the crown',
      'we are not calling it the crown',
      'i am calling it the crown',
      'good night, i am going to think about radii until i fall asleep',
    ],
  },
  'crypto-review': {
    faces: ['kiko', 'emeri', 'viola'],
    count: 38,
    beat: 45,
    lines: [
      'Read the threat model before posting. It is short and it is the whole argument.',
      'A revoked device must not be able to read the next epoch. That is the property everything else hangs off.',
      'Thirty tests hold that down, including the one where the revocation and the message race.',
      'Epoch advance on member change is the expensive part and there is no way around it.',
      'The cost is linear in group size and we should say so rather than implying it is free.',
      'Audiences are the crypto boundary. Permissions are policy the space enforces. They are not the same object.',
      'Which is why an audience is immutable once the room exists, and the UI says so rather than greying out silently.',
      'Every distinct audience is a separate key group with a real cost.',
      'So a small closed set of audience kinds, not an arbitrary predicate.',
      'The server sees who is in a room and when messages arrive. It does not see what they say.',
      'Metadata is the honest weak point and pretending otherwise is how people get hurt.',
      'A sealed sender helps with some of it and not with timing.',
      'Timing correlation is not solved by any deployed messenger and we should not claim it is.',
      'The recovery code is the only path back and there is no reset link. That is deliberate.',
      'A reset link is a server-held key with a friendlier name.',
      'Post-quantum: the hybrid handshake lands first, the ratchet after.',
      'Harvest now, decrypt later is the actual threat model, not a quantum computer next year.',
      'The key transparency log has to be checkable by the client or it is decoration.',
      'A key change mid-conversation is one of exactly three things worth interrupting someone for.',
      'The other two are something irreversible and being one dropped phone from losing the account.',
      'Anything more than that and the interruption budget is spent on noise.',
      'The link unfurl has to happen on the sender or the server learns every link anyone posts.',
      'Same for search. There is nothing to query server-side, by construction.',
      'Do not add a server-side index as a performance fix. That is the whole product, reversed.',
      'Diverged keys in a call must not read as a network glitch. It is a security event.',
      'The audio path uses a key from the room group so the server forwards packets it cannot decode.',
      'If someone can hear it they can keep it. No app fixes that and we should stop implying otherwise.',
      'The client_nonce dedup is what makes retry safe, which is what lets an outbox exist at all.',
      'The id is minted on the device, once. A resend can never become a duplicate.',
      'Device fingerprints need to be comparable out loud, so the grouping matters.',
      'Four groups of four, spoken in pairs. Tested it with three people on a phone call.',
      'The cryptography is not independently audited and the about screen says so.',
      'Parts of it are our own design, which is where bugs live.',
      'A web client can be replaced on any load and encryption does not fix that.',
      'Signed native builds are what would extend the guarantee to the code.',
      'Agents hold keys. An agent in a room is in the member list, every time, no exceptions.',
      'The moment there is a listener that is not in the list, the whole promise is gone.',
      'That rule is worth more than any feature we would gain by breaking it.',
    ],
  },
  'ci-noise': {
    faces: ['kiko'],
    count: 40,
    beat: 22,
    lines: [
      'build 4471 passed on main in 2m 14s',
      'build 4472 passed on main in 2m 09s',
      'build 4473 failed on main — typecheck, 1 error',
      'build 4474 passed on main in 2m 31s',
      'nightly: 175 backend tests, 0 failures',
      'nightly: 175 backend tests, 0 failures',
      'build 4475 passed on branch drawers in 2m 18s',
      'build 4476 failed on branch drawers — svelte-check, 2 warnings',
      'build 4477 passed on branch drawers in 2m 22s',
      'coverage held at 84.1%',
      'build 4478 passed on main in 2m 11s',
      'nightly: 175 backend tests, 0 failures',
      'build 4479 passed on branch back-stack in 2m 27s',
      'bundle: app chunk 336.9 kB, +1.2 kB',
      'build 4480 passed on main in 2m 08s',
      'build 4481 timed out after 10m — runner lost',
      'build 4481 retried and passed in 2m 15s',
      'nightly: 175 backend tests, 0 failures',
      'coverage held at 84.1%',
      'build 4482 passed on main in 2m 19s',
      'build 4483 passed on branch touch in 2m 24s',
      'build 4484 failed on branch touch — typecheck, 1 error',
      'build 4485 passed on branch touch in 2m 20s',
      'bundle: app chunk 338.4 kB, +1.5 kB',
      'build 4486 passed on main in 2m 12s',
      'nightly: 175 backend tests, 0 failures',
      'build 4487 passed on main in 2m 16s',
      'coverage rose to 84.4%',
      'build 4488 passed on branch scrollbars in 2m 09s',
      'build 4489 passed on main in 2m 13s',
      'nightly: 175 backend tests, 0 failures',
      'build 4490 passed on main in 2m 25s',
      'bundle: app chunk 339.1 kB, +0.7 kB',
      'build 4491 passed on main in 2m 10s',
      'build 4492 failed on main — flake in the drawer gesture test',
      'build 4492 retried and passed in 2m 17s',
      'nightly: 175 backend tests, 0 failures',
      'coverage held at 84.4%',
      'build 4493 passed on main in 2m 14s',
      'build 4494 passed on main in 2m 11s',
    ],
  },
  papers: {
    faces: ['viola', 'emeri', 'kiko'],
    count: 30,
    beat: 90,
    lines: [
      'バイトレベルのモデルはトークナイザを持たない',
      'a byte level model has no tokenizer, which is the entire point',
      'the vocabulary is the 256 byte values and nothing else',
      'attention runs on one sixteenth of the positions and the savings go into depth',
      'a causal U-Net over the sequence, not a transformer',
      'each pooled sequence is shifted one position so a coarse slot only summarises completed groups',
      'causal by construction rather than by masking',
      'the exact four byte suffix copy branch is doing more work than it looks',
      '8192 byte context, which is shorter than it sounds in tokens',
      'a matched dense transformer still reaches slightly lower loss at equal data',
      'the win is systems cost, not quality, and we should not let anyone say otherwise',
      'research preview, stated plainly on the model card',
      'the ablation set is on the cache disk if anyone wants to rerun it',
      'gated causal conv stem, then two downsamples of four',
      'sliding window attention at 256 bytes on the way back up',
      'the gated skips matter more than the depth does',
      'read a paper about scaling laws that assumed a tokenizer and then never mentioned it again',
      'that assumption is doing enormous unexamined work in that literature',
      'the 300m preset is about 295m parameters, the 100m is about 102m',
      'names are approximate and the readme says so',
      'someone asked why not just use a smaller vocabulary',
      'because the problem is the tokenizer existing, not its size',
      'multilingual behaviour is the interesting part, no vocabulary means no favouritism',
      '日本語のテキストでも語彙の偏りがない',
      'no vocabulary bias even on Japanese text, which is the cleanest demonstration',
      'the loss curve is not the product, the inference bill is',
      'training run finished overnight, numbers in #runs',
      'i want to try the same thing with a longer window before we claim anything',
      'agreed, and we should publish the negative result either way',
      'a preview that only shows the wins is marketing wearing a lab coat',
    ],
  },
  runs: {
    faces: ['viola', 'emeri'],
    count: 34,
    beat: 40,
    lines: [
      'run 41 diverged at step 12k, restarting with a lower warmup',
      'loss curve looks sane for the first time this week',
      'run 42 at 2.41 after 30k steps',
      'run 43 is flat, something is wrong with the data loader',
      'found it, the shuffle buffer was smaller than the batch',
      'run 44 at 2.33, which is the best so far',
      'the loss curve has a kink at exactly the point the schedule changes, which is reassuring',
      'run 45 OOMed on the 3090, moving to the studio',
      'run 45 restarted on 512gb, batch doubled',
      'run 45 at 2.29 and still going down',
      'run 46 is the ablation with the skips removed',
      'run 46 is worse by 0.06, so the skips are earning their place',
      'run 47 removes the suffix copy branch instead',
      'run 47 is worse by 0.11, which is more than i expected',
      'that branch is doing real work, not just cosmetics',
      'run 48 at 2.27, new best',
      'plotted 44 through 48 on one axis, the ordering is stable',
      'run 49 diverged, and it diverged the same way 41 did',
      'same warmup, so that is at least consistent',
      'run 50 with the fixed warmup, 2.26',
      'checkpoint pushed, weights are on the hub',
      'the matched dense baseline is at 2.21 on the same data',
      'so the quality gap is real and small and we say so',
      'throughput is the number that actually moved: 2.4x at equal loss',
      'that is the claim, and it is a systems claim',
      'run 51 is a long context experiment, 16k bytes',
      'run 51 is slower per step and better per byte, which is the expected shape',
      'run 52 at 16k reaches 2.24, beating the 8k best',
      'so context is worth more than depth here, at least at this size',
      'want to rerun 46 at 16k before we conclude anything',
      'queued as run 53',
      'run 53 confirms it, skips still matter at longer context',
      'writing this up before i forget which run was which',
      'the ablation table is in the repo now',
    ],
  },
  'dm-acct-r~acct-v': {
    faces: ['rae', 'viola'],
    count: 30,
    beat: 5,
    lines: [
      'are you around',
      'sort of, in the way where i am looking at a build log',
      'i redrew the empty states, they are much less sorry for themselves now',
      'good, they read like an apology before',
      'do you actually like the mint or are you being polite',
      'i like the mint, i do not like the mint as a voice colour',
      'that is a fair distinction and i will move it',
      'the contrast thing kiko posted is going to cost us a day',
      'it is going to cost us a day and be right',
      'those are the worst kind',
      'i have a version of the composer where the send button is on the left',
      'why',
      'i wanted to see if it was worse',
      'and',
      'it is worse',
      'science',
      'do you want to argue about radii in person or over a call',
      'in person, i want to draw on something',
      'the drawing is always the part that wins the argument',
      'that is because you cannot interrupt a drawing',
      'i am going to remember that',
      'how is the phone layout going',
      'it turns out we had seven media queries and none of them under 700 pixels',
      'so not going, then',
      'it is going now. one column and two drawers',
      'does the drawer follow your thumb',
      'one to one, and it axis locks so scrolling still wins',
      'that is the only version worth building',
      'i know, that is why it took all afternoon',
      'worth it. send me a build',
    ],
  },
  'dm-acct-e~acct-v': {
    faces: ['emeri', 'viola'],
    count: 22,
    beat: 30,
    lines: [
      'do you have five minutes about the audience picker',
      'yes, is it the immutability thing',
      'it is the immutability thing',
      'people are going to try to change it and we have to explain why they cannot',
      'the explanation is one sentence: it is the encryption boundary, not a setting',
      'that sentence is correct and nobody will read it',
      'then the UI has to be the explanation, not the tooltip',
      'so show what changing it would actually mean, in the same screen',
      'a new room, effectively, with the history staying where it was',
      'that is honest and it is also a lot of words',
      'fewer words than a migration',
      'train is cancelled so tonight is off from my end',
      'no problem, i will write up the roles thing instead',
      'do you want me to review the threat model changes',
      'yes please, particularly the bit about metadata',
      'the metadata paragraph is the one i keep rewriting',
      'because it is the one that is actually a limitation',
      'right, and every draft either oversells or sounds defeated',
      'aim for neither, just say what is true and move on',
      'that is the whole house style really',
      'it is, and it is harder than it sounds',
      'everything worth writing is',
    ],
  },
  'dm-group-shapes': {
    faces: ['rae', 'emeri', 'viola'],
    count: 24,
    beat: 12,
    lines: [
      'making this so we stop derailing design',
      'we will absolutely still derail design',
      'correct, but now there is a place to do it on purpose',
      'the corner radius scale has five stops and we use three',
      'delete two of them',
      'i cannot delete xs, it is holding up the badges',
      'then delete lg',
      'lg is the sheets',
      'so the scale is fine and we are just complaining',
      'that is what this room is for',
      'has anyone got a good name for the space header',
      'rae wants to call it the crown',
      'i am going to keep calling it the crown until it sticks',
      'this is how vocabulary happens and i hate that it works',
      'unrelated: the profile card is 300 wide and it should be 320',
      'why 320',
      'because 300 makes the pronouns wrap on the longest one',
      'that is a real reason, changing it',
      'the avatar dot for status needs a ring in the room list and not in the card',
      'because the card has a background and the list does not',
      'yes. it is a separation problem not a decoration',
      'i want to put the note under the name in both places though',
      'agreed, one shape for a person everywhere',
      'that is the rule we keep almost writing down',
    ],
  },
};

/** A small pool of files, so "has a file" filters to something real. */
const FILES: Attachment[] = [
  {
    id: 'h-att-1',
    kind: 'image',
    name: 'radii-audit.png',
    size: 141_204,
    url: '/mock/shot-wide.png',
    w: 1280,
    h: 800,
    alt: 'Every corner radius in the app, measured',
  },
  {
    id: 'h-att-2',
    kind: 'image',
    name: 'contrast-pass.png',
    size: 98_331,
    url: '/mock/shot-tall.png',
    w: 900,
    h: 1200,
    alt: 'Ink twins measured against the light ground',
  },
  { id: 'h-att-3', kind: 'file', name: 'threat-model.md', size: 21_880, url: '#' },
  { id: 'h-att-4', kind: 'file', name: 'ablation-table.csv', size: 7_412, url: '#' },
  {
    id: 'h-att-5',
    kind: 'gif',
    name: 'drawer.gif',
    size: 402_119,
    url: '/mock/loop.gif',
    w: 240,
    h: 180,
    alt: 'A drawer tracking a thumb',
  },
];

/** The visual half of the pool, for messages that post several at once. */
const PICTURES: Attachment[] = FILES.filter((a) => a.kind !== 'file');

/**
 * Prepend generated history to each room.
 *
 * Walks backwards from the room's oldest hand-written message, so the curated
 * recent messages stay exactly where they were and keep being the ones you see
 * on open. Rooms with no voice defined are left alone — an empty room is a
 * real state and some of them are empty on purpose.
 */
export function withHistory(base: Record<string, Message[]>): Record<string, Message[]> {
  const out: Record<string, Message[]> = {};

  for (const [roomId, curated] of Object.entries(base)) {
    const voice = VOICES[roomId];
    if (!voice) {
      out[roomId] = curated;
      continue;
    }

    // One stream per room, seeded from the room id, so editing one room's
    // lines cannot shuffle another room's history.
    const rand = rng([...roomId].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);

    const oldest = curated.length ? Math.min(...curated.map((m) => m.at)) : Date.now() - 30 * MIN;
    let at = oldest - (5 + rand() * 40) * MIN;

    const history: Message[] = [];
    for (let i = 0; i < voice.count; i++) {
      const line =
        voice.lines[(voice.lines.length - 1 - i + voice.lines.length * 4) % voice.lines.length]!;
      const face = voice.faces[Math.floor(rand() * voice.faces.length)]!;

      const m: Message = {
        id: `h-${roomId}-${i}`,
        faceId: face,
        body: line,
        at: Math.round(at),
      };

      // Roughly one in nine carries a file, which is enough for the "has a
      // file" filter to be worth having and few enough that the room still
      // reads as a conversation.
      if (rand() < 0.11) {
        // Usually one thing. Sometimes a handful of pictures at once, because
        // the two-column grid is a layout this app has, and a corpus that
        // never produces one is a corpus that never shows it to us.
        const many = rand() < 0.28;
        const pool = many ? PICTURES : FILES;
        const take = many ? 2 + Math.floor(rand() * 2) : 1;
        const left = [...pool];
        m.attachments = Array.from({ length: Math.min(take, left.length) }, (_, k) => ({
          // Drawn without replacement: the same screenshot twice in one grid
          // reads as a bug in the app rather than a quirk of the fixtures.
          ...left.splice(Math.floor(rand() * left.length), 1)[0]!,
          id: `h-att-${roomId}-${i}-${k}`,
        }));
      }
      if (rand() < 0.09) m.reactions = [{ key: rand() < 0.5 ? '🔥' : '👀', by: [voice.faces[0]!] }];

      history.push(m);

      // Bursts, then gaps. Three tiers, because a flat cadence would make every
      // date range look identical and prove nothing about the filter: most
      // messages follow within a beat or two, sometimes the conversation stops
      // for the night, and every so often the room goes quiet for days. That
      // last tier is what stretches the corpus across enough weeks for
      // "before last month" to mean something.
      const roll = rand();
      const gap =
        roll < 0.07
          ? (1 + rand() * 4) * 24 * HOUR
          : roll < 0.24
            ? (6 + rand() * 16) * HOUR
            : (0.4 + rand() * 2.2) * voice.beat * MIN;
      at -= gap;
    }

    // Generated oldest-first, in front of the curated recent ones.
    out[roomId] = [...history.reverse(), ...curated];
  }

  return out;
}
