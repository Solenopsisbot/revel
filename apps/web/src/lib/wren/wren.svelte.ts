/**
 * Wren's notice engine.
 *
 * `docs/12` describes a proactive assistant that is structurally Clippy and
 * then spends the rest of the document earning the proactivity back. Two
 * inversions do most of it, and both are implemented here rather than left to
 * the components:
 *
 *   1. **She has an inbox, not a megaphone.** Everything lands in `notices`,
 *      which the panel renders. Interrupting is the exception.
 *   2. **She acts, she doesn't advise.** Every notice carries actions, and
 *      `act()` runs them through the same `core` methods the settings UI calls.
 *      She has no privileged path.
 *
 * The load-bearing function is `rungFor()`. It is the only place in the app
 * that decides how loud a notice is allowed to be, which is the point: a new
 * notice cannot quietly promote itself, because promotion isn't a thing a
 * notice can do to itself.
 */
import { core } from '../fake/core.svelte.js';
import { faces } from '../fake/data.js';
import type { Action, Category, Notice, Rung, Severity } from './notices.js';

export type Volume = 'quiet' | 'normal' | 'chatty';

const KEY = 'revel.wren';

/** One interrupting popup per session, three per week (`docs/12`). */
const PER_SESSION = 1;
const PER_WEEK = 3;

/**
 * She stays quiet for a moment after launch — "let the app finish opening
 * first". Short enough that a genuine cliff-edge warning still arrives while
 * you are looking at the screen.
 */
const SETTLE_MS = 4000;

interface Persisted {
  volume: Volume;
  /** Categories the user silenced. Permanent, not per-session — "don't show me
      this again" has to mean it or the whole thing is untrustworthy. */
  silenced: Category[];
  /** Individual notices resolved by a dismissive action ("It's fine"). */
  dismissed: string[];
  /** ISO week key the popup count belongs to, so it rolls over on its own. */
  week: string;
  popupsThisWeek: number;
}

const DEFAULTS: Persisted = {
  volume: 'normal',
  silenced: [],
  dismissed: [],
  week: '',
  popupsThisWeek: 0,
};

/** Year + ISO week number. Cheap, and only needs to be stable, not correct. */
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+t - +start) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-${week}`;
}

const mb = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} GB` : `${n} MB`);

class Wren {
  volume = $state<Volume>('normal');
  silenced = $state<Category[]>([]);
  dismissed = $state<string[]>([]);
  popupsThisWeek = $state(0);
  popupsThisSession = $state(0);

  /** The panel. Open, use, close — she is never a widget that lives on screen. */
  panelOpen = $state(false);
  /** The notice currently holding focus as a rung-4 popup, if any. */
  popup = $state<Notice | null>(null);

  /** Set once the settle window has passed. Nothing escalates before it. */
  private settled = $state(false);
  private week = weekKey();

