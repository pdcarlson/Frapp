import { View } from "react-native";
import { LockGlyph } from "@/components/chat/card-glyphs";

// What a screen reader hears on a row not everyone can see, as on web.
export { LIMITED_LABEL } from "@repo/hooks/document-library";

/**
 * The quiet lock on a folder or file not everyone can see (#5216), the one
 * a private channel's row wears (`channel-row.tsx`) and web's Documents draws
 * beside the same name. Hidden from a screen reader: the row says it in its
 * value instead.
 */
export function LimitedMark({
  color,
  size = 14,
}: {
  color: string;
  size?: number;
}) {
  return (
    <View
      testID="document-limited"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <LockGlyph focused={false} accent={color} muted={color} size={size} />
    </View>
  );
}
