/**
 * A GIF a member starred in the chat picker (#5772): `gif_favorites`. Per
 * member, not per chapter, so it follows them across chapters. It holds what
 * a send needs (the full rendition) and what a grid tile draws (the
 * preview), and never a token: the API signs the full rendition each time it
 * lists favorites.
 */
export interface GifFavorite {
  id: string;
  user_id: string;
  provider: string;
  gif_id: string;
  title: string;
  full_url: string;
  full_width: number;
  full_height: number;
  preview_url: string;
  preview_width: number;
  preview_height: number;
  created_at: string;
}
