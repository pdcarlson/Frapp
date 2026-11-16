import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** A chapter's connected Google Drive folder (#5157). */
export class GoogleDriveConnectionDto {
  @ApiProperty() folder_id: string;
  @ApiProperty({ description: "The folder's name in Drive" })
  folder_name: string;
  @ApiProperty({ description: "The folder's page in Google Drive" })
  folder_url: string;
  @ApiProperty({
    enum: ['active', 'no_access'],
    description:
      '`no_access` once Google answered that Frapp can no longer see the folder (unshared or deleted); copies stay as they were until it is shared again',
  })
  status: 'active' | 'no_access';
  @ApiProperty({
    type: String,
    nullable: true,
    format: 'date-time',
    description: 'When the last sync finished. Null before the first.',
  })
  last_synced_at: string | null;
  @ApiProperty({ description: 'Files the last sync left in Documents' })
  synced_count: number;
  @ApiProperty({
    description:
      'Files the last sync left out: a type Documents does not take, over 25 MB, or past 500 files',
  })
  skipped_count: number;
  @ApiProperty({ description: 'Whether a sync is due or running now' })
  syncing: boolean;
}

export class GoogleDriveStatusDto {
  @ApiProperty({
    description:
      'Whether this server offers Google Drive. False until its service account is set; clients then hide the option.',
  })
  available: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The address a chapter shares its folder with',
  })
  service_account_email: string | null;
  @ApiProperty({ type: GoogleDriveConnectionDto, nullable: true })
  connection: GoogleDriveConnectionDto | null;
}

export class ConnectGoogleDriveDto {
  @ApiProperty({
    description: 'The Drive folder link (or its id)',
    example: 'https://drive.google.com/drive/folders/1AbC...',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  folder_link: string;
}
