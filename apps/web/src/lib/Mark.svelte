<script lang="ts">
/**
 * The mark: three overlapping discs, each ringed in whatever is behind it.
 * A few people in a place, everyone visible — the product's thesis rather
 * than an ornament. Rotated 18° about the centroid, baked in so no call site
 * can ship the upright version (`docs/15`).
 */
let {
  size = 32,
  faces = false,
  stroke = 'var(--ground-0)',
}: {
  size?: number;
  faces?: boolean;
  stroke?: string;
} = $props();
</script>

<svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" style="display:block;flex:none">
  <g {stroke} stroke-width="7">
    <circle cx="29.58" cy="42.08" r="21" fill={faces ? 'var(--face-aqua)' : 'currentColor'} />
    <circle cx="63.82" cy="30.96" r="21" fill={faces ? 'var(--face-gold)' : 'currentColor'} />
    <circle cx="56.59" cy="66.96" r="21" fill={faces ? 'var(--face-rose)' : 'currentColor'} />
  </g>
</svg>
