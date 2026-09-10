import type {
  RushCandidate,
  RushCandidateVote,
} from '../entities/rush-candidate.entity';

export const RUSH_CANDIDATE_REPOSITORY = 'RUSH_CANDIDATE_REPOSITORY';

export interface IRushCandidateRepository {
  findById(id: string, chapterId: string): Promise<RushCandidate | null>;
  findByNameKey(
    chapterId: string,
    nameKey: string,
  ): Promise<RushCandidate | null>;
  create(
    data: Omit<RushCandidate, 'id' | 'name_key' | 'created_at'> & {
      id?: string;
      created_at?: string;
    },
  ): Promise<RushCandidate>;
  setBidExtended(id: string, chapterId: string): Promise<RushCandidate>;
  insertVote(
    candidateId: string,
    chapterId: string,
    voterId: string,
  ): Promise<'inserted' | 'duplicate'>;
  countVotes(candidateId: string, chapterId: string): Promise<number>;
  viewerHasVoted(
    candidateId: string,
    chapterId: string,
    voterId: string,
  ): Promise<boolean>;
}

export type { RushCandidateVote };
