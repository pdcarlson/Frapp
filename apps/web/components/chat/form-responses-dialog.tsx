"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExportMenu } from "@/components/shared/export-menu";
import { NestedError, NestedLoading } from "@/components/shared/nested-states";
import {
  meterFillClassName,
  meterTrackDenseClassName,
} from "@/components/shared/meter";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@repo/chat-core/types";
import { formDeadlineLine, readFormPayload } from "@repo/chat-core/forms";
import {
  VIEW_RESPONSES_LABEL,
  cardExportFilenamePrefix,
  fetchFormResponses,
  formAnswerText,
  formChoicePercent,
  formNotRespondedLabel,
  formQuestionAnsweredLine,
  formResponsesCountLine,
  formResponsesExportRows,
  formResponsesKey,
  summarizeFormResponses,
  type FormResponses,
  type MemberLabel,
} from "@repo/chat-core/form-responses";
import type { FormPayload } from "@repo/chat-core/forms";
import {
  actorLabel,
  useFrappClient,
  useNow,
  type NameResolver,
} from "@repo/hooks";

interface OpenResponses {
  message: ChatMessage;
  nameFor: NameResolver;
}

interface FormResponsesApi {
  open: (message: ChatMessage, nameFor: NameResolver) => void;
  /** Swaps in a newer copy of the open form's row; ignores any other. */
  refresh: (message: ChatMessage) => void;
}

const FormResponsesContext = createContext<FormResponsesApi | null>(null);

/**
 * How a form card opens its responses: the host's opener, or `null` outside
 * one (a surface that draws a card without the chat shell), where the card
 * opens its own.
 */
export function useOpenFormResponses(): FormResponsesApi["open"] | null {
  return useContext(FormResponsesContext)?.open ?? null;
}

/**
 * Keeps the host's open responses on the card's live row, so a delete that
 * reaches the timeline reaches the open view too.
 */
export function useSyncOpenFormResponses(message: ChatMessage) {
  const refresh = useContext(FormResponsesContext)?.refresh;
  useEffect(() => {
    refresh?.(message);
  }, [refresh, message]);
}

/**
 * Hosts the Responses view once for the chat shell, beside `FormFillHost`
 * and for the same reason: the timeline is virtualized, so a card that
 * scrolls out of its window (a new message arriving is enough) unmounts, and
 * a dialog the card owned would close while its creator is reading.
 */
export function FormResponsesHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenResponses | null>(null);
  const api = useMemo<FormResponsesApi>(
    () => ({
      open: (message, nameFor) => setOpen({ message, nameFor }),
      refresh: (next) =>
        setOpen((current) =>
          current && current.message.id === next.id
            ? { ...current, message: next }
            : current,
        ),
    }),
    [],
  );
  return (
    <FormResponsesContext.Provider value={api}>
      {children}
      <FormResponsesDialog
        message={open?.message ?? null}
        nameFor={open?.nameFor ?? noNames}
        onOpenChange={(next) => {
          if (!next) setOpen(null);
        }}
      />
    </FormResponsesContext.Provider>
  );
}

const noNames: NameResolver = () => null;

/**
 * A form's responses, for the member who posted it (#3926 step 4), as Google
 * Forms' Responses tab shows its owner: a **Summary** per question (each
 * option's count with a bar, each text answer listed), an **Individual** list
 * of each person's answers, who hasn't answered yet, and **Export** (CSV,
 * Excel or Copy for Google Sheets, through the dashboard's `ExportMenu`).
 * Only the creator gets here: the card offers it to them alone
 * (`isFormCreator`), and the API refuses anyone else.
 *
 * Names are the label each member has everywhere else (`actorLabel`): the
 * roster name, or the shared "Member 2f4a1c" fallback for someone it can't
 * name, so an unnamed member is never shown as one who left.
 *
 * Read fresh on every open (no `staleTime`), since answers keep arriving and
 * nothing pushes them: the table isn't in the Realtime publication.
 */
