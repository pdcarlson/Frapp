import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, Matches } from 'class-validator';
import {
  ACTIVITY_CARD_KEY_PATTERN,
  ACTIVITY_LAYOUT_MAX_KEYS,
} from '@repo/validation';

const KEY_RULE = `Lower-case words joined by hyphens, at most 32 characters (${ACTIVITY_CARD_KEY_PATTERN.source}). Any such key is stored, not only the cards this server knows, so a newer app can save a card the server was built before.`;

/**
 * A member's own arrangement of their Activity cards (#5520), as
 * `GET` and `PUT /v1/activity/layout` return it. The rule is
 * `spec/behavior/activity.md` § Cards.
 */
export class ActivityLayoutDto {
  @ApiProperty({
    type: [String],
    description:
      'The cards the member shows, top to bottom. Empty when nothing is saved.',
    example: ['todo', 'calendar', 'recap'],
  })
  card_order: string[];

  @ApiProperty({
    type: [String],
    description: 'The cards the member hid. Empty when nothing is saved.',
    example: ['links'],
  })
  hidden_cards: string[];

  @ApiProperty({
    description:
      "Whether the member has saved an arrangement. False means show the default for the member's role. A card the app knows that neither list names is placed as that default places it; a key the app doesn't know is skipped.",
  })
  saved: boolean;
}

/**
 * Replace the member's arrangement. Both lists are sent whole. A key may
 * appear only once across both lists; the service refuses a repeat.
 */
export class UpdateActivityLayoutDto {
  @ApiProperty({
    type: [String],
    maxItems: ACTIVITY_LAYOUT_MAX_KEYS,
    description: `The cards to show, top to bottom. ${KEY_RULE}`,
    example: ['todo', 'calendar', 'recap'],
  })
  @IsArray()
  @ArrayMaxSize(ACTIVITY_LAYOUT_MAX_KEYS)
  @IsString({ each: true })
  @Matches(ACTIVITY_CARD_KEY_PATTERN, { each: true })
  card_order: string[];

  @ApiProperty({
    type: [String],
    maxItems: ACTIVITY_LAYOUT_MAX_KEYS,
    description: `The cards to hide. ${KEY_RULE}`,
    example: ['links'],
  })
  @IsArray()
  @ArrayMaxSize(ACTIVITY_LAYOUT_MAX_KEYS)
  @IsString({ each: true })
  @Matches(ACTIVITY_CARD_KEY_PATTERN, { each: true })
  hidden_cards: string[];
}
