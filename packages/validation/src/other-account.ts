/**
 * The quiet line under s02's two answers, on web `/join` and the phone's join
 * screen: a way back for someone who is already in a chapter but signed in
 * with a different account than the one they joined with (Google instead of
 * their school email, say). Tapping it signs out and lands on sign-in.
 *
 * It replaced the "New account created" card (#3786, #3801, #4769), which
 * fired on every first sign-in, so every genuine newcomer read a warning about
 * a duplicate they didn't have (Paul, 2026-11-15: "If it's confusing, then we
 * have a problem"). A real duplicate can't be told from a newcomer: GoTrue
 * links a sign-in to an account with the same verified email, so a duplicate
 * always carries an address the app has never seen. The line asks the one
 * question only that person answers yes to, as Slack's "Don't see your
 * workspace? Try a different email" does.
 */
export const OTHER_ACCOUNT_PROMPT = "Already in a chapter?";
export const OTHER_ACCOUNT_ACTION = "Use a different account";
/** For a screen reader, which reads the line as one button. */
export const OTHER_ACCOUNT_HINT =
  "Signs out so you can sign in with the account you joined with.";
