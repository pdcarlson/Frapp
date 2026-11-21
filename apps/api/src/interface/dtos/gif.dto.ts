import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  GIF_PAGE_MAX,
  MAX_GIF_EDGE,
} from '#domain/adapters/gif-search.interface';

export class GifPageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: GIF_PAGE_MAX, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(GIF_PAGE_MAX)
  page?: number;
}

export class GifSearchQueryDto extends GifPageQueryDto {
  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  q: string;
}

export class GifRenditionDto {
  @ApiProperty()
  url: string;

  @ApiProperty()
  width: number;

  @ApiProperty()
  height: number;
}

export class GifResultDto {
  @ApiProperty({ description: "The provider's id for this GIF." })
  id: string;

  @ApiProperty({ description: 'Short words for screen readers; may be empty.' })
  title: string;

  @ApiProperty({
    type: GifRenditionDto,
    description: 'Small, for a grid tile.',
  })
  preview: GifRenditionDto;

  @ApiProperty({
    type: GifRenditionDto,
    description: 'What a message shows; send this one.',
  })
  full: GifRenditionDto;

  @ApiProperty({
    description:
      "Send it back with this GIF (`gif.token` on a message): it proves the GIF came from this server's search.",
  })
  token: string;
}

export class GifPageDto {
  @ApiProperty({ type: GifResultDto, isArray: true })
  results: GifResultDto[];

  @ApiProperty({ type: Number, nullable: true })
  next_page: number | null;
}

export class GifAvailabilityDto {
  @ApiProperty({
    description:
      'Whether GIF search is set up on this server. Clients hide the GIF button when it is not.',
  })
  available: boolean;

  @ApiProperty({
    description:
      "The provider's name, shown in the picker's search field as its attribution.",
  })
  provider: string;
}

export class GifFavoriteRenditionDto {
  @ApiProperty({ maxLength: 2048 })
  @IsString()
  @MaxLength(2048)
  url: string;

  @ApiProperty({ minimum: 1, maximum: MAX_GIF_EDGE })
  @IsInt()
  @Min(1)
  @Max(MAX_GIF_EDGE)
  width: number;

  @ApiProperty({ minimum: 1, maximum: MAX_GIF_EDGE })
  @IsInt()
  @Min(1)
  @Max(MAX_GIF_EDGE)
  height: number;
}

/** Star a GIF (#5772): a picker result, sent back as the client got it. */
export class AddGifFavoriteDto {
  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  id: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @ApiProperty({ type: GifFavoriteRenditionDto })
  @ValidateNested()
  @Type(() => GifFavoriteRenditionDto)
  preview: GifFavoriteRenditionDto;

  @ApiProperty({ type: GifFavoriteRenditionDto })
  @ValidateNested()
  @Type(() => GifFavoriteRenditionDto)
  full: GifFavoriteRenditionDto;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  token: string;
}
