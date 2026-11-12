import { ForbiddenException } from '@nestjs/common';
import { aiConsentRefusal } from './ai-consent-refusal';

describe('aiConsentRefusal', () => {
  it('asks for the sheet when the member has not said yes', () => {
    const error = aiConsentRefusal('member_declined');
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'ai.consent.required' });
  });

  it('says the feature is off when the chapter has not turned it on', () => {
    const error = aiConsentRefusal('chapter_off');
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'ai.chapter_off' });
  });
});
