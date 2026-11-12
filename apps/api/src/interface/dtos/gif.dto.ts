import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GIF_PAGE_MAX } from '#domain/adapters/gif-search.interface';

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
