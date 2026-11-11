import {
  MAX_TITLE_LENGTH,
  cleanPageTitle,
  headIsComplete,
  pageTitleFromHtml,
} from './page-title';

describe('page titles (#4187)', () => {
  describe('pageTitleFromHtml', () => {
    it('prefers og:title, as Google Forms names the form there', () => {
      const html = `<html><head><title>Google Forms</title>
        <meta property="og:title" content="5K volunteer shifts">
        </head><body></body></html>`;
      expect(pageTitleFromHtml(html)).toBe('5K volunteer shifts');
    });

    it('reads og:title with its attributes in either order and quote', () => {
      const html = `<meta content='Formal RSVP' name="og:title" />`;
      expect(pageTitleFromHtml(html)).toBe('Formal RSVP');
    });

    it('falls back to <title> and drops the product suffix', () => {
      expect(
        pageTitleFromHtml('<title>Spring dues - Google Sheets</title>'),
      ).toBe('Spring dues');
      expect(
        pageTitleFromHtml('<title>Rush BBQ | SignUpGenius.com</title>'),
      ).toBe('Rush BBQ');
      expect(pageTitleFromHtml('<title>Calendly - Olive Ramos</title>')).toBe(
        'Olive Ramos',
      );
    });

    it('decodes entities and collapses whitespace', () => {
      expect(
        pageTitleFromHtml(
          '<title>\n  Brothers &amp; Alumni&#39;s\n  Golf &#x2014; Sign-up </title>',
        ),
      ).toBe("Brothers & Alumni's Golf — Sign-up");
    });

    it('returns null for a page with no title', () => {
      expect(pageTitleFromHtml('<html><head></head></html>')).toBeNull();
    });
  });

  describe('cleanPageTitle', () => {
    it.each([
      ['Google’s sign-in for a private file', 'Sign in - Google Accounts'],
      ['a bare sign-in', 'Sign in'],
      ['Microsoft’s sign-in', 'Sign in to your account'],
      ['an access request', 'Google Drive: You need access'],
      ['a missing page', 'Page Not Found'],
      ['an HTTP error', '404. That’s an error.'],
      ['a status line', '403 Forbidden'],
      ['a closed form', 'This form is no longer accepting responses'],
      ['only the product', 'Microsoft Forms'],
      ['only the product, with the suffix', 'Google Forms'],
      ['Google’s placeholder', 'Untitled form'],
      ['nothing', '   '],
    ])('names nothing for %s', (_name, raw) => {
      expect(cleanPageTitle(raw)).toBeNull();
    });

    it.each([
      ['Sign-in sheet for chapter meeting'],
      ['Sign up for 5K volunteer shifts'],
      ['100 Days party RSVP'],
      ['2026 formal'],
    ])('keeps a real name that only looks like one: %s', (raw) => {
      expect(cleanPageTitle(raw)).toBe(raw);
    });

    it('drops control and bidirectional-override characters', () => {
      expect(
        cleanPageTitle(`Dues${String.fromCharCode(0x202e)} gnirps\u0007`),
      ).toBe('Dues gnirps');
    });

    it('caps a long title', () => {
      const title = cleanPageTitle('x'.repeat(500));
      expect(title).toHaveLength(MAX_TITLE_LENGTH);
      expect(title?.endsWith('…')).toBe(true);
    });
  });

  describe('headIsComplete', () => {
    it('is true once the head closes or the body starts', () => {
      expect(headIsComplete('<head><title>x</title>')).toBe(false);
      expect(headIsComplete('<head><title>x</title></head>')).toBe(true);
      expect(headIsComplete('<title>x</title><body class="a">')).toBe(true);
    });
  });
});
