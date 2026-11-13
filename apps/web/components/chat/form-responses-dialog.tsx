"use client";

import { useMemo } from "react";
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
  responderName,
  summarizeFormResponses,
  type FormResponses,
} from "@repo/chat-core/form-responses";
import type { FormPayload } from "@repo/chat-core/forms";
import { useFrappClient, useNow, type NameResolver } from "@repo/hooks";

/**
 * A form's responses, for the member who posted it (#3926 step 4), as Google
 * Forms' Responses tab shows its owner: a **Summary** per question (each
 * option's count with a bar, each text answer listed), an **Individual** list
 * of each person's answers, who hasn't answered yet, and **Export** (CSV,
 * Excel or Copy for Google Sheets, through the dashboard's `ExportMenu`).
 * Only the creator gets here: the card offers it to them alone
 * (`isFormCreator`), and the API refuses anyone else.
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
  return (
    <Dialog open={!!message && !!payload} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(100dvh,56rem)] max-h-[100dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0 max-sm:rounded-none">
        {message && payload ? (
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
                ? formResponsesExportRows(payload, data.responses, nameFor)
                : []
            }
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        {data ? (
          <ResponsesTabs payload={payload} data={data} nameFor={nameFor} />
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
  nameFor,
}: {
  payload: FormPayload;
  data: FormResponses;
  nameFor: NameResolver;
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
                          className="whitespace-pre-wrap rounded-md bg-muted px-3 py-2 text-sm"
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
                    {responderName(response.user_id, nameFor)}
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
            {data.not_responded
              .map((id) => responderName(id, nameFor))
              .join(", ")}
          </p>
        </section>
      ) : null}
    </>
  );
}
