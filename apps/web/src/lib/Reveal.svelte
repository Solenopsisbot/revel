<script lang="ts">
  /**
   * A gentle fade-and-rise as a section enters view.
   *
   * `docs/32` forbids scroll-tied reveals in the workspace — the message list
   * is a document you read, not a stage. A landing page is the opposite case:
   * it is a moment surface, seen once, where pacing is the point. The rule
   * still holds that motion carries emphasis and never information, so
   * everything here is fully legible with it switched off.
   */
  let { children, delay = 0 }: { children: import('svelte').Snippet; delay?: number } = $props();
  let el = $state<HTMLElement>();
  let shown = $state(false);

  $effect(() => {
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown = true;
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          shown = true;
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<div bind:this={el} class="reveal" class:shown style="--delay: {delay}ms">
  {@render children()}
</div>

<style>
  .reveal {
    opacity: 0;
    transform: translateY(14px);
    transition:
      opacity var(--t-slow) var(--ease) var(--delay),
      transform var(--t-slow) var(--ease) var(--delay);
  }
  .reveal.shown { opacity: 1; transform: none; }
  :global(.reduce-motion) .reveal { opacity: 1; transform: none; transition: none; }
</style>
