import type { ScriptedReplies } from './scripted-language-model';
import { scriptedMinutesDraft } from './scripted-minutes-draft';

/**
 * The canned replies the scripted adapter gives in the running app, by task.
 *
 * A feature that adds a catalog task adds its script here, so the feature
 * can be walked locally with `AI_ENABLED=true AI_PROVIDER=scripted` and no
 * key. A script should read like a real model's answer to the request it is
 * handed: derive it from the request (the notes, the sources) where that
 * makes the screen believable, and keep it deterministic.
 *
 * Tests and the eval suite pass their own scripts to the adapter and do not
 * read this map.
 */
export const SCRIPTED_REPLIES: ScriptedReplies = {
  'minutes.draft': scriptedMinutesDraft,
};
