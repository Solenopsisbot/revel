/** Formatting helpers shared by the message list, media and settings. */

/** 1.4 MB, not 1468006 bytes. Decimal units, because file managers use them. */
export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** m:ss, or h:mm:ss once it's long enough to need it. */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The day divider's label. "Today" and "Yesterday" are worth the special case:
 * a date is a lookup, and those two are the ones people read most.
 */
export function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(today) - midnight(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
  });
}

/** Whether two timestamps fall on different calendar days. */
export function newDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return (
    x.getDate() !== y.getDate() ||
    x.getMonth() !== y.getMonth() ||
    x.getFullYear() !== y.getFullYear()
  );
}

/** "3 minutes ago". Used where an exact clock time would be noise. */
export function ago(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/**
 * The other direction. "in 7 days", for something that has not happened yet.
 *
 * `ago` is past tense all the way down, so feeding it an expiry gave every
 * invite link "expires just now" — a sentence that is wrong in a way people
 * act on, since it reads as a link that is already dead.
 */
export function until(ms: number): string {
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return 'in under a minute';
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  if (h < 24) return `in ${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `in ${d} day${d === 1 ? '' : 's'}`;
}

/** A natural-language list: "Rae", "Rae and June", "Rae, June and 3 others". */
export function names(list: string[], max = 3): string {
  if (list.length <= 1) return list[0] ?? '';
  if (list.length <= max) return `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
  const rest = list.length - max;
  return `${list.slice(0, max).join(', ')} and ${rest} other${rest === 1 ? '' : 's'}`;
}
