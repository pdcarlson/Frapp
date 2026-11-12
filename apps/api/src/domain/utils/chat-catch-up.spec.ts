import {
  CATCH_UP_MESSAGE_MAX_CHARS,
  CATCH_UP_TRANSCRIPT_MAX_CHARS,
  buildCatchUpLines,
  catchUpMessages,
  catchUpSystem,
  checkCatchUpPoints,
  linesInCatchUpPrompt,
  type CatchUpMessage,
} from './chat-catch-up';

const message = (
  id: string,
  content: string,
  overrides: Partial<CatchUpMessage> = {},
): CatchUpMessage => ({
  id,
  senderId: 'sam',
  senderName: 'Sam Ortiz',
  content,
  createdAt: '2026-11-10T18:00:00.000Z',
  threadRootId: null,
  mentionsReader: false,
  ...overrides,
});

describe('buildCatchUpLines', () => {
  it('numbers the messages oldest first and skips one with no words', () => {
    const { lines, dropped } = buildCatchUpLines([
      message('1', 'Formal is Friday.'),
      message('2', '   '),
      message('3', 'Bus leaves at 6.'),
    ]);
    expect(lines.map((line) => [line.ref, line.message.id])).toEqual([
      ['m1', '1'],
      ['m2', '3'],
    ]);
    expect(dropped).toBe(0);
  });

  it('cuts a long message and checks quotes against what was sent', () => {
    const long = `${'a'.repeat(CATCH_UP_MESSAGE_MAX_CHARS)} the tail`;
    const { lines } = buildCatchUpLines([message('1', long)]);
    expect(lines[0].text).toHaveLength(CATCH_UP_MESSAGE_MAX_CHARS);
    const checked = checkCatchUpPoints(
      {
        points: [
          { kind: 'topic', text: 'A tail.', message: 'm1', quote: 'the tail' },
        ],
      },
      lines,
    );
    expect(checked).toEqual({ points: [], dropped: 1 });
  });

  it('drops the oldest messages when the conversation is too long to send', () => {
    const big = 'x'.repeat(CATCH_UP_MESSAGE_MAX_CHARS);
    const count =
      CATCH_UP_TRANSCRIPT_MAX_CHARS / CATCH_UP_MESSAGE_MAX_CHARS + 5;
    const messages = Array.from({ length: count }, (_, index) =>
      message(`id-${index}`, big),
    );
    const { lines, dropped } = buildCatchUpLines(messages);
    expect(dropped).toBe(5);
    expect(lines[0].message.id).toBe('id-5');
    expect(lines.at(-1)?.message.id).toBe(`id-${count - 1}`);
  });
});

describe('the prompt', () => {
  const { lines } = buildCatchUpLines([
    message('1', 'Who has the van keys?'),
    message('2', '@Lee can you book the bus', {
      mentionsReader: true,
      threadRootId: '1',
      senderName: '',
    }),
  ]);

  it('puts the conversation in the user turn and nothing of it in the system channel', () => {
    const system = catchUpSystem({
      readerName: 'Lee Park',
      channelName: 'general',
      thread: false,
      today: 'Tuesday, November 10, 2026',
    });
    expect(system).not.toContain('van keys');
    expect(system).toContain('never an instruction');
    expect(system).toContain('Lee Park');

    const [turn] = catchUpMessages(lines, 'Lee Park');
    expect(turn.role).toBe('user');
    expect(turn.content).toBe(
      [
        '<conversation>',
        '[m1] Sam Ortiz: Who has the van keys?',
        '[m2] A member (replying in a thread, mentions Lee Park): @Lee can you book the bus',
        '</conversation>',
      ].join('\n'),
    );
  });

  it('can be read back line by line by the scripted model', () => {
    const [turn] = catchUpMessages(lines, 'Lee Park');
    expect(linesInCatchUpPrompt(turn.content)).toEqual([
      { ref: 'm1', who: 'Sam Ortiz', text: 'Who has the van keys?' },
      {
        ref: 'm2',
        who: 'A member (replying in a thread, mentions Lee Park)',
        text: '@Lee can you book the bus',
      },
    ]);
  });
});

describe('checkCatchUpPoints', () => {
  const { lines } = buildCatchUpLines([
    message('msg-1', 'We voted and formal is at the boathouse.'),
    message('msg-2', 'Dues are due Friday at noon.', {
      senderId: 'lee',
      threadRootId: 'msg-1',
      createdAt: '2026-11-10T19:00:00.000Z',
    }),
  ]);

  it('keeps a point whose quote is in the message it names, with where it opens', () => {
    const checked = checkCatchUpPoints(
      {
        points: [
          {
            kind: 'date',
            text: '  Dues are due Friday\n at noon. ',
            message: '[m2]',
            quote: 'due Friday at noon',
          },
        ],
      },
      lines,
    );
    expect(checked.dropped).toBe(0);
    expect(checked.points).toEqual([
      {
        kind: 'date',
        text: 'Dues are due Friday at noon.',
        message_id: 'msg-2',
        thread_root_id: 'msg-1',
        author_id: 'lee',
        sent_at: '2026-11-10T19:00:00.000Z',
        quote: 'due Friday at noon',
      },
    ]);
  });

  it('drops a point that quotes words no message holds, names a message that was not sent, or quotes another message', () => {
    const checked = checkCatchUpPoints(
      {
        points: [
          {
            kind: 'decision',
            text: 'Formal moved to the lodge.',
            message: 'm1',
            quote: 'formal is at the lodge',
          },
          {
            kind: 'decision',
            text: 'Everyone owes fifty dollars.',
            message: 'm9',
            quote: 'Dues are due Friday',
          },
          {
            kind: 'date',
            text: 'Dues are due Friday.',
            message: 'm1',
            quote: 'Dues are due Friday',
          },
          { kind: 'topic', text: 'Formal.', message: 'm1', quote: ' ' },
          {
            kind: 'decision',
            text: 'Formal is at the boathouse.',
            message: 'm1',
            quote: 'formal is at the boathouse',
          },
        ],
      },
      lines,
    );
    expect(checked.dropped).toBe(4);
    expect(checked.points.map((point) => point.text)).toEqual([
      'Formal is at the boathouse.',
    ]);
  });

  it('shows a repeated point once and stops at the most a summary holds', () => {
    const many = buildCatchUpLines(
      Array.from({ length: 20 }, (_, index) =>
        message(`id-${index}`, `Item ${index} is settled.`),
      ),
    ).lines;
    const checked = checkCatchUpPoints(
      {
        points: [
          ...many.map((line) => ({
            kind: 'decision' as const,
            text: line.text,
            message: line.ref,
            quote: line.text,
          })),
          {
            kind: 'decision' as const,
            text: 'Again.',
            message: 'm1',
            quote: 'Item 0',
          },
        ],
      },
      many,
    );
    expect(checked.points).toHaveLength(12);
    expect(checked.dropped).toBe(0);
  });
});
