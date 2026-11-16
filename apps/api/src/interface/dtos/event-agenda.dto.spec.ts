import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateEventDto } from './event.dto';

/**
 * The wire rule for an event's agenda and attachments (#4934): omitted leaves
 * the list, `[]` clears it, and `null` is refused here rather than reaching
 * the service as a value it can't read.
 */
describe('event DTOs: agenda and attachments', () => {
  const errorsOn = async (dto: typeof UpdateEventDto, body: object) =>
    (await validate(plainToInstance(dto, body))).map((e) => e.property);

  it.each(['agenda', 'attachments'])('refuses %s: null', async (field) => {
    expect(await errorsOn(UpdateEventDto, { [field]: null })).toContain(field);
  });

  it('takes an empty list, and leaves an omitted one alone', async () => {
    expect(
      await errorsOn(UpdateEventDto, { agenda: [], attachments: [] }),
    ).toEqual([]);
    expect(await errorsOn(UpdateEventDto, {})).toEqual([]);
  });

  it('checks each entry', async () => {
    expect(
      await errorsOn(UpdateEventDto, {
        agenda: [{ id: 'a1', text: 'x'.repeat(201), done: false }],
        attachments: [{ id: 'x1', kind: 'file', title: 'T' }],
      }),
    ).toEqual(expect.arrayContaining(['agenda', 'attachments']));
    expect(
      await errorsOn(UpdateEventDto, {
        attachments: [{ id: 'x1', kind: 'document', title: 'T' }],
      }),
    ).toContain('attachments');
  });

  it('refuses more items than the limits', async () => {
    const agenda = Array.from({ length: 31 }, (_, i) => ({
      id: `a${i}`,
      text: 'Item',
      done: false,
    }));
    expect(await errorsOn(UpdateEventDto, { agenda })).toContain('agenda');
  });
});
