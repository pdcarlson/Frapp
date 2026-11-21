/**
 * The paint the phone's glass overlays share, where no Signet token holds
 * the value (`SignetTokens` has no scrim, pressed or overlay roles, and its
 * radius ladder stops at the sheet's 20): one named home, so the long-press
 * menu (`components/glass-menu.tsx`) and the tab bar's quick-actions panel
 * (`components/glass-tab-bar.tsx`) can't drift apart.
 */

/** The dim behind a glass panel or menu: black at 40%, lighter than a sheet's 55%. */
export const GLASS_SCRIM = "rgba(0,0,0,0.40)";

/** A control pressed on glass: white at 8%. */
export const GLASS_PRESSED = "rgba(255,255,255,0.08)";

/** The thicker break above a glass menu's last group: black at 18%. */
export const GLASS_GROUP_BREAK = "rgba(0,0,0,0.18)";

/** A glass menu's corner, the quick-actions panel's glass at a menu's size. */
export const GLASS_MENU_RADIUS = 22;
