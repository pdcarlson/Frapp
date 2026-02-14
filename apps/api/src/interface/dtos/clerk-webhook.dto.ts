import { IsObject, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClerkWebhookDto {
  @ApiProperty({ description: 'The data object of the webhook' })
  @IsObject()
  @IsNotEmpty()
  data: any;

  @ApiProperty({ description: 'The object type' })
  @IsString()
  @IsNotEmpty()
  object: string;

  @ApiProperty({ description: 'The type of event' })
  @IsString()
  @IsNotEmpty()
  type: string;
}
