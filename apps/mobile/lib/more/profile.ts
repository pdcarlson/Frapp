/**
 * Narrowing for s15 (Profile). The stat cards' reads and arithmetic are shared
 * with web, in `@repo/hooks` (`profile-stats.ts`), as are the major · company ·
 * year line and `formatGraduationYear`.
 */
import {
  type BirthdayVisibility,
  parseBirthdayVisibility,
} from "@repo/validation";
import { initialsFor, isRecord, num, str } from "./narrow";

export interface ViewerProfile {
  displayName: string | null;
  initials: string;
  email: string | null;
  /** The member's own phone (#3711), as they typed it, or `null`. */
  phone: string | null;
  graduationYear: number | null;
  major: string | null;
  currentCity: string | null;
  currentCompany: string | null;
  bio: string | null;
  /** Signed URL the API serves for the uploaded photo, or `null`. */
  photoUrl: string | null;
  /** The birthday (#4959): month 1-12 and day, both or neither. */
  birthdayMonth: number | null;
  birthdayDay: number | null;
  /** Optional; only the member ever sees it. */
  birthdayYear: number | null;
  /** Who may see it; `nobody` unless the member chose their chapter. */
  birthdayVisibility: BirthdayVisibility;
}

/** `GET /v1/users/me`, narrowed. Returns `null` before the first payload. */
export function selectViewerProfile(data: unknown): ViewerProfile | null {
  if (!isRecord(data)) return null;
  const displayName = str(data, "display_name");
  return {
    displayName,
    initials: initialsFor(displayName),
    email: str(data, "email"),
    phone: str(data, "phone"),
    graduationYear: num(data, "graduation_year"),
    major: str(data, "major"),
    currentCity: str(data, "current_city"),
    currentCompany: str(data, "current_company"),
    bio: str(data, "bio"),
    photoUrl: str(data, "avatar_url"),
    birthdayMonth: num(data, "birthday_month"),
    birthdayDay: num(data, "birthday_day"),
    birthdayYear: num(data, "birthday_year"),
    birthdayVisibility: parseBirthdayVisibility(
      str(data, "birthday_visibility"),
    ),
  };
}
