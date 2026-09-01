<script lang="ts">
import { onMount } from 'svelte';
import '../app.css';
import { layout } from '$lib/layout.svelte.js';
import { theme } from '$lib/theme.svelte.js';

let { children } = $props();

// NOT an $effect. load() writes `current` and apply() reads it, so an effect
// wrapping them tracks its own write and loops forever — which is exactly
// what made the app unresponsive. This runs once.
onMount(() => theme.load());

/**
 * The device questions, answered before any page renders.
 *
 * This used to live in `/app`'s script as one `$effect` among a dozen, which
 * is how it ended up not running at all on a phone: an effect registered
 * *above* it threw (`replaceState` before the router was up), the flush
 * aborted, and `layout.watch()` — being later in the same flush — never
 * executed. `narrow` and `coarse` both stayed `false`, so a 390px screen
 * rendered the desktop three-column chrome: no way to open the room list, no
 * long-press menus, and every tap target below the 44px floor.
 *
 * Nothing about matchMedia needs the router, the session, or the page, so
 * none of them get to be upstream of it. `layout.watch()`'s own docstring
 * always said "called once from the root layout"; now it is.
 */
onMount(() => layout.watch());
</script>

{@render children()}
