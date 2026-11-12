import { z } from "zod";
import { YEAR_MAX } from "./field-limits";

// ── Chapter branding schema (Chunk 02: chapters.branding jsonb) ──────────────

/**
 * The branding block's shape. No product code parses with it: it is the type
 * source for the config PATCH body (`PatchChapterConfig`) and the API's
 * `ChapterBrandingInput`, and the API's `BrandingDto` is what enforces values.
 * A client reads a stored `branding` as the contract types it, loose jsonb
 * values, and skips one that doesn't fit (`chapter-mark.ts`): a read that
 * refused one value would blank every field beside it (#2844).
 */
export const ChapterBrandingSchema = z
  .object({
    greek_letters: z.string().optional(),
    // The chapter mark's text options (#2876); precedence is `chapter-mark.ts`.
    // An empty string is how Settings clears a short name, since the config
    // PATCH deep-merges and an omitted key keeps its stored value.
    //
    // No `.max()` here, deliberately. The cap (`CHAPTER_SHORT_NAME_MAX_LENGTH`)
    // is enforced by the DTO, whose class-validator count differs from zod's:
    // it drops variation selectors, so "❤️❤️❤️❤️" is 4 to the API and 8 to zod.
    // A zod cap would state a stricter limit than the one enforced; the inputs'
    // `maxLength` is the client-side cap.
    short_name: z.string().optional(),
    show_greek_letters: z.boolean().optional(),
    designation: z.string().optional(),
    school_short: z.string().optional(),
    founded_at: z.number().int().min(1776).max(YEAR_MAX).optional(),
    colors: z
      .object({
        // One seed. The legacy second colour (`dark`) fed only the
        // `derivePalette` token map and went with it in the #920 slice-9
        // cutover; rows written before that keep an inert stored value, which
        // nothing reads.
        accent: z
          .string()
          .regex(/^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/)
          .optional(),
      })
      .optional(),
  })
  .optional();

export type ChapterBranding = z.infer<typeof ChapterBrandingSchema>;
