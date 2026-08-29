/**
 * The browser half of the Phase 0 measurements.
 *
 * Mirrors `crates/revel-crypto/examples/bench.rs` call for call, so the two
 * tables can be read side by side. Where it deviates it says so — the useful
 * output is a comparison, and a benchmark that quietly measures something else
 * is worse than no benchmark.
 */
import init, { Account, Device } from '/packages/crypto-wasm/revel_crypto.js';

const $ = (id) => document.getElementById(id);
const out = $('out');
const errBox = $('error');

/**
 * Let the browser paint between rows, so a long run is watchable.
 *
 * Raced against a timer rather than trusting `requestAnimationFrame` alone: a
 * tab that isn't painting never fires one. A backgrounded tab is the everyday
 * case, and a headless one is how this gets driven from a script — in both, an
 * unraced rAF stalls the whole run on the first row, which looks exactly like
 * the crypto having hung.
 */
const yieldToPaint = () =>
  new Promise((resolve) => {
    let done = false;
    const once = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => setTimeout(once, 0));
    setTimeout(once, 50);
  });

const enc = new TextEncoder();
const LINE = enc.encode('the buttons need to feel pressable');

/**
 * How many messages the symmetric measurements average over.
 *
 * The native bench uses 50. That is far too few here: at ~50 µs an operation,
 * 50 of them is 2.5 ms of work timed with a clock the browser deliberately
 * blunts, on a machine also running a dev server and a browser. Fifty gave
 * readings between 40 µs and 420 µs for the same operation. Two thousand is
 * ~100 ms of work per measurement, which is long enough to mean something.
 */
const SAMPLES = 2000;