export function FormResponsesDialog({
  message,
  nameFor,
  onOpenChange,
}: {
  /** The form card, or `null` when closed. */
  message: ChatMessage | null;
  nameFor: NameResolver;
  onOpenChange: (open: boolean) => void;
}) {
  const payload = useMemo(
    () => (message ? readFormPayload(message) : null),
    [message],
  );
  // A form deleted while its responses are open has nothing left to show.
  const live = !!message && !!payload && !message.is_deleted;
  return (
    <Dialog open={live} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(100dvh,56rem)] max-h-[100dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:rounded-none">
        {live && message && payload ? (
          <ResponsesBody
            key={message.id}
            messageId={message.id}
            payload={payload}
            nameFor={nameFor}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ResponsesBody({
  messageId,
  payload,
  nameFor,
}: {
  messageId: string;
  payload: FormPayload;
  nameFor: NameResolver;
}) {
  const apiClient = useFrappClient();
  const now = useNow();
  const deadline = formDeadlineLine(payload, now);
  const query = useQuery({
    queryKey: formResponsesKey(messageId),
    queryFn: () => fetchFormResponses(apiClient, messageId),
    refetchOnMount: "always",
  });
  const data = query.data;
  const count = data?.responses.length ?? 0;
  const labelOf: MemberLabel = (id) => actorLabel(id, nameFor) ?? "A member";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-6 pb-4 pt-6">
        <p className="text-caption text-muted-foreground">
          {VIEW_RESPONSES_LABEL}
          {deadline ? ` · ${deadline}` : ""}
        </p>
        <DialogTitle className="mt-1 pr-8 text-title font-bold">
          {payload.title}
        </DialogTitle>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <DialogDescription>
            {data ? formResponsesCountLine(count) : "Loading responses…"}
          </DialogDescription>
          <ExportMenu
            label="Export"
            size="sm"
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
            filenamePrefix={cardExportFilenamePrefix("form", payload.title)}
            disabled={count === 0}
            getRows={() =>
              data
                ? formResponsesExportRows(payload, data.responses, labelOf)
                : []
            }
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        {data ? (
          <ResponsesTabs payload={payload} data={data} labelOf={labelOf} />
        ) : query.isPending ? (
          <NestedLoading message="Loading responses…" sole />
        ) : (
          <NestedError
            sole
            title="Couldn't load the responses"
            description={
              query.error?.message ?? "Check your connection and try again."
            }
            onRetry={() => void query.refetch()}
          />
        )}
      </div>
    </div>
  );
}

function ResponsesTabs({
  payload,
  data,
  labelOf,
}: {
  payload: FormPayload;
  data: FormResponses;
  labelOf: MemberLabel;
}) {
  const summary = useMemo(
    () => summarizeFormResponses(payload, data.responses),
    [payload, data.responses],
  );
  const total = data.responses.length;
  return (
    <>
      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="individual">Individual</TabsTrigger>
        </TabsList>
        <TabsContent value="summary">
          {total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No one has answered yet.
            </p>
          ) : (
            <ol className="mt-4 space-y-6">
              {summary.map(({ question, answered, choices, texts }, index) => (
                <li key={question.id}>
                  <p className="text-base font-bold">
                    {index + 1}. {question.title}
                  </p>
                  <p className="text-caption text-muted-foreground">
                    {formQuestionAnsweredLine(answered, total)}
                  </p>
                  {choices ? (
                    <ul className="mt-2 space-y-2">
                      {choices.map((choice) => {
                        const percent = formChoicePercent(
                          choice.count,
                          answered,
                        );
                        return (
                          <li key={choice.id}>
                            <div className="flex justify-between gap-3 text-sm">
                              <span>{choice.label}</span>
                              <span className="tabular-nums text-muted-foreground">
                                {choice.count} · {percent}%
                              </span>
                            </div>
                            <div
                              className={cn(meterTrackDenseClassName, "mt-1")}
                              aria-hidden="true"
                            >
                              <div
                                className={meterFillClassName}
                                style={{ width: `${percent}%` }}
                              />
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : texts && texts.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {texts.map((text, i) => (
                        <li
                          key={i}
                          className="whitespace-pre-wrap rounded-md bg-card-hover px-3 py-2 text-sm"
                        >
                          {text}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="individual">
          {total === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No one has answered yet.
            </p>
          ) : (
            <ul className="mt-4 space-y-4">
              {data.responses.map((response) => (
                <li
                  key={response.user_id}
                  className="rounded-lg border border-border p-4"
                >
                  <p className="text-base font-bold">
                    {labelOf(response.user_id)}
                  </p>
                  <dl className="mt-2 space-y-2">
                    {payload.questions.map((question, index) => {
                      const text = formAnswerText(
                        question,
                        response.answers[question.id],
                      );
                      return (
                        <div key={question.id}>
                          <dt className="text-caption text-muted-foreground">
                            {index + 1}. {question.title}
                          </dt>
                          <dd
                            className={cn(
                              "whitespace-pre-wrap text-sm",
                              !text && "text-muted-foreground",
                            )}
                          >
                            {text || "No answer"}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
      {data.not_responded.length > 0 ? (
        <section className="mt-8">
          <h3 className="text-base font-bold">
            {formNotRespondedLabel(data.not_responded.length)}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {data.not_responded.map(labelOf).join(", ")}
          </p>
        </section>
      ) : null}
    </>
  );
}
