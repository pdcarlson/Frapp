/**
 * Compile-only proof that every request DTO is **fully covered** by the
 * application-layer `…Input` type its service actually takes.
 *
 * Why this file exists. The application layer may not import the interface
 * layer (dependency-cruiser `api-application-not-to-interface`), so each of
 * these services declares its own input shape and the controller is where the
 * DTO meets it. That call site checks *assignability*, which is one-directional
 * and is not the guarantee it looks like: a property added to a DTO and never
 * added to the corresponding `…Input` type compiles perfectly, validates on the
 * wire, and is then silently dropped before the service can read it. On the
 * config PATCH that is a 200 with no write and no audit row.
 *
 * `Covers` closes exactly that hole: it fails when a DTO key has no counterpart
 * on the Input type. It deliberately does **not** assert the reverse — an Input
 * type may carry fields no DTO supplies (another caller's), and assignability at
 * the controller already catches an Input requirement a DTO stopped meeting.
 *
 * Not imported at runtime. It lives in `interface/` because that is the layer
 * allowed to see both sides, and beside the DTOs so `nest build`
 * (tsconfig.build.json) type-checks it — the same arrangement, and the same
 * reasoning, as `infrastructure/supabase/database.types.insert-check.ts`.
 *
 * When this file fails: add the missing key to the `…Input` type, do not widen
 * `Covers`.
 */
import type {
  PatchChapterConfigInput,
  ChapterWorkflowPatch,
  ChapterBetaConfigPatch,
} from '../../application/services/chapter-config.service';
import type { ChapterOnboardingInput } from '../../application/services/chapter-onboarding.service';
import type {
  CreateCustomFieldInput,
  UpdateCustomFieldInput,
} from '../../application/services/custom-field.service';
import type {
  CreateCustomRoleInput,
  UpdateCustomRoleInput,
} from '../../application/services/custom-role.service';
import type { ChapterBrandingInput } from '../../application/services/chapter-palette';
import type {
  PatchChapterConfigDto,
  BrandingDto,
  BetaConfigDto,
  WorkflowConfigDto,
} from './chapter-config.dto';
import type { ChapterOnboardingDto } from './chapter-onboarding.dto';
import type {
  CreateCustomFieldDto,
  UpdateCustomFieldDto,
} from './custom-field.dto';
import type {
  CreateCustomRoleDto,
  UpdateCustomRoleDto,
} from './custom-role.dto';

/**
 * `never` unless every key of `Dto` also exists on `Input`. Assigning it to
 * `true` is what turns a gap into a compile error naming the pair.
 */
type Covers<Dto, Input> = keyof Dto extends keyof Input ? true : never;

/**
 * `accept_terms_privacy` is the one deliberate exemption, and it is exempt
 * because `ChapterOnboardingInput` **does** carry it — see that type's
 * docstring for why a legal gate stays in the signature of a method that stamps
 * the acceptance.
 */
export const dtoKeysAreCoveredByServiceInputs: {
  patchChapterConfig: Covers<PatchChapterConfigDto, PatchChapterConfigInput>;
  branding: Covers<BrandingDto, ChapterBrandingInput>;
  betaConfig: Covers<BetaConfigDto, ChapterBetaConfigPatch>;
  workflow: Covers<WorkflowConfigDto, ChapterWorkflowPatch>;
  chapterOnboarding: Covers<ChapterOnboardingDto, ChapterOnboardingInput>;
  createCustomField: Covers<CreateCustomFieldDto, CreateCustomFieldInput>;
  updateCustomField: Covers<UpdateCustomFieldDto, UpdateCustomFieldInput>;
  createCustomRole: Covers<CreateCustomRoleDto, CreateCustomRoleInput>;
  updateCustomRole: Covers<UpdateCustomRoleDto, UpdateCustomRoleInput>;
} = {
  patchChapterConfig: true,
  branding: true,
  betaConfig: true,
  workflow: true,
  chapterOnboarding: true,
  createCustomField: true,
  updateCustomField: true,
  createCustomRole: true,
  updateCustomRole: true,
};
