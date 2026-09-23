import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LEGAL_ACCEPTANCE_REQUIRED_CODE,
  LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
  LEGAL_POLICY_VERSION,
} from '@repo/validation';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import type { User } from '#domain/entities/user.entity';

/** Where a user stands against the Terms the server enforces now. */
export interface LegalAcceptanceStatus {
  /** The `LEGAL_POLICY_VERSION` this server enforces. */
  current_version: string;
  /** The version the user last accepted, or null if they never have. */
  accepted_version: string | null;
  accepted_at: string | null;
  /** True until the user accepts `current_version`. */
  required: boolean;
}

function toStatus(user: User): LegalAcceptanceStatus {
  const acceptedVersion = user.legal_policy_version ?? null;
  return {
    current_version: LEGAL_POLICY_VERSION,
    accepted_version: acceptedVersion,
    accepted_at: user.legal_accepted_at ?? null,
    required: acceptedVersion !== LEGAL_POLICY_VERSION,
  };
}

/**
 * Each user's own Terms of Service and Privacy Policy acceptance (#2302,
 * `spec/behavior/legal.md` § Acceptance record).
 *
 * The server decides whether acceptance is required, by comparing the stored
 * version with its own `LEGAL_POLICY_VERSION`. Clients never compare versions
 * themselves: a store binary can't be updated over the air, so one compiled
 * with an older constant would otherwise disagree with the server forever and
 * either never prompt or prompt in a loop.
 *
 * Both columns are stamped here and nowhere else, from the session's user id
 * and the server clock. A client's checkbox is only its claim that the user
 * ticked it; the DTOs' `@Equals(true)` is what makes that claim required.
 */
@Injectable()
export class LegalAcceptanceService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
  ) {}

  async status(userId: string): Promise<LegalAcceptanceStatus> {
    return toStatus(await this.load(userId));
  }

  /**
   * Record that the user accepted the current version.
   *
   * Idempotent: a user who already accepted this version keeps the timestamp
   * of their first acceptance, so joining a second chapter or retrying a
   * request doesn't rewrite when they agreed.
   */
  async accept(userId: string): Promise<LegalAcceptanceStatus> {
    const user = await this.load(userId);
    if (!toStatus(user).required) return toStatus(user);
    const updated = await this.userRepo.update(userId, {
      legal_accepted_at: new Date().toISOString(),
      legal_policy_version: LEGAL_POLICY_VERSION,
    });
    return toStatus(updated);
  }

  /**
   * The gate on every path into a chapter: invite redemption, onboarding and
   * `POST /v1/chapters`.
   *
   * `accepting` is the request's validated checkbox. When it's true the
   * acceptance is recorded; when it's false the user must already have
   * accepted the current version, or the request is refused with
   * {@link LEGAL_ACCEPTANCE_REQUIRED_CODE}. Callers run this before they
   * create the membership, so no member can exist without an acceptance.
   *
   * Every caller passes its validated checkbox rather than calling
   * {@link accept} directly, so a new caller has to state the claim it is
   * recording (the reasoning `ChapterOnboardingInput` gives for keeping
   * `accept_terms_privacy` in its signature).
   */
  async requireOrAccept(
    userId: string,
    accepting: boolean,
  ): Promise<LegalAcceptanceStatus> {
    if (accepting) return this.accept(userId);
    const status = toStatus(await this.load(userId));
    if (status.required) {
      // Both keys, but only the message reaches a client today: the global
      // filter drops `code` (#1020), so clients match the shared message.
      throw new ForbiddenException({
        code: LEGAL_ACCEPTANCE_REQUIRED_CODE,
        message: LEGAL_ACCEPTANCE_REQUIRED_MESSAGE,
      });
    }
    return status;
  }

  private async load(userId: string): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    // A tombstoned account can still hold a working token for a moment during
    // deletion (see UserService.update). Refuse rather than stamp a record
    // onto it; the repository's update would refuse the write anyway.
    if (user.deleted_at) throw new GoneException('Account has been deleted');
    return user;
  }
}