/** Same group id shape a room would use: 16 random bytes. */
function groupId() {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Download + compile + instantiate, measured separately from any crypto.
 *
 * This is the cost that lands before anyone can read a single message, and it
 * is the one number a native benchmark cannot have.
 */
async function boot() {
  const t0 = performance.now();
  const res = await fetch('/packages/crypto-wasm/revel_crypto_bg.wasm');
  const buf = await res.arrayBuffer();
  const fetched = performance.now() - t0;

  const t1 = performance.now();
  await init({ module_or_path: buf });
  const instantiated = performance.now() - t1;

  return { bytes: buf.byteLength, fetched, instantiated };
}

/** How long to run untimed before measuring anything. See `warmup`. */
const WARMUP_MS = 3000;

/**
 * Run every operation, untimed, for a few seconds, and throw the results away.
 *
 * Without this the table measures the JIT rather than the crypto, and it does
 * so in a way that looks like a real result. `encrypt` first came out at 418 µs
 * for a 2-leaf group and 160 µs for a 500-leaf one — "encryption gets cheaper
 * as the group grows", an inversion no cryptographic story explains. A warmup
 * of a fixed *number* of operations only moved the cliff: the 2,000-leaf row
 * then read 40 µs while the 500-leaf row above it read 372 µs.
 *
 * The cause is tiering. V8 compiles wasm twice — Liftoff immediately so the
 * module can run at all, then TurboFan in the background — and the swap happens
 * on a wall clock, not a call count. So the warmup is measured in **seconds**,
 * not iterations, and it exercises both the symmetric path (encrypt/decrypt)
 * and the asymmetric one (commits), because they tier up independently.
 *
 * Same class of mistake as `docs/31` §2, which is why it is written down here
 * rather than quietly fixed.
 */
function warmup() {
  const account = new Account();
  const creator = new Device(account, 'creator');
  const group = creator.createGroup(groupId());
  const members = [];
  for (let i = 0; i < 25; i++) {
    const d = new Device(account, `w${i}`);
    members.push(d);
    group.stageAdd(d.keyPackage());
  }
  const first = group.commit();
  group.applyPending();

  const theirs = members[0].joinGroup(first.welcome);
  const spares = [];

  const until = performance.now() + WARMUP_MS;
  while (performance.now() < until) {
    for (let i = 0; i < 200; i++) theirs.process(group.encrypt(LINE));

    // Add somebody, let them join, then remove them again — so the group
    // churns without growing, and both commit paths get exercised.
    const joiner = new Device(account, 'w-joiner');
    spares.push(joiner);
    group.stageAdd(joiner.keyPackage());
    const added = group.commit();
    group.applyPending();
    joiner.joinGroup(added.welcome).free();

    group.stageRemove(group.size - 1);
    const removed = group.commit();
    group.applyPending();

    // `theirs` has to walk the same epochs or the next round trip fails with
    // "Epoch not found" — which is MLS working. A reader that skipped a commit
    // genuinely cannot read what comes after it.
    theirs.process(added.commit);
    theirs.process(removed.commit);
  }

  theirs.free();
  for (const d of spares) d.free();
  for (const d of members) d.free();
  creator.free();
  group.free();
  account.free();
}

/** One row of the table: a group grown to `n` leaves, then measured. */
async function measure(n, wantJoin) {
  const account = new Account();
  const creator = new Device(account, 'creator');
  const group = creator.createGroup(groupId());

  // Devices and their key packages are built outside the timer, exactly as the
  // native bench does — they are the cost of *being* n devices, not the cost of
  // the commit that admits them.
  const members = [];
  const kps = [];
  for (let i = 1; i < n; i++) {
    const d = new Device(account, `d${i}`);
    members.push(d);
    kps.push(d.keyPackage());
  }

  // Build: one batched commit admitting everyone. `docs/03` §5 specifies
  // batching for mass membership changes; this is what that costs.
  const tBuild = performance.now();
  for (const kp of kps) group.stageAdd(kp);
  const first = group.commit();
  group.applyPending();
  const build = performance.now() - tBuild;

  const welcome = first.welcome ? first.welcome.length : 0;

  // A round trip, which the native bench doesn't measure but which is what a
  // person actually waits for: encrypt here, decrypt there.
  //
  //
  // It has to happen *now*, before the add and remove below. Both of those
  // move the group forward an epoch, and a device that joined at this one
  // cannot read a message sealed at a later one — that is MLS working, not a
  // failure, but it makes for a decrypt measurement that can never succeed.
  //
  // Averaged over 50 messages for the same reason `encrypt` is: browsers clamp
  // `performance.now()`, so a single sub-millisecond operation comes back
  // quantised — the first version of this reported 200/500/500/600 µs across
  // four group sizes, which is the clock's resolution wearing a result's
  // clothing.
  let decrypt = null;
  const other = members[0];
  if (other) {
    const theirs = other.joinGroup(first.welcome);
    const sealed = [];
    for (let i = 0; i < SAMPLES; i++) sealed.push(group.encrypt(LINE));
    const tDec = performance.now();
    for (const s of sealed) theirs.process(s);
    decrypt = ((performance.now() - tDec) * 1000) / SAMPLES;
    theirs.free();
  }

  // One further add at size — the steady-state cost of somebody joining.
  const joiner = new Device(account, 'joiner');
  const joinerKp = joiner.keyPackage();
  const tAdd = performance.now();
  group.stageAdd(joinerKp);
  const addOut = group.commit();
  group.applyPending();
  const add = performance.now() - tAdd;

  // What it costs the joiner to open the app for the first time. Optional
  // because at 500+ leaves it is the slowest thing on the page by a distance.
  let join = null;
  if (wantJoin && addOut.welcome) {
    const tJoin = performance.now();
    const joined = joiner.joinGroup(addOut.welcome);
    join = performance.now() - tJoin;
    joined.free();
  }

  // One remove — "sign out this device", a kick, and a ban all cost this.
  const victim = group.size - 1;
  const tRm = performance.now();
  group.stageRemove(victim);
  group.commit();
  group.applyPending();
  const remove = performance.now() - tRm;

  // Sending shouldn't care about group size — it is symmetric crypto over a key
  // the epoch already derived. Confirm it doesn't.
  const tEnc = performance.now();
  for (let i = 0; i < SAMPLES; i++) group.encrypt(LINE);
  const encrypt = ((performance.now() - tEnc) * 1000) / SAMPLES;

  const row = { leaves: group.size, build, add, welcome, remove, encrypt, decrypt, join };

  // wasm-bindgen handles are not garbage: each one owns memory on the Rust
  // side until something says so. At 500 leaves that is 500 MLS clients, and a
  // run that walks 2 → 50 → 500 in one page keeps every earlier one alive.
  for (const d of members) d.free();
  joiner.free();
  creator.free();
  group.free();
  account.free();

  return row;
}

const fmt = {
  ms: (v) => (v === null ? '—' : v < 10 ? v.toFixed(1) : v.toFixed(0)),
  us: (v) => (v === null ? '—' : v.toFixed(0)),
  kib: (v) => (v / 1024).toFixed(1),
  kb: (v) => (v / 1000).toFixed(0),
};

function table(rows, wantJoin) {
  const cols = [
    ['leaves', (r) => r.leaves],
    ['build', (r) => `${fmt.ms(r.build)} ms`],
    ['1 add', (r) => `${fmt.ms(r.add)} ms`],
    ['welcome', (r) => `${fmt.kib(r.welcome)} KiB`],
    ['1 remove', (r) => `${fmt.ms(r.remove)} ms`],
    ['encrypt', (r) => `${fmt.us(r.encrypt)} µs`],
    ['decrypt', (r) => `${fmt.us(r.decrypt)} µs`],
    ...(wantJoin ? [['join', (r) => `${fmt.ms(r.join)} ms`]] : []),
  ];
  const head = cols.map(([h]) => `<th>${h}</th>`).join('');
  const body = rows
    .map((r) =>
      r.pending
        ? `<tr class="running"><td>${r.leaves}</td><td colspan="${cols.length - 1}">running…</td></tr>`
        : `<tr>${cols.map(([, f]) => `<td>${f(r)}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table><caption>Group scaling, in this browser</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function run() {
  $('run').disabled = true;
  errBox.textContent = '';
  out.innerHTML = '<p>booting…</p>';

  try {
    const b = await boot();
    const wantJoin = $('join').checked;
    const sizes = $('sizes')
      .value.split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n >= 2);

    const bootTable =
      `<table><caption>Boot</caption><tbody>` +
      `<tr><td>wasm, uncompressed</td><td>${fmt.kb(b.bytes)} kB</td></tr>` +
      `<tr><td>fetch</td><td>${fmt.ms(b.fetched)} ms</td></tr>` +
      `<tr><td>compile + instantiate</td><td>${fmt.ms(b.instantiated)} ms</td></tr>` +
      `</tbody></table>`;

    // Untimed, and before anything that lands in the table.
    out.innerHTML = `<p>warming up for ${WARMUP_MS / 1000}s…</p>`;
    await yieldToPaint();
    warmup();

    const rows = [];
    for (const n of sizes) {
      rows.push({ leaves: n, pending: true });
      out.innerHTML = bootTable + table(rows, wantJoin);
      await yieldToPaint();
      rows[rows.length - 1] = await measure(n, wantJoin);
      out.innerHTML = bootTable + table(rows, wantJoin);
      await yieldToPaint();
    }

    // Machine-readable, for pasting into docs/31 without retyping numbers.
    window.__bench = { boot: b, rows };
    console.table(rows);
  } catch (e) {
    errBox.textContent = `${e}\n${e?.stack ?? ''}`;
  } finally {
    $('run').disabled = false;
  }
}

$('run').addEventListener('click', run);
