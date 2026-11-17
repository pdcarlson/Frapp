import {
  canSeeDocument,
  canSeeFolder,
  documentListAdmits,
  folderListsByName,
  listNoWiderThan,
  listsInPlay,
  tiersAListKeeps,
} from './document-access';
import type { ChannelAccessHolder } from './channel-access';
import { OUTSIDE_TIERS_RANK } from './role-rank';

const holder = (
  entries: string[] = [],
  wildcard = false,
): ChannelAccessHolder => ({
  entries: new Set(entries),
  wildcard,
  alumniEntries: new Set(),
});

describe('document-access (#3642 piece 1)', () => {
  describe('documentListAdmits', () => {
    it('admits everyone to a null list', () => {
      expect(documentListAdmits(null, holder())).toBe(true);
    });

    it('admits a member on any entry, and nobody else', () => {
      const list = ['tier:exec', 'role:treasurer'];
      expect(documentListAdmits(list, holder(['role:treasurer']))).toBe(true);
      expect(documentListAdmits(list, holder(['tier:member']))).toBe(false);
    });

    it('admits * to any list, an empty one included', () => {
      expect(documentListAdmits([], holder([], true))).toBe(true);
      expect(documentListAdmits([], holder(['tier:exec']))).toBe(false);
    });
  });

  describe('canSeeDocument', () => {
    const lists = folderListsByName([
      { name: 'Exec', who_can_see: ['tier:exec'] },
      { name: 'Open', who_can_see: null },
    ]);
    const viewer = (entries: string[]) => ({
      userId: 'u-1',
      holder: holder(entries),
    });
    const file = (
      folder: string | null,
      who_can_see: string[] | null,
      uploaded_by = 'u-2',
      drive_file_id: string | null = null,
    ) => ({ folder, who_can_see, uploaded_by, drive_file_id });

    it('follows its folder while its own list is null', () => {
      expect(canSeeDocument(file('Exec', null), lists, viewer([]))).toBe(false);
      expect(
        canSeeDocument(file('Exec', null), lists, viewer(['tier:exec'])),
      ).toBe(true);
    });

    it('narrows its folder with its own list: a member passes both', () => {
      const budget = file('Exec', ['role:treasurer']);
      expect(canSeeDocument(budget, lists, viewer(['tier:exec']))).toBe(false);
      expect(canSeeDocument(budget, lists, viewer(['role:treasurer']))).toBe(
        false,
      );
      expect(
        canSeeDocument(budget, lists, viewer(['tier:exec', 'role:treasurer'])),
      ).toBe(true);
    });

    it('lets the uploader see their file whatever the lists say', () => {
      expect(
        canSeeDocument(file('Exec', ['role:x'], 'u-1'), lists, viewer([])),
      ).toBe(true);
    });

    it("gives whoever connected Google Drive no way past a copy's lists", () => {
      // Copies are filed as uploaded by the connecting officer.
      expect(
        canSeeDocument(
          file('Exec', null, 'u-1', 'drive-file-1'),
          lists,
          viewer([]),
        ),
      ).toBe(false);
    });

    it('reads a top-level file, or one under a name no folder claims, by its own list alone', () => {
      expect(canSeeDocument(file(null, null), lists, viewer([]))).toBe(true);
      expect(canSeeDocument(file('Gone', null), lists, viewer([]))).toBe(true);
      expect(canSeeDocument(file(null, ['role:x']), lists, viewer([]))).toBe(
        false,
      );
    });
  });

  it('canSeeFolder reads the folder list', () => {
    expect(
      canSeeFolder(
        { who_can_see: ['group:g'] },
        {
          userId: 'u',
          holder: holder(['group:g']),
        },
      ),
    ).toBe(true);
  });

  describe('listsInPlay', () => {
    it('reads nothing when no list is set', () => {
      expect(listsInPlay([null, undefined, null])).toEqual({
        any: false,
        groups: false,
      });
    });

    it('reads groups only when a list names one', () => {
      expect(listsInPlay([null, ['tier:t']])).toEqual({
        any: true,
        groups: false,
      });
      expect(listsInPlay([['tier:t'], ['group:g']])).toEqual({
        any: true,
        groups: true,
      });
    });
  });

  describe('tiersAListKeeps', () => {
    const tiers = [
      { id: 'president', position: 0 },
      { id: 'exec', position: 1 },
      { id: 'member', position: 2 },
    ];

    it("keeps the setter's tier and every tier above it", () => {
      expect(tiersAListKeeps({ rank: 1, wildcard: false }, tiers)).toEqual([
        'tier:president',
        'tier:exec',
      ]);
    });

    it('keeps none for *', () => {
      expect(
        tiersAListKeeps({ rank: OUTSIDE_TIERS_RANK, wildcard: true }, tiers),
      ).toEqual([]);
    });

    it('answers null for a member outside every tier', () => {
      expect(
        tiersAListKeeps({ rank: OUTSIDE_TIERS_RANK, wildcard: false }, tiers),
      ).toBeNull();
    });
  });

  describe('listNoWiderThan (#5220)', () => {
    it('lets anything into an open place, and nothing open into a limited one', () => {
      expect(listNoWiderThan(null, null)).toBe(true);
      expect(listNoWiderThan(['tier:exec'], null)).toBe(true);
      expect(listNoWiderThan(null, ['tier:exec'])).toBe(false);
    });

    it('allows a list whose every entry the current list already has', () => {
      expect(listNoWiderThan(['tier:exec'], ['tier:exec', 'role:r1'])).toBe(
        true,
      );
      expect(listNoWiderThan([], ['tier:exec'])).toBe(true);
    });

    it('refuses a list that names anyone the current list does not', () => {
      expect(listNoWiderThan(['role:r2'], ['tier:exec'])).toBe(false);
      expect(
        listNoWiderThan(['tier:exec', 'tier:members'], ['tier:exec']),
      ).toBe(false);
    });
  });
});
