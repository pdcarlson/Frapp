# Chapter Creation Performance

## Bulk seeding of default roles and channels

Creating a chapter seeds every default system role and every default chat channel. `ChapterService.create` writes each set in one round-trip: the roles with a single `roleRepo.createMany`, and the channels with a single `chat_channels` insert of the whole `DEFAULT_CHANNELS` array. A per-row loop would cost one query per role and one per channel, growing with each list. `apps/api/src/application/services/chapter.service.spec.ts` asserts both single writes.
