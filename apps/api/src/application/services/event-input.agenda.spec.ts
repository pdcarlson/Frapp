import { keepAgendaTabledFrom, normalizeAgenda } from './event-input';

const FROM = {
  meeting_id: '0a000000-0000-4000-8000-0000000005a1',
  start_time: '2026-11-11T23:00:00+00:00',
  times: 1,
};

/**
 * An agenda item's `tabled_from` (#5534) is the server's: a save keeps it
 * by the item's id and never takes it from the client.
 */
describe('keepAgendaTabledFrom', () => {
  it('keeps the stored origin for the same id, whatever is sent', () => {
    const sent = normalizeAgenda([
      // A shipped phone build sends no key at all.
      { id: 'a1', text: 'Formal budget', done: true },
      // A client can't point an item at other minutes.
      {
        id: 'a2',
        text: 'Dues',
        done: false,
        tabled_from: { ...FROM, meeting_id: 'someone-elses' },
      },
    ]);
    expect(
      keepAgendaTabledFrom(sent ?? [], [
        { id: 'a1', text: 'Formal budget', done: false, tabled_from: FROM },
        { id: 'a2', text: 'Dues', done: false },
      ]),
    ).toEqual([
      { id: 'a1', text: 'Formal budget', done: true, tabled_from: FROM },
      { id: 'a2', text: 'Dues', done: false },
    ]);
  });

  it('drops a stored origin that is not one', () => {
    expect(
      keepAgendaTabledFrom(
        [{ id: 'a1', text: 'Formal budget', done: false }],
        [
          {
            id: 'a1',
            text: 'Formal budget',
            done: false,
            tabled_from: { ...FROM, times: 0 },
          },
        ],
      ),
    ).toEqual([{ id: 'a1', text: 'Formal budget', done: false }]);
  });
});
