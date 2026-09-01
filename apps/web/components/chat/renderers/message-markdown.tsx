"use client";

import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";

const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto"]);

/**
 * A markdown link's `href` is user-typed text, not a vetted URL —
 * `[text](javascript:alert(1))` parses to a real anchor with that href.
 * react-markdown never renders raw HTML, but it does not vet link schemes,
 * so that check is this component's job. A schemeless href (`example.com`,
 * `/path`) is left alone: it resolves relative to this site, which is not
 * an injection vector, just a link that likely doesn't go where the sender
 * meant.
 */
function isSafeHref(href: string): boolean {
  const scheme = /^([a-zA-Z][a-zA-Z\d+.-]*):/.exec(href)?.[1];
  return scheme === undefined || SAFE_URL_SCHEMES.has(scheme.toLowerCase());
}

/**
 * `spec/behavior/chat/README.md`'s "Text formatting" set, and nothing wider:
 * bold, italic, inline code, code blocks, links. Restricted to this element
 * list rather than CommonMark's full default — headings, lists, blockquotes,
 * images and tables aren't part of the spec'd set, and a message that opens
 * with `# ` shouldn't blow a chat bubble up into a heading. Disallowed
 * elements are unwrapped rather than dropped, so their text still shows.
 */
const ALLOWED_ELEMENTS = ["p", "strong", "em", "code", "pre", "a", "br"];

/**
 * The shared safe renderer for `message.content` — a fenced-off subset of
 * CommonMark rendered straight to React elements, never through
 * `dangerouslySetInnerHTML`. That is what makes it XSS-safe: react-markdown
 * has no code path from message text to raw HTML, so a message body can
 * carry `<script>` or an `onerror=` attribute verbatim and it renders as
 * inert text, not a tag. The one thing react-markdown does *not* vet on its
 * own is a link's scheme, which `isSafeHref` covers below.
 */
export function MessageMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkBreaks]}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p className="m-0">{children}</p>,
        a: ({ href, children }) => {
          if (!href || !isSafeHref(href)) {
            return <>{children}</>;
          }
          return (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {children}
            </a>
          );
        },
        // A fenced block's `code` can't be told apart from inline `` `code` ``
        // by tag alone — both dispatch here. Inline code cannot contain a
        // literal newline (the backtick span ends at the first one), so a
        // newline in the text is what a fenced block actually looks like.
        code: ({ children, className }) => {
          const isBlock = /\n/.test(String(children));
          if (isBlock) {
            return (
              <code
                className={cn(
                  "block overflow-x-auto whitespace-pre rounded-md bg-black/15 px-3 py-2 font-mono text-sm",
                  className,
                )}
              >
                {children}
              </code>
            );
          }
          return (
            <code className="rounded bg-black/15 px-1 py-0.5 font-mono text-[0.9em]">
              {children}
            </code>
          );
        },
        // The block-code wrapper's own styling lives on `code` above so the
        // inline and block cases share one visual language; `pre` would only
        // double the padding/background around it.
        pre: ({ children }) => <>{children}</>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
