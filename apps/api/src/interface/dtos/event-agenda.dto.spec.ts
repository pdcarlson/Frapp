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

  it('takes an item sent back with its tabled_from, or with null (#5534)', async () => {
    const tabled_from = {
      meeting_id: '0a000000-0000-4000-8000-0000000005a1',
      start_time: '2026-11-11T23:00:00+00:00',
      times: 2,
    };
    expect(
      await errorsOn(UpdateEventDto, {
        agenda: [
          { id: 'a1', text: 'Formal budget', done: false, tabled_from },
          { id: 'a2', text: 'Dues', done: false, tabled_from: null },
        ],
      }),
    ).toEqual([]);
    expect(
      await errorsOn(UpdateEventDto, {
        agenda: [
          {
            id: 'a1',
            text: 'Formal budget',
            done: false,
            tabled_from: { ...tabled_from, times: 0 },
          },
        ],
      }),
    ).toContain('agenda');
  });
});
