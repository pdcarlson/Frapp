"use client";

import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { isSafeHref } from "@repo/chat-core/links";
import {
  MESSAGE_MARKDOWN_ELEMENTS,
  opensTooManyContainers,
  remarkDepthCap,
} from "@repo/chat-core/markdown";
import { remarkMentionChips } from "./remark-mention-chips";
import { cn } from "@/lib/utils";

/**
 * `spec/behavior/chat/README.md`'s "Text formatting" set, shared with mobile
 * (`MESSAGE_MARKDOWN_ELEMENTS` says what it holds and why), plus `mark`.
 *
 * `mark` is **not** part of that authored set: no CommonMark syntax produces
 * one and raw HTML is never parsed, so the only thing that can emit a `mark`
 * here is `remarkMentionChips` below. Leaving it off the list would unwrap
 * every mention chip back to plain text — the allowlist is applied after the
 * plugins run, not to the source.
 */
const ALLOWED_ELEMENTS = [...MESSAGE_MARKDOWN_ELEMENTS, "mark"];

/**
 * The shared safe renderer for `message.content` — a fenced-off subset of
 * CommonMark rendered straight to React elements, never through
 * `dangerouslySetInnerHTML`. That is what makes it XSS-safe: react-markdown
 * has no code path from message text to raw HTML, so a message body can
 * carry `<script>` or an `onerror=` attribute verbatim and it renders as
 * inert text, not a tag. The one thing react-markdown does *not* vet on its
 * own is a link's scheme, which `isSafeHref` covers below. It lives in
 * `@repo/chat-core/links` because mobile's tappable links read the same rule
 * (#2775); its docblock says what it blocks and why.
 *
 * **Memoized on `content`.** Nothing above this memoizes a timeline row, so
 * without it every re-render of the timeline parsed every visible message
 * again. The parse is linear for ordinary text but super-linear for some
 * adversarial bodies (#2209), so a message now costs its parse once per mount.
 */
export const MessageMarkdown = memo(function MessageMarkdown({ content }: { content: string }) {
  // Decided from the source, before remark sees it: a body that opens this
  // many containers on one line is one remark would take seconds to parse,
  // and it would render as raw text anyway. See `opensTooManyContainers`.
  const flatten = opensTooManyContainers(content);
  return (
    <ReactMarkdown
      // The depth cap goes first: every pass after it recurses once per
      // nesting level, so it has to see the tree before any of them do. See
      // `markdown-depth-cap.ts` in `@repo/chat-core` (#2209).
      //
      // The mention plugin needs the RAW body, not the decoded text remark
      // hands it — `&#64;Jane` is a mention to the renderer and to nobody
      // else. See `remark-mention-chips.ts`.
      remarkPlugins={[
        [remarkDepthCap, { content, flatten }],
        remarkBreaks,
        [remarkMentionChips, { content }],
      ]}
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
      {flatten ? "" : content}
    </ReactMarkdown>
  );
});
