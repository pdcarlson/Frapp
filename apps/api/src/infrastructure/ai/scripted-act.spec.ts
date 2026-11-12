import type { LanguageModelRequest } from '#domain/adapters/language-model.interface';
import { scriptedActMatch, scriptedActPlan } from './scripted-act';

const ACTIONS = ['give_points', 'create_task', 'create_event'];

function planFor(request: string, offered: string[] = ACTIONS) {
  const reply = scriptedActPlan({
    system: 'Today is 2026-11-12, Thursday, November 12, 2026.',
    messages: [
      {
        role: 'user',
        content: [
          `Request: ${request}`,
          '',
          'Actions:',
          ...offered.map((name) => `- ${name}: does a thing`),
        ].join('\n'),
      },
    ],
  } as unknown as LanguageModelRequest);
  return (reply as { object: Record<string, unknown> }).object;
}

describe('the scripted acting agent', () => {
  it("reads the panel's three examples", () => {
    expect(
      planFor('Give 5 points to everyone who came to chapter tonight'),
    ).toMatchObject({
      action: 'give_points',
      amount: 5,
      everyone_who_attended: true,
      event_name: 'chapter',
      date: '2026-11-12',
    });
    expect(
      planFor('Make a task for Jordan to book the bus by Friday'),
    ).toMatchObject({
      action: 'create_task',
      people: ['Jordan'],
      title: 'book the bus',
      date: '2026-11-13',
    });
    expect(
      planFor('Put a study night on the calendar for Tuesday at 7'),
    ).toMatchObject({
      action: 'create_event',
      title: 'study night',
      date: '2026-11-17',
      start_time: '19:00',
    });
  });

  it('reads named members, a reason and points taken away', () => {
    expect(
      planFor('Give 10 points to Jordan and Sam for setting up'),
    ).toMatchObject({
      action: 'give_points',
      amount: 10,
      people: ['Jordan', 'Sam'],
      title: 'setting up',
    });
    expect(
      planFor('Take 5 points from Jordan for missing cleanup'),
    ).toMatchObject({
      amount: -5,
      people: ['Jordan'],
      title: 'missing cleanup',
    });
  });

  it('picks nothing it was not offered, and nothing for a question', () => {
    expect(
      planFor('Give 5 points to Jordan for x', ['create_task']),
    ).toMatchObject({
      action: 'none',
    });
    expect(planFor('When is formal?')).toMatchObject({ action: 'none' });
  });

  it('matches a short name to the one member it starts', () => {
    const reply = scriptedActMatch({
      messages: [
        {
          role: 'user',
          // The shape `actMatchMessage` writes.
          content: [
            'Names:',
            '- Jake',
            '- Sam',
            '- Zed',
            '',
            'Members:',
            '1. Jake Miller',
            '2. Jakob Stone',
            '3. Samuel Ortiz',
          ].join('\n'),
        },
      ],
    } as unknown as LanguageModelRequest);
    expect((reply as { object: unknown }).object).toEqual({
      matches: [
        { name: 'Jake', member: null },
        { name: 'Sam', member: 3 },
        { name: 'Zed', member: null },
      ],
    });
  });
});
