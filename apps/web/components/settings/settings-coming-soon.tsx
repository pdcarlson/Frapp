import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Placeholder panel for settings tabs whose internals ship in a later chunk
 * (Theme/Roles/Fields/Workflows/Dues in Chunk 07; Beta/Audit in Chunk 08).
 * The rail entry stays visible so the full information architecture is legible,
 * but the tab states clearly that it is not yet wired.
 */
export function SettingsComingSoon({
  title,
  description,
  chunk,
}: {
  title: string;
  description: string;
  chunk: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Ships in <span className="font-medium text-foreground">{chunk}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
