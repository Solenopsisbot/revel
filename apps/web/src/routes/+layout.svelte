<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import { theme } from '$lib/theme.svelte.js';

  let { children } = $props();

  // NOT an $effect. load() writes `current` and apply() reads it, so an effect
  // wrapping them tracks its own write and loops forever — which is exactly
  // what made the app unresponsive. This runs once.
  onMount(() => theme.load());
</script>

{@render children()}
