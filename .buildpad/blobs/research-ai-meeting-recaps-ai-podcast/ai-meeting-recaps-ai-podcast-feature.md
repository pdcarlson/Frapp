# Feasibility brief: AI meeting recaps and AI audio "podcast" generation for Signet

**Bottom line up front.** Both features are technically feasible and, at chapter scale, essentially free to run — the API costs are so low they don't constrain the decision. The real decisions are about *input source* and *build complexity*, not money. For recaps, **build on typed meeting minutes first** (near-zero cost, no consent/recording problems, already standard practice in student orgs) and treat recording+transcription as an optional later add-on. For audio, **a single-voice narration of the text recap captures most of the value** at a fraction of the build complexity of a NotebookLM-style two-host podcast — and TTS is billed per character regardless of voice count, so "two hosts" buys engagement, not cost savings. Both belong late on the roadmap, but recaps-from-minutes is a small enough feature that it could be pulled forward opportunistically; the two-host podcast is the piece to defer longest.

---

## 1. Meeting recaps: typed minutes beat recording+transcription for a college chapter

**The cost gap is real but small in absolute terms; the adoption gap is the deciding factor.**

Summarizing typed minutes that chapters already produce costs **essentially nothing** — roughly **$0.0007 per meeting** with a cheap model like GPT-4o-mini (a ~500-word set of minutes is only ~670 input tokens). [developers.openai](https://developers.openai.com/api/docs/models/gpt-4o-mini) Summarizing a full transcribed recording costs more because of the transcription step, not the summarization: a one-hour meeting runs **$0.36 on Whisper** ($0.006/min), **$0.15 on AssemblyAI**, or **~$0.26 on Deepgram**, plus a few cents for the LLM. [platform.openai](https://platform.openai.com/docs/models/whisper-1) [assemblyai](https://www.assemblyai.com/pricing) [deepgram](https://deepgram.com/pricing) All-in, a transcribe-then-summarize meeting lands around **$0.36–0.41**. [platform.openai](https://platform.openai.com/docs/models/whisper-1) Even at hundreds of meetings a month across many chapters, this is trivial money.

So the decision isn't cost — it's **what's realistic to actually get into the system**. Three factors favor typed minutes for a fraternity/sorority context:

- **Minutes already exist.** Chapters routinely take written minutes (often a required secretary duty). This is captured content with zero new behavior required — the single biggest adoption lever.
- **Recording introduces consent friction.** US recording law splits into one-party-consent (federal baseline and most states) and **all-party-consent states, of which there are eleven**: California, Connecticut, Florida, Illinois, Maryland, Massachusetts, Montana, New Hampshire, Pennsylvania, and Washington. [dmlp](https://www.dmlp.org/legal-guide/recording-phone-calls-and-conversations) For a multi-tenant app serving chapters nationwide, this is a per-chapter-location compliance flag, not something to solve centrally — and the safe default is to require all-party consent. [dmlp](https://www.dmlp.org/legal-guide/recording-phone-calls-and-conversations) On top of the legal issue, recording a room full of students candidly discussing chapter business is socially awkward in a way that reading typed minutes is not.
- **Transcription accuracy degrades in exactly the setting chapters use.** Vendor and third-party benchmarks put clean-audio word error rates in the 8–16% range [assemblyai](https://www.assemblyai.com/benchmarks) [scribie](https://scribie.com/blog/speech-to-text-accuracy-benchmark-assemblyai-deepgram-whisperx), but a chapter meeting is the hard case: many speakers, crosstalk, a large echoey room, phone-in-pocket audio. Speaker diarization error rates run ~26–27% even on production benchmarks. [scribie](https://scribie.com/blog/speech-to-text-accuracy-benchmark-assemblyai-deepgram-whisperx) That directly undermines "who said/committed to what."

**On "just use Zoom/Meet's built-in transcript to avoid paying":** viable in principle but not free and not automatic. Zoom's audio transcription requires a **paid Pro/Business/Education tier** with cloud recording and is English-only [zoom](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0065911); Google Meet transcripts require **Business Standard or higher** and someone has to manually start transcription each meeting.  More to the point, most chapter meetings happen in person, so a video-call transcript path is a poor fit anyway.

**Recommendation (a):** Build recaps on **typed minutes as the primary input** — paste or upload the secretary's notes, get back a structured recap (decisions, action items with owners, discussion points). Add an optional "upload an audio recording" path later for chapters that want it, gated behind an explicit consent acknowledgment. This inverts the usual assumption that recaps require recording infrastructure.

---

## 2. Action-item extraction works, but not reliably enough to auto-fire reminders

This matters specifically because Signet wants recaps to feed personalized per-user reminders. All four leading tools — **Otter, Fireflies, Fathom, and Read.ai** — detect action items and attempt to assign them to named owners. [otter](https://help.otter.ai/hc/en-us/articles/5093228433687-Overview-of-Takeaways)  [fathom](https://help.fathom.video/en/articles/640768) [read](https://www.read.ai/articles/how-to-summarize-a-meeting-methods-templates-ai-tools) Otter even exposes a structured `action_items[]` API object with an `assignee` field. [otter](https://help.otter.ai/hc/en-us/articles/36130822688279-Otter-ai-Public-API)

But **the assignment is not reliable enough to trigger notifications without a human confirmation step**:

- Practitioners report Otter producing "bafflingly wrong" action items (flagging "we should grab coffee sometime" as a task) *and* missing real deadline commitments. [justtalkingtech](https://justtalkingtech.medium.com/otter-vs-fireflies-in-2026-the-veterans-reviewed-1ae7a9409eaa)
- Accuracy reportedly drops from ~88–90% in clean 1-on-1 calls to ~75% in group calls with 5+ people [reddit](https://www.reddit.com/r/AiNoteTaker/comments/1rls9rp/5_best_ai_meeting_note_takers_in_2026_after/) — and a chapter meeting is a large group call.
- Read.ai's own docs concede AI "can miss the softer ones" where someone agrees "without clearly owning it out loud," and stresses a review step. [read](https://www.read.ai/articles/how-to-summarize-a-meeting-methods-templates-ai-tools) Fathom review sentiment says outputs are "generally accurate" but "benefit from a quick human review for names, context." [g2](https://www.g2.com/products/fathom-video/reviews)

**Implication:** Signet should treat extracted action items as *drafts*. The recap should surface proposed action items with proposed owners, and a member (secretary or the assignee) should confirm before any reminder fires. This is both a reliability necessity and a nice UX pattern — it mirrors the "refuse/confirm, don't fabricate" stance already decided for the Ask feature. Firing wrong reminders at chapter members would erode trust fast.

---

## 3. Audio generation: NotebookLM's architecture, and why single-voice is the right first move

**How NotebookLM Audio Overview works (the reference point).** The pipeline is: an LLM generates a two-host conversational *script* from source documents, then a multi-speaker TTS model renders it as audio. Google's own accounts and credible teardowns describe the script side as a multi-step chain — outline → revise → detailed script → self-critique → revise → add banter/disfluencies — reportedly built on long-context Gemini. [simonwillison](https://simonwillison.net/2024/Sep/29/notebooklm-audio-overview/) The audio side traces to Google's SoundStream/AudioLM/**SoundStorm** lineage, which synthesizes multi-speaker dialogue "given a transcript annotated with speaker turns." [deepmind](https://deepmind.google/blog/pushing-the-frontiers-of-audio-generation/) [google-research](https://google-research.github.io/seanet/soundstorm/examples/) The conversational "feel" (micro-interjections, pauses, "uh…") is reportedly baked into the audio model rather than the text. [latent](https://www.latent.space/p/notebooklm) The underlying models are Google-internal and not available as APIs, so replication means assembling your own LLM-for-script + TTS-for-audio stack.

**Notably, NotebookLM itself now ships a single-speaker format** — "The Brief," a sub-two-minute single-voice overview — alongside the two-host "Deep Dive."  That's a strong signal that even the reference product concluded not every use case needs two hosts.

**The critical cost insight: two hosts do NOT cost more.** TTS is billed per character on every major provider, and ElevenLabs' dialogue API meters "total character count across all inputs," not per-speaker. [elevenlabs](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert) A two-host episode with the same total script length costs roughly the same to synthesize as a single-voice version. [elevenlabs](https://elevenlabs.io/pricing/api) So the two-host format isn't a cost decision — it's a **complexity and quality** decision. What two hosts add is a harder script-generation problem (writing natural back-and-forth dialogue with tension/banter) and dependence on ElevenLabs' v3 dialogue capability, versus a single narrator reading a clean recap.

**Value of the format is mixed.** Users call NotebookLM output "jaw-dropping" and "astonishingly convincing" [reddit](https://www.reddit.com/r/notebooklm/comments/1fryy5w/impressions_of_audio_overview_as_a_podcast/) [simonwillison](https://simonwillison.net/2024/Sep/29/notebooklm-audio-overview/), but others find it repetitive ("chattering," endless "exactly"s) and question whether it's "novelty" beyond first use. [reddit](https://www.reddit.com/r/notebooklm/comments/1n2rn4i/what_do_you_think_about_notebooks_audio_overview/) For a "what happened at chapter this week" digest — utilitarian, recurring, weekly — the entertainment premium of two-host banter matters less than for one-off deep dives into dense material.

**Recommendation (c):** Start with **single-voice narration of the text recap**. It delivers the core value (listen to the week's recap on the walk to class), is dramatically simpler to build (concatenate a script, one TTS call, one voice), and is cheaper per episode. Keep the two-host podcast as a possible premium/delight upgrade far later, informed by whether chapters actually engage with the single-voice version.

---

## 4. Cost per unit at chapter scale: negligible

Assuming a 5-minute episode ≈ ~4,000–4,500 characters of script (~150 words/min): [texttolab](https://texttolab.com/blog/azure-text-to-speech-pricing)

| TTS option | Cost per 5-min episode | 200 chapters × 4 episodes/mo (800 eps) |
|---|---|---|
| OpenAI tts-1 | ~$0.06 | ~$50/mo [developers.openai](https://developers.openai.com/api/docs/models/tts-1) |
| ElevenLabs Flash/Turbo | ~$0.19–0.21 | ~$165/mo [elevenlabs](https://elevenlabs.io/pricing/api) |
| ElevenLabs Multilingual v2/v3 | ~$0.38–0.45 | ~$330/mo [elevenlabs](https://elevenlabs.io/pricing/api) |
| Cheapest (Polly/Google Standard, $4/1M chars) | ~$0.015–0.018 | ~$13/mo [aws](https://aws.amazon.com/polly/pricing/) |

Add the **LLM script-generation step** — the same order of magnitude as the recap summarization: **~$0.002 with GPT-4o-mini** up to ~$0.05 with a premium model per episode. [developers.openai](https://developers.openai.com/api/docs/models/gpt-4o-mini)

**So a fully-loaded weekly audio episode costs somewhere between roughly $0.02 (cheapest TTS + cheap LLM) and $0.50 (ElevenLabs premium + premium LLM).** Even at 200 chapters generating weekly, the total monthly bill is in the **tens of dollars** — well within a self-funded budget. Text-only recaps are cheaper still.

Two practical notes for a solo founder: ElevenLabs commercial use requires a **paid plan** (Starter is $6/mo with a commercial license), and the higher tiers exist mainly to buy larger monthly character allowances. [elevenlabs](https://elevenlabs.io/pricing) [elevenlabs](https://elevenlabs.io/docs/overview/capabilities/text-to-dialogue) OpenAI tts-1 at ~$0.06/episode with no plan floor is the cheapest sane starting point for single-voice; ElevenLabs is the upgrade if voice quality becomes a differentiator.

**Cost is not a reason to avoid either feature. Build complexity and adoption are the only real constraints.**

---

## 5. Competitors already do "AI podcast from documents"

Beyond NotebookLM, an ecosystem exists — worth knowing so Signet doesn't reinvent, and as evidence the pattern is proven and replicable:

- **Podcastfy** (open source) is the most useful reference: it generates NotebookLM-style audio conversations from documents, supports 2–5 minute "shorts," and its defaults are **Gemini Flash for the script + OpenAI TTS for audio** — essentially the exact stack Signet would assemble. [github](https://github.com/souzatharsis/podcastfy/blob/main/usage/config.md)
- **Jellypod, Wondercraft, Podfeed, PodLM, BeFreed** are commercial "text/docs → podcast" products, mostly consumer/creator-focused, adding custom voices, script editing, and RSS distribution. [jellypod](https://www.jellypod.com/compare/jellypod-vs-notebooklm) [wondercraft](https://www.wondercraft.ai/tools/text-to-podcast-generator)
- **AutoContentAPI** offers multi-host AI podcast generation as a single API — a potential build-vs-buy shortcut if Signet ever wants two-host output without building the dialogue pipeline. [autocontentapi](https://autocontentapi.com/)

None of these target Greek-life or team-meeting-recap contexts specifically, so the *packaging* (weekly chapter digest tied to your own records and reminders) remains differentiated even though the underlying capability is commoditized.

---

## 6. Build complexity and roadmap sequencing

Ranked from simplest to most complex, which suggests the natural build order:

1. **Text recap from typed minutes** — smallest feature. An LLM call over pasted/uploaded minutes returning structured output. No new infrastructure, negligible cost, no legal exposure. Could be pulled forward opportunistically as a quick win once the RAG data plumbing exists (it reuses the same document ingestion). *Lowest complexity.*
2. **Draft action items → confirm → reminders** — modest add-on to #1, but requires the human-confirmation UX and ties into the separately-researched notification feature. Do not auto-fire. *Low-medium complexity, gated on notification work.*
3. **Optional audio recording → transcription → recap** — medium complexity: audio capture, a transcription vendor integration, and a per-chapter consent gate. Accuracy caveats in group settings. *Medium; genuinely optional.*
4. **Single-voice audio narration of the recap** — small once #1 exists: one TTS call over the recap text, store/serve the audio file. *Low-medium complexity, high delight-per-effort.*
5. **Two-host conversational podcast** — largest: dialogue-script generation, multi-speaker TTS (ElevenLabs v3 or an API like AutoContentAPI), tuning for naturalness. No cost advantage over #4. *Highest complexity; defer longest, or buy rather than build.*

**Suggested placement:** Recaps-from-minutes (#1–2) can ride alongside the RAG fast-follow since they share ingestion. Single-voice audio (#4) is a light, high-impact follow-on. Recording/transcription (#3) and the two-host podcast (#5) are genuinely "way down the line" and should only be revisited if usage data shows demand — the two-host format especially, given its mixed reception and lack of cost benefit.

---

## Where more research would change the conclusions

Two areas would most sharpen this if the feature moves toward commitment. First, **actual chapter behavior around minutes**: this brief assumes typed minutes are reliably produced and detailed enough to summarize well — validating that with real chapter secretaries (do minutes capture decisions and action items, or just attendance?) would confirm or undercut the "build on typed minutes" recommendation. Second, **hands-on quality testing of single-voice vs two-host on real chapter content** — since the format-value evidence is mixed and subjective, a cheap prototype (Podcastfy or a manual OpenAI-TTS test on one week's minutes) would settle the format question far better than any further desk research.