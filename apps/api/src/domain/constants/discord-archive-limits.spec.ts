import { MAX_UPLOAD_BYTES } from '@repo/validation';
import {
  MAX_ARCHIVE_EXPORT_PART_BYTES,
  MAX_ARCHIVE_UPLOAD_BYTES,
  isWithinArchiveUploadSizeLimit,
} from './discord-archive-limits';

describe('Discord archive size limits', () => {
  it('allows a 100 MB archive object but not more', () => {
    expect(MAX_ARCHIVE_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(isWithinArchiveUploadSizeLimit(MAX_ARCHIVE_UPLOAD_BYTES)).toBe(true);
    expect(isWithinArchiveUploadSizeLimit(MAX_ARCHIVE_UPLOAD_BYTES + 1)).toBe(
      false,
    );
    expect(isWithinArchiveUploadSizeLimit(-1)).toBe(false);
  });

  it('sits above the member-upload ceiling rather than raising it', () => {
    expect(MAX_ARCHIVE_UPLOAD_BYTES).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  it('caps an export partition far below the object cap', () => {
    // The importer JSON.parses a whole partition into memory on an instance
    // that is also serving live chat.
    expect(MAX_ARCHIVE_EXPORT_PART_BYTES).toBeLessThan(
      MAX_ARCHIVE_UPLOAD_BYTES,
    );
  });
});
