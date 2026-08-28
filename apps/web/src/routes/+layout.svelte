<script lang="ts">
  import '../app.css';
  import { theme } from '$lib/theme.svelte.js';
  let { children } = $props();
  // Applied before first paint on the client so there is no flash of the
  // default theme.
  $effect(() => theme.load());
</script>

{@render children()}
