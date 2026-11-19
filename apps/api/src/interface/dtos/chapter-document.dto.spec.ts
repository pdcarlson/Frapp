import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MoveDocumentsDto, UpdateDocumentDto } from './chapter-document.dto';

const errorsFor = <T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) =>
  validateSync(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((error) => error.property);

// #5563: rename a file and move it to another folder.
describe('UpdateDocumentDto', () => {
  it('takes a title, a folder, or null for no folder', () => {
    expect(errorsFor(UpdateDocumentDto, { title: 'Bylaws' })).toEqual([]);
    expect(errorsFor(UpdateDocumentDto, { folder: 'Rush' })).toEqual([]);
    expect(errorsFor(UpdateDocumentDto, { folder: null })).toEqual([]);
  });

  it('refuses a null or empty title and an overlong folder', () => {
    expect(errorsFor(UpdateDocumentDto, { title: null })).toEqual(['title']);
    expect(errorsFor(UpdateDocumentDto, { title: '' })).toEqual(['title']);
    expect(errorsFor(UpdateDocumentDto, { folder: 'x'.repeat(101) })).toEqual([
      'folder',
    ]);
  });
});

describe('MoveDocumentsDto', () => {
  const ids = ['0a000000-0000-4000-8000-0000000000a0'];

  it('takes document ids and a folder or null', () => {
    expect(
      errorsFor(MoveDocumentsDto, { document_ids: ids, folder: 'Rush' }),
    ).toEqual([]);
    expect(
      errorsFor(MoveDocumentsDto, { document_ids: ids, folder: null }),
    ).toEqual([]);
  });

  it('needs the folder said out loud, and real ids, at least one', () => {
    expect(errorsFor(MoveDocumentsDto, { document_ids: ids })).toEqual([
      'folder',
    ]);
    expect(
      errorsFor(MoveDocumentsDto, { document_ids: ['nope'], folder: null }),
    ).toEqual(['document_ids']);
    expect(
      errorsFor(MoveDocumentsDto, { document_ids: [], folder: null }),
    ).toEqual(['document_ids']);
  });
});
