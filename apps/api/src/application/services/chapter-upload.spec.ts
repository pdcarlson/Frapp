import { BadRequestException } from '@nestjs/common';
import {
  MAX_BACKWORK_UPLOAD_BYTES,
  MAX_BACKWORK_UPLOAD_LABEL,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
} from '@repo/validation';
import type { IStorageProvider } from '#domain/adapters/storage.interface';
import {
  assertUploadRequestAllowed,
  mintChapterUpload,
} from './chapter-upload';

// Documents, Backwork, chat attachments, service hours, tasks and the profile
// photo all gate an upload request here (#4645), so the messages each one's
// 400 carries are pinned once, beside the helper.

const pdf = { filename: 'notes.PDF', contentType: 'application/pdf' };

function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error('expected a 400');
}

describe('assertUploadRequestAllowed', () => {
  it('allows a file of the kind, whatever the extension case', () => {
    expect(() =>
      assertUploadRequestAllowed('document', { ...pdf, sizeBytes: 1024 }),
    ).not.toThrow();
  });

  it('refuses an extension the kind does not allow, without naming it by default', () => {
    expect(
      refusal(() =>
        assertUploadRequestAllowed('document', {
          filename: 'run.exe',
          contentType: 'application/pdf',
        }),
      ),
    ).toBe('File extension is not allowed');
  });

  it('refuses a file with no extension at all', () => {
    expect(
      refusal(() =>
        assertUploadRequestAllowed('image', {
          filename: 'photo',
          contentType: 'image/jpeg',
        }),
      ),
    ).toBe('File extension is not allowed');
  });

  it('names the refused extension when the caller asks to', () => {
    expect(
      refusal(() =>
        assertUploadRequestAllowed(
          'document',
          { filename: 'run.EXE', contentType: 'application/pdf' },
          { nameRefusedExtension: true },
        ),
      ),
    ).toBe('File extension ".exe" is not allowed');
  });

  it('refuses a content type the kind does not allow', () => {
    expect(
      refusal(() =>
        assertUploadRequestAllowed('image', {
          filename: 'photo.jpg',
          contentType: 'application/pdf',
        }),
      ),
    ).toBe('Content type "application/pdf" is not allowed');
  });

  it('holds the shared size cap by default', () => {
    expect(() =>
      assertUploadRequestAllowed('document', {
        ...pdf,
        sizeBytes: MAX_UPLOAD_BYTES,
      }),
    ).not.toThrow();
    expect(
      refusal(() =>
        assertUploadRequestAllowed('document', {
          ...pdf,
          sizeBytes: MAX_UPLOAD_BYTES + 1,
        }),
      ),
    ).toBe(`File exceeds the ${MAX_UPLOAD_LABEL} upload limit`);
  });

  it("holds a caller's own cap and names its label", () => {
    const backwork = {
      limit: {
        bytes: MAX_BACKWORK_UPLOAD_BYTES,
        label: MAX_BACKWORK_UPLOAD_LABEL,
      },
    };
    expect(() =>
      assertUploadRequestAllowed(
        'document',
        { ...pdf, sizeBytes: MAX_UPLOAD_BYTES + 1 },
        backwork,
      ),
    ).not.toThrow();
    expect(
      refusal(() =>
        assertUploadRequestAllowed(
          'document',
          { ...pdf, sizeBytes: MAX_BACKWORK_UPLOAD_BYTES + 1 },
          backwork,
        ),
      ),
    ).toBe(`File exceeds the ${MAX_BACKWORK_UPLOAD_LABEL} upload limit`);
  });

  it('skips the size check when the client sent no size', () => {
    expect(() => assertUploadRequestAllowed('document', pdf)).not.toThrow();
  });
});

describe('mintChapterUpload', () => {
  it('mints a fresh id under the prefix and signs that key', async () => {
    const getSignedUploadUrl = jest.fn().mockResolvedValue('https://signed');
    const storage = { getSignedUploadUrl } as unknown as IStorageProvider;

    const minted = await mintChapterUpload(
      storage,
      'documents',
      'chapters/c1/documents/',
      { filename: 'notes.pdf', contentType: 'application/pdf' },
    );

    expect(minted.uploadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(minted.storagePath).toBe(
      `chapters/c1/documents/${minted.uploadId}/notes.pdf`,
    );
    expect(minted.signedUrl).toBe('https://signed');
    expect(getSignedUploadUrl).toHaveBeenCalledWith(
      'documents',
      minted.storagePath,
      'application/pdf',
    );
  });
});
