/*
 * Tailwind v4 ships its PostCSS integration as a separate package; using
 * `tailwindcss` itself as a plugin is a hard error ("the PostCSS plugin has
 * moved to a separate package"), which is what broke both Next builds on the
 * v3 → v4 bump.
 *
 * `autoprefixer` is gone with it. v4 runs Lightning CSS over its own output and
 * prefixes what still needs prefixing, so a second prefixer is redundant work
 * at best; the upgrade guide has you drop it.
 */
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
