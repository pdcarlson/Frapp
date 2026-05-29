# Chapter Branding

## Logo

- Chapters can upload a logo image (PNG, JPG, WebP; max 2 MB).
- The logo is displayed in: the app header/sidebar, the member directory, exported PDF reports, and the onboarding tutorial welcome screen.
- Logo stored in Supabase Storage under `chapters/{chapter_id}/branding/logo.{ext}`.
- If no logo is uploaded, the chapter name is displayed as text.

## Custom Accent Color

- Chapters can set a custom accent color (hex string, e.g. `#8B0000` for crimson).
- The accent color is used for: primary buttons, links, active tab indicators, and highlights throughout the app for that chapter's members.
- Default accent color (if none set): Frapp's Royal Blue `#2563EB`.
- Accent color is stored on the `chapters` table.

## Brand Boundaries

- Chapter branding applies only within the chapter context (when a user is viewing that chapter's data).
- The Frapp brand (navigation shell, splash screen, landing site, docs site) is NOT affected by chapter branding.
- Accent color must meet WCAG AA contrast requirements against the background. The API validates this on save and rejects colors with insufficient contrast.

## React Query Hooks Testing

- All React Query hooks related to roles (like `useRoles`, `useCreateRole`) are tested in `packages/hooks/src/use-roles.spec.tsx`. They verify successful requests and cache invalidation rules (e.g. `queryClient.invalidateQueries({ queryKey: ["roles"] })`).
