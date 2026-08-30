/**
 * The image viewer's state, lifted out of the component.
 *
 * One viewer instance lives in the app shell; any attachment anywhere can open
 * it. Keeping the state here rather than in a prop chain means a message row
 * doesn't have to know the shell exists.
 */
import type { Attachment } from '$lib/fake/data.js';

class Lightbox {
  items = $state<Attachment[]>([]);
  index = $state(0);
  open = $state(false);

  get current() {
    return this.items[this.index];
  }

  show(items: Attachment[], index = 0) {
    // Only things worth filling a screen with. A file card has nothing to show.
    this.items = items.filter((a) => a.kind === 'image' || a.kind === 'gif' || a.kind === 'video');
    this.index = Math.max(
      0,
      this.items.findIndex((a) => a.id === items[index]?.id),
    );
    this.open = this.items.length > 0;
  }

  step(d: number) {
    if (!this.items.length) return;
    this.index = (this.index + d + this.items.length) % this.items.length;
  }

  close() {
    this.open = false;
  }
}

export const lightbox = new Lightbox();
