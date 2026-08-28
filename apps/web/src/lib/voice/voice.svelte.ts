/**
 * The call controller.
 *
 * Lives outside any component on purpose (`docs/21`, Kith's `voice.svelte.ts`
 * pattern): the call has to **survive navigation**. If this were state inside
 * the voice room's view, walking into another room to check something would
 * drop you out of the conversation, which is the single most annoying thing a
 * chat app can do.
 *
 * The governing idea from `docs/21` is that *a call is just a room being
 * loud* — same audience, same keys, same roster. So there is no separate
 * participant permission model here; who can hear is whoever can read the
 * room, and this file only tracks who is currently making noise in it.
 */
import { core } from '../fake/core.svelte.js';

export type Quality = 'good' | 'degraded' | 'reconnecting';

export interface Participant {
  faceId: string;
  /** Their mic is off. Legible on the tile itself, not only in a control bar. */
  muted: boolean;
  /** Drives the speaking ring. Never reorders tiles. */
  speaking: boolean;
  quality: Quality;
  /**
   * Our two clients disagree about this call's keys, so their audio decodes to
   * nothing. `docs/21` calls this out as the worst failure mode because it
   * looks exactly like a network problem and needs saying out loud.
   */
  diverged?: boolean;
  sharing?: boolean;
}

class Voice {
  /** Which room you are in, if any. Null is "not in a call". */
  spaceId = $state<string | null>(null);
  roomId = $state<string | null>(null);

  participants = $state<Participant[]>([]);

  /**
   * Muted on arrival, always. Walking into a conversation you have not heard
   * yet already broadcasting is a small hostile act, and every app that does
   * it is wrong (`docs/21`).
   */
  micMuted = $state(true);
  deafened = $state(false);
  cameraOn = $state(false);
  sharing = $state(false);
  /** Set briefly on a membership change, so the epoch bump reads as security
      working rather than as a glitch. */
  rekeying = $state(false);

  private speakingTimer: ReturnType<typeof setInterval> | null = null;

  get inCall() {
    return this.roomId !== null;
  }

  get room() {
    if (!this.spaceId || !this.roomId) return undefined;
    return core.spaces.find((s) => s.id === this.spaceId)?.rooms.find((r) => r.id === this.roomId);
  }

  /** The room you are in, only when you are also *looking* at it. Decides
      whether the shell shows the stage or the persistent bar. */
  get viewingCall() {
    return this.inCall && core.currentSpaceId === this.spaceId && core.currentRoomId === this.roomId;
  }

  join(spaceId: string, roomId: string) {
    if (this.roomId === roomId && this.spaceId === spaceId) return;
    if (this.inCall) this.leave();

    const room = core.spaces.find((s) => s.id === spaceId)?.rooms.find((r) => r.id === roomId);
    if (!room) return;

    this.spaceId = spaceId;
    this.roomId = roomId;
    this.micMuted = true;

    // Whoever was already in there, plus you.
    const existing = (room.inCall ?? []).filter((id) => id !== core.speakingAs);
    this.participants = [
      ...existing.map((faceId) => ({
        faceId,
        muted: false,
        speaking: false,
        quality: 'good' as Quality,
      })),
      { faceId: core.speakingAs, muted: true, speaking: false, quality: 'good' as Quality },
    ];
    room.inCall = this.participants.map((p) => p.faceId);

    // Your arrival changed the membership, so the key rotates.
    this.bumpEpoch();
    this.startChatter();
  }

  leave() {
    const room = this.room;
    if (room) {
      room.inCall = (room.inCall ?? []).filter((id) => id !== core.speakingAs);
      if (!room.inCall.length) room.inCall = undefined;
    }
    this.stopChatter();
    this.spaceId = null;
    this.roomId = null;
    this.participants = [];
    this.micMuted = true;
    this.cameraOn = false;
    this.sharing = false;
    this.deafened = false;
  }

  toggleMic() {
    this.micMuted = !this.micMuted;
    const me = this.participants.find((p) => p.faceId === core.speakingAs);
    if (me) {
      me.muted = this.micMuted;
      if (this.micMuted) me.speaking = false;
    }
  }

  /** Deafening implies muting — you can't credibly stay in a conversation you
      have stopped listening to, and every app that lets you is confusing. */
  toggleDeafen() {
    this.deafened = !this.deafened;
    if (this.deafened && !this.micMuted) this.toggleMic();
  }

  toggleCamera() {
    this.cameraOn = !this.cameraOn;
  }

  toggleShare() {
    this.sharing = !this.sharing;
    const me = this.participants.find((p) => p.faceId === core.speakingAs);
    if (me) me.sharing = this.sharing;
  }

  /** The reciprocal of the diverged-audio message: both sides are told, so
      neither one sits there assuming the other went quiet. */
  reconnectAudio(faceId: string) {
    const p = this.participants.find((x) => x.faceId === faceId);
    if (!p) return;
    p.quality = 'reconnecting';
    this.bumpEpoch();
    setTimeout(() => {
      p.diverged = false;
      p.quality = 'good';
    }, 1400);
  }

  private bumpEpoch() {
    this.rekeying = true;
    setTimeout(() => (this.rekeying = false), 900);
  }

  /**
   * Something for the speaking rings to do. In the real client this is an
   * audio-level callback from the SFU; here it is a timer, and it is the only
   * thing in this file that would not exist in production.
   */
  private startChatter() {
    this.stopChatter();
    this.speakingTimer = setInterval(() => {
      for (const p of this.participants) {
        if (p.faceId === core.speakingAs) {
          p.speaking = !this.micMuted && Math.random() < 0.25;
          continue;
        }
        if (p.muted || p.diverged) continue;
        p.speaking = Math.random() < 0.35;
      }
    }, 900);
  }

  private stopChatter() {
    if (this.speakingTimer) clearInterval(this.speakingTimer);
    this.speakingTimer = null;
  }

  /** Demo hook: break one participant's keys so the failure state is reachable
      without waiting for a real epoch mismatch. */
  simulateDivergence() {
    const other = this.participants.find((p) => p.faceId !== core.speakingAs);
    if (!other) return;
    other.diverged = true;
    other.speaking = false;
  }

  name(faceId: string) {
    return core.faces[faceId]?.name ?? 'Someone';
  }
}

export const voice = new Voice();