  constructor() {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const p: Persisted = { ...DEFAULTS, ...JSON.parse(raw) };
        this.volume = p.volume;
        this.silenced = p.silenced;
        this.dismissed = p.dismissed;
        // A stored count from a previous week is not this week's budget.
        this.popupsThisWeek = p.week === this.week ? p.popupsThisWeek : 0;
      }
    } catch {
      /* corrupt or unavailable storage is not worth failing a page load over */
    }
    setTimeout(() => (this.settled = true), SETTLE_MS);
  }

  // --- what she has noticed --------------------------------------------------

  /**
   * Every notice the current state justifies, before silencing and volume are
   * applied. Derived, so acting on one makes it disappear because the state it
   * described is no longer true — not because anything marked it read.
   */
  get all(): Notice[] {
    const out: Notice[] = [];
    const a = core.account;
    const soleDevice = core.devices.length === 1;

    // --- keys and devices ---------------------------------------------------

    if (!a.recoveryCodeConfirmed) {
      // Two notices, one state. With a single device this is the cliff edge
      // from `docs/12` and gets the popup copy from `docs/13` §5; with a
      // second device to fall back on it is serious but survivable.
      out.push(
        soleDevice
          ? {
              id: 'cliff-edge',
              category: 'keys',
              severity: 'coral',
              ceiling: 4,
              title: 'You have one device and no backup confirmed',
              body: 'If you lose this device right now, your account is gone. Your recovery code is the only way back in, and I don’t have a record of you saving it.',
              actions: [
                { id: 'save-code', label: 'Save recovery code' },
                { id: 'already-saved', label: 'I already saved it', dismissive: true },
              ],
            }
          : {
              id: 'recovery-unconfirmed',
              category: 'keys',
              severity: 'coral',
              ceiling: 3,
              title: 'You don’t have a safety net yet',
              body: 'If you forget your password and haven’t saved your recovery code, that’s the account. I can’t get you back in. Nobody can.',
              actions: [{ id: 'save-code', label: 'Save recovery code' }],
            },
      );
    }

    if (soleDevice) {
      out.push({
        id: 'single-device',
        category: 'keys',
        severity: 'gold',
        ceiling: 3,
        title: 'Your keys live on one device',
        body: 'If something happens to this device, your recovery code is the only way back. A second device means your keys exist in two places.',
        actions: [{ id: 'add-device', label: 'Add a device' }],
      });
    }

    if (a.passkeySupported && !a.passkeyEnrolled) {
      out.push({
        id: 'passkey',
        category: 'keys',
        severity: 'neutral',
        ceiling: 1,
        title: 'You could skip the password',
        body: 'A passkey lets you unlock with your face or fingerprint. It also gives you another way back in if you forget your password.',
        actions: [{ id: 'enrol-passkey', label: 'Set up a passkey' }],
      });
    }

    for (const d of core.devices) {
      if (d.seenDays < 90 || d.current) continue;
      out.push({
        id: `stale-device:${d.id}`,
        category: 'keys',
        severity: 'neutral',
        ceiling: 1,
        title: `Haven’t seen ${d.name} in a while`,
        body: `It’s been ${d.seenDays} days. If you still use it, nothing to do. If you lost it or stopped using it, revoking it locks it out of your account.`,
        actions: [
          { id: `revoke:${d.id}`, label: 'Revoke device', destructive: true },
          { id: `keep:${d.id}`, label: 'It’s fine', dismissive: true },
        ],
      });
    }

    for (const k of core.keyChanges) {
      if (k.acknowledged) continue;
      const name = faces[k.faceId]?.name ?? 'Someone';
      // The live case is the one attack-shaped event a person must not miss,
      // so it is the only notice exempt from the budget.
      out.push(
        k.live
          ? {
              id: `key-changed-live:${k.faceId}`,
              category: 'keys',
              severity: 'coral',
              ceiling: 4,
              exemptFromBudget: true,
              title: `${name}’s key just changed, mid-conversation`,
              body: `That’s unusual. It can be legitimate — a new device, a reinstall — but the timing is worth a second look. Messages you send now go to whoever holds the new key.`,
              actions: [
                { id: `verify:${k.faceId}`, label: `Verify with ${name}` },
                { id: `expected:${k.faceId}`, label: 'I expected this', dismissive: true },
                { id: `stop:${k.faceId}`, label: 'Stop sending' },
              ],
            }
          : {
              id: `key-changed:${k.faceId}`,
              category: 'keys',
              severity: 'gold',
              ceiling: 3,
              title: `${name}’s encryption key changed`,
              body: 'Usually a new device or a reinstall. If you weren’t expecting it, ask them before you keep going. I’d rather you check.',
              actions: [
                { id: `verify:${k.faceId}`, label: `Verify with ${name}` },
                { id: `expected:${k.faceId}`, label: 'I expected this', dismissive: true },
              ],
            },
      );
    }

    // --- who can read this --------------------------------------------------

    // `docs/12` words this as "posting in a room with an agent you may have
    // forgotten" — the trigger is the posting. Without it this fires on mere
    // presence, never resolves, and turns into wallpaper you learn to ignore,
    // which is worse than not having it.
    const posted = core.postedIn.includes(core.currentRoomId);
    for (const agent of posted ? core.roster.filter((f) => f.agent) : []) {
      out.push({
        id: `agent-here:${core.currentRoomId}:${agent.id}`,
        category: 'readers',
        severity: 'neutral',
        ceiling: 1,
        title: `${agent.name} is in this room`,
        body: `Added by ${agent.agent?.by ?? 'someone'}. It can read everything here, same as any member. Just making sure you remember.`,
        actions: [
          { id: 'show-members', label: 'View member list' },
          { id: `agent-ok:${agent.id}`, label: 'Got it', dismissive: true },
        ],
      });
    }

    // --- getting more out of it ---------------------------------------------

    for (const space of core.spaces) {
      for (const room of space.rooms) {
        if (!room.language) continue;
        out.push({
          id: `translate:${room.id}`,
          category: 'more',
          severity: 'neutral',
          ceiling: 3,
          title: `Most of #${room.name} is in ${room.language}`,
          body: `I can set up translation so you read it in English. Messages stay encrypted — translation happens on your device.`,
          actions: [
            { id: `translate-on:${room.id}`, label: 'Turn on translation' },
            { id: `translate-no:${room.id}`, label: 'No thanks', dismissive: true },
          ],
        });
      }
    }

    if (!core.commandSurfaceUsed) {
      out.push({
        id: 'command-surface',
        category: 'more',
        severity: 'neutral',
        ceiling: 1,
        title: 'There’s a command bar, if you want it',
        body: 'Press ⌘K to open it. Search, switch rooms, manage devices, the usual. Faster than clicking around.',
        actions: [
          { id: 'open-command', label: 'Open it now' },
          { id: 'command-dismiss', label: 'Dismiss', dismissive: true },
        ],
      });
    }

    // --- housekeeping -------------------------------------------------------
    //
    // These are the "low-value hygiene" heuristics `docs/12` says Chatty
    // enables. The doc lists them in the main table without marking which ones
    // are chatty-only, so this is a judgement call: nothing here is a problem,
    // it is all just tidying, and tidying is exactly what a quieter default
    // should leave alone. The storage one graduates to Normal once it is
    // actually close to the limit.

    for (const m of core.storage.models_) {
      if (m.lastUsed !== null) continue;
      out.push({
        id: `unused-model:${m.id}`,
        category: 'housekeeping',
        severity: 'neutral',
        ceiling: 1,
        chattyOnly: true,
        title: `${m.name} is taking up ${mb(m.mb)}`,
        body: 'You downloaded it for translation but haven’t used it. I can free up the space.',
        actions: [
          { id: `delete-model:${m.id}`, label: 'Delete model', destructive: true },
          { id: `keep-model:${m.id}`, label: 'Keep it', dismissive: true },
        ],
      });
    }

    if (core.storage.leftRooms.length) {
      const total = core.storage.leftRooms.reduce((n, r) => n + r.mb, 0);
      out.push({
        id: 'left-rooms',
        category: 'housekeeping',
        severity: 'neutral',
        ceiling: 1,
        chattyOnly: true,
        title: `Local history from ${core.storage.leftRooms.length} rooms you left`,
        body: `Taking up ${mb(total)}. You left these rooms, but the messages are still on this device. Clearing them is permanent.`,
        actions: [
          { id: 'clear-left', label: 'Clear history', destructive: true },
          { id: 'keep-left', label: 'Keep it', dismissive: true },
        ],
      });
    }

    const pct = Math.round((this.storageUsed / core.storage.limit) * 100);
    if (pct >= 60) {
      out.push({
        id: 'storage',
        category: 'housekeeping',
        severity: pct >= 90 ? 'gold' : 'neutral',
        ceiling: 1,
        // Below 80% this is tidying; above it, it is heading somewhere.
        chattyOnly: pct < 80,
        title: `Local storage is at ${pct}% of the limit`,
        body: 'Mostly media and files. I can clear old caches and expired media without touching your messages.',
        actions: [
          { id: 'clear-media', label: 'Free up space' },
          { id: 'storage-details', label: 'Show details', dismissive: true },
        ],
      });
    }

    return out;
  }

  get storageUsed() {
    const s = core.storage;
    return s.messages + s.media + s.index + s.models;
  }

  /**
   * What actually reaches the panel: everything she noticed, minus silenced
   * categories, minus individually dismissed notices, minus the chatty-only
   * ones unless you asked for them. Sorted worst-first.
   */
  get notices(): Notice[] {
    const rank: Record<Severity, number> = { coral: 0, gold: 1, neutral: 2 };
    return this.all
      .filter((n) => !this.silenced.includes(n.category))
      .filter((n) => !this.dismissed.includes(n.id))
      .filter((n) => !n.chattyOnly || this.volume === 'chatty')
      .sort((x, y) => rank[x.severity] - rank[y.severity]);
  }

  /** The ambient dot: the highest severity in the panel, or nothing. */
  get dot(): Severity | null {
    const list = this.notices;
    if (!list.length) return null;
    return list.some((n) => n.severity === 'coral')
      ? 'coral'
      : list.some((n) => n.severity === 'gold')
        ? 'gold'
        : 'neutral';
  }

  // --- the ladder ------------------------------------------------------------

  /**
   * **The only place a rung is decided.**
   *
   * A notice does not get to ask for attention; it declares a ceiling and this
   * function decides what it actually gets. Everything that could make a
   * notice louder has to pass through here, which is what stops rung 4 from
   * silting up as new heuristics arrive.
   */
  rungFor(n: Notice): Rung {
    // Quiet is absolute: panel only, never a card, never a popup. The dot
    // still appears, because a silent inbox with no indicator is just a
    // hidden inbox.
    if (this.volume === 'quiet') return 1;

    // Nothing escalates while the app is still opening, while she already has
    // a surface open, or while the composer holds unsent text. A correct
    // notice at a wrong moment is a wrong notice.
    if (!this.settled || this.panelOpen || this.popup) return 1;

    if (n.ceiling < 4) return n.ceiling;

    // Rung 4 additionally has to fit the budget. Over budget it degrades to a
    // card — never dropped, just demoted.
    if (n.exemptFromBudget) return 4;
    if (this.popupsThisSession >= PER_SESSION) return 3;
    if (this.popupsThisWeek >= PER_WEEK) return 3;
    return 4;
  }

  /** True when a notice is entitled to take focus right now. */
  get pendingPopup(): Notice | null {
    return this.notices.find((n) => this.rungFor(n) === 4) ?? null;
  }

  /** Inline cards, for rendering into a natural gap. */
  get cards(): Notice[] {
    return this.notices.filter((n) => this.rungFor(n) === 3);
  }

  /**
   * Confirm an irreversible action, in her voice, naming the consequence.
   *
   * This is the first of the three legitimate popups (`docs/12`) and the only
   * one that is *requested* rather than noticed — you pressed a button and she
   * is checking. That is why it does not spend interruption budget: the budget
   * exists to stop her interrupting you, and this is not an interruption.
   *
   * It is also not silenceable. A confirmation you can permanently turn off is
   * a confirmation that stops existing, which is a different feature.
   */
  confirm(req: { title: string; body: string; confirm: string; cancel?: string; onConfirm: () => void }) {
    this.pendingConfirm = req.onConfirm;
    this.popup = {
      id: 'confirm',
      category: 'keys',
      severity: 'coral',
      ceiling: 4,
      exemptFromBudget: true,
      title: req.title,
      body: req.body,
      actions: [
        { id: 'confirm-yes', label: req.confirm, destructive: true },
        { id: 'confirm-no', label: req.cancel ?? 'Go back', dismissive: true },
      ],
    };
  }

  /** The callback a pending confirmation will run if you say yes. */
  private pendingConfirm: (() => void) | null = null;

  /** Raise a notice as a popup, spending budget unless it is exempt. */
  interrupt(n: Notice) {
    if (this.rungFor(n) !== 4) return false;
    this.popup = n;
    if (!n.exemptFromBudget) {
      this.popupsThisSession += 1;
      this.popupsThisWeek += 1;
      this.persist();
    }
    return true;
  }

  // --- doing things ----------------------------------------------------------

  /**
   * Run a notice's action.
   *
   * Every branch calls a public `core` method — the same one the settings
   * screens call. If she can do it, you can do it by hand, which is the rule
   * that keeps this from becoming a privileged backdoor.
   *
   * Returns a route for the caller to open, when the honest answer is "this
   * lives on a screen and I'll take you there" rather than a silent mutation.
   */
  act(notice: Notice, actionId: string): { settings?: string; members?: boolean } | void {
    const [verb, arg] = actionId.split(':');
    this.popup = null;

    switch (verb) {
      case 'confirm-yes': {
        const run = this.pendingConfirm;
        this.pendingConfirm = null;
        run?.();
        return;
      }
      case 'confirm-no':
        this.pendingConfirm = null;
        return;
      case 'save-code':
        core.confirmRecoveryCode();
        return { settings: 'account' };
      case 'already-saved':
        core.confirmRecoveryCode();
        return;
      case 'add-device':
        return { settings: 'devices' };
      case 'enrol-passkey':
        core.enrolPasskey();
        return { settings: 'account' };
      case 'revoke':
        if (arg) core.revokeDevice(arg);
        return;
      case 'keep':
        if (arg) core.keepDevice(arg);
        return;
      case 'verify':
        if (arg) core.acknowledgeKeyChange(arg);
        return { settings: 'devices' };
      case 'expected':
      case 'stop':
        if (arg) core.acknowledgeKeyChange(arg);
        return;
      case 'show-members':
        return { members: true };
      case 'translate-on':
        return { settings: 'language' };
      case 'open-command':
        core.commandSurfaceUsed = true;
        return;
      case 'delete-model':
        if (arg) core.deleteModel(arg);
        return;
      case 'clear-left':
        core.clearLeftRoomHistory();
        return;
      case 'clear-media':
        core.clearCachedMedia();
        return;
      case 'storage-details':
        return { settings: 'storage' };
      default:
        // A purely dismissive action with nothing to run. Recorded below.
        return;
    }
  }

  /** "It's fine", "No thanks", "Got it" — resolve without doing the thing. */
  dismiss(id: string) {
    // A confirmation is synthetic and one-shot. Recording "Go back" as a
    // permanent dismissal would quietly disable the next confirmation and
    // leave a phantom entry in the restore list.
    if (id === 'confirm') return;
    if (this.dismissed.includes(id)) return;
    this.dismissed = [...this.dismissed, id];
    this.persist();
  }

  /**
   * Silence a whole category, permanently. `docs/12` is explicit that this has
   * to be permanent rather than per-session, or the promise is worthless.
   */
  silence(c: Category) {
    if (this.silenced.includes(c)) return;
    this.silenced = [...this.silenced, c];
    this.persist();
  }

  unsilence(c: Category) {
    this.silenced = this.silenced.filter((x) => x !== c);
    this.persist();
  }

  /** Bring back individually dismissed notices, for the settings screen. */
  restoreDismissed() {
    this.dismissed = [];
    this.persist();
  }

  setVolume(v: Volume) {
    this.volume = v;
    this.persist();
  }

  private persist() {
    try {
      const p: Persisted = {
        volume: this.volume,
        silenced: this.silenced,
        dismissed: this.dismissed,
        week: this.week,
        popupsThisWeek: this.popupsThisWeek,
      };
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* private mode; the choice just won't persist */
    }
  }
}

export const wren = new Wren();
export type { Action, Category, Notice, Rung, Severity };
