"use client";

import { createContext, memo, useContext, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import { isSafeHref } from "@repo/chat-core/links";
import {
  MESSAGE_RENDER_ELEMENTS,
  layOutMessageBody,
  remarkDepthCap,
  remarkMentionChips,
  skipsMarkdownParse,
  type HastNode,
} from "@repo/chat-core/markdown";
import { MENTION_CHIP, MENTION_CHIP_BUTTON } from "../chip";
import { cn } from "@/lib/utils";

/**
 * Who an `@` chip opens, given the token it carries (`data-mention`): a click
 * handler that opens that member's profile, or `null` for a chip that names
 * no single member (a role mention, or a member the message didn't notify).
 * `MessageItem` provides it per row, resolving against that message's own
 * server-resolved `mentions` (`mentionedUserId` in `@repo/chat-core`, #3726).
 * Outside a row, or with no profile sheet above it, it is `null` and every
 * chip stays plain text.
 *
 * A context rather than a prop so `MessageMarkdown` stays memoized on
 * `content`: the renderers between the row and this body need not thread it.
 */
export const MentionOpenerContext = createContext<
  ((token: string) => (() => void) | null) | null
>(null);

/**
 * One chip: the `<mark>` the plugin built, which paints it. A chip that opens
 * a profile holds a `<button>` inside the mark, so it is reached by Tab and
 * pressed by Enter or Space, while the mark keeps painting the same box: a
 * button is an inline-block whose fill would cover the whole 25px line,
 * standing taller than the chips beside it (seen in the browser, #3726). The
 * row's own tap handler already ignores a click inside a button.
 */
function MentionChip({
  className,
  token,
  children,
}: {
  className?: string;
  token: string | null;
  children?: ReactNode;
}) {
  const resolve = useContext(MentionOpenerContext);
  const open = resolve && token ? resolve(token) : null;
  return (
    <mark className={className} data-mention={token ?? undefined}>
      {open ? (
        <button
          type="button"
          aria-haspopup="dialog"
          className={MENTION_CHIP_BUTTON}
          onClick={open}
        >
          {children}
        </button>
      ) : (
        children
      )}
    </mark>
  );
}

/** The token a chip element carries, as react-markdown hands it over. */
function chipToken(props: Record<string, unknown>): string | null {
  const value = props["data-mention"];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The formatting set plus the mention chip (`MESSAGE_RENDER_ELEMENTS`). */
const ALLOWED_ELEMENTS = MESSAGE_RENDER_ELEMENTS;
const ALLOWED: ReadonlySet<string> = new Set(ALLOWED_ELEMENTS);

/**
 * The body's line structure, shared with mobile (`markdown-flow.ts` in
 * `@repo/chat-core`). It writes every break out as `"\n"` exactly once, and
 * the body draws as one inline flow under `pre-wrap`: paragraphs are inline
 * and a code block is an inline-block that fills the width. Left as hast
 * builds it, a `<br>` was followed by a `"\n"` that `pre-wrap` drew as a
 * second break, and the separators around an unwrapped list or quote drew as
 * empty lines (#2934).
 *
 * When the body ends in a code block, a list or a quote, it ends with a
 * `"\n"`, which puts `TextRenderer`'s trailing markers on a line of their own
 * under it (`components.md` §11 § What rides the row). With no markers after
 * it, a closing newline draws no extra line.
 */
function rehypeMessageFlow({ source }: { source: string }) {
  return (root: HastNode): void => {
    const { children, endsOnOwnLine } = layOutMessageBody(root.children ?? [], {
      allowed: ALLOWED,
      source,
    });
    if (endsOnOwnLine && children.length > 0) {
      children.push({ type: "text", value: "\n" });
    }
    root.children = children;
  };
}

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
export const MessageMarkdown = memo(function MessageMarkdown({
  content,
  chips,
}: {
  content: string;
  /** Which `@`-tokens really pinged someone (`useMentionChips`); all when left out. */
  chips?: (token: string) => boolean;
}) {
  // Decided from the source, before remark sees it: a body remark would take
  // seconds to parse renders as its raw text instead. See `skipsMarkdownParse`
  // (#2209, #2664).
  const flatten = skipsMarkdownParse(content);
  return (
    <ReactMarkdown
      // The depth cap goes first: every pass after it recurses once per
      // nesting level, so it has to see the tree before any of them do. See
      // `markdown-depth-cap.ts` in `@repo/chat-core` (#2209).
      //
      // The mention plugin needs the RAW body, not the decoded text remark
      // hands it — `&#64;Jane` is a mention to the renderer and to nobody
      // else. See `markdown-mentions.ts` in `@repo/chat-core`.
      remarkPlugins={[
        [remarkDepthCap, { content, flatten }],
        remarkBreaks,
        [
          remarkMentionChips,
          { content, chips, properties: { className: MENTION_CHIP } },
        ],
      ]}
      // Last, so it lays out the tree that renders.
      // `source` is the string remark parses, which the positions index into.
      rehypePlugins={[[rehypeMessageFlow, { source: flatten ? "" : content }]]}
      allowedElements={ALLOWED_ELEMENTS}
      unwrapDisallowed
      components={{
        p: ({ children }) => <p className="m-0 inline">{children}</p>,
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
                  "inline-block w-full overflow-x-auto whitespace-pre rounded-md bg-black/15 px-3 py-2 align-top font-mono text-sm",
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
        mark: ({ className, children, ...rest }) => (
          <MentionChip
            className={className}
            token={chipToken(rest as Record<string, unknown>)}
          >
            {children}
          </MentionChip>
        ),
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
