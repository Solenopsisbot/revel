<script lang="ts">
  /** Drawn icons only — emoji never appear in product chrome (`docs/07`). */
  const paths: Record<string, string> = {
    attach: 'M20.5 11.5l-8.4 8.4a4.6 4.6 0 0 1-6.5-6.5l8.7-8.7a3.1 3.1 0 0 1 4.4 4.4l-8.6 8.6a1.6 1.6 0 0 1-2.2-2.2l7.8-7.8',
    send: 'M21 3L10.5 13.5M21 3l-6.8 18-3.7-7.5L3 9.8z',
    reply: 'M10 9L5 14l5 5M5 14h9a5 5 0 0 0 5-5V6',
    plus: 'M12 5v14M5 12h14',
    people: 'M9 12a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.8 19.5a6.4 6.4 0 0 1 12.4 0M16.5 5.4a3.5 3.5 0 0 1 0 6.6M18 19.5a6.5 6.5 0 0 0-1.6-4.3',
    voice: 'M4 9.5h3L12 5v14l-5-4.5H4zM16 9.5a4 4 0 0 1 0 5M18.8 7a8 8 0 0 1 0 10',
    chevron: 'M6 9.5l6 6 6-6',
    check: 'M4 12.5l5 5L20 6.5',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3.2 9.5h17.6M3.2 14.5h17.6M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z',
  };
  let { name, size = 18 }: { name: keyof typeof paths | string; size?: number } = $props();
</script>

<svg
  width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  style="display:block;flex:none"
><path d={paths[name] ?? ''} /></svg>
