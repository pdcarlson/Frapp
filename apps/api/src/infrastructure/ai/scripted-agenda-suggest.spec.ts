import { agendaSuggestMessages } from '#domain/utils/agenda-suggestions';
import { scriptedAgendaSuggest } from './scripted-agenda-suggest';

describe('scriptedAgendaSuggest', () => {
  it('suggests from the last meeting’s open items, reports and topics', () => {
    const messages = agendaSuggestMessages({
      event: {
        name: 'Cabinet',
        type: null,
        day: 'Tuesday, 2026-11-25',
        description: null,
      },
      audience: { required: [], invited: [], leftOut: [], everyoneElse: true },
      agenda: [],
      tabled: [],
      minutes: [
        {
          ref: 'M1',
          meetingId: 'm1',
          name: 'Cabinet',
          day: 'Tuesday, 2026-11-18',
          gist: '',
          topics: ['Philanthropy'],
          openItems: ['Book the venue'],
          reports: ['Treasurer'],
        },
      ],
      examples: { added: [], dismissed: [] },
    });
    const reply = scriptedAgendaSuggest({
      kind: 'structured',
      messages,
    } as never);
    expect('object' in reply ? reply.object : null).toEqual({
      items: [
        {
          text: 'Check in: Book the venue',
          reason: 'Still open from the last meeting',
          minutes: 'M1',
        },
        {
          text: 'Treasurer report',
          reason: 'Given at the last meeting',
          minutes: 'M1',
        },
        {
          text: 'Follow up: Philanthropy',
          reason: 'Discussed at the last meeting',
          minutes: 'M1',
        },
      ],
    });
  });
});
