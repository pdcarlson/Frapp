import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { FILE_WHO_CAN_SEE, WhoCanSee } from './chapter-document.dto';

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
  @ApiProperty({
    description:
      'The top-most folders the last sync did not read, because they sit more than nine levels below the connected folder or past its first 300 folders. They and any folders inside them, and their files, are not in Documents; folders inside them are not counted.',
  })
  folders_left_out: number;
  @ApiProperty({ description: 'Whether a sync is due or running now' })
  syncing: boolean;
  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      "Who sees what it brings in (#5220): the list its top folder in Documents started with. Null for everyone who can open Documents. The folder's own list counts from then on.",
  })
  who_can_see: string[] | null;
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

  @WhoCanSee(
    "Who sees what the folder brings in (#5220): null or left out for everyone who can open Documents, or the tiers, roles and groups named. Its top folder in Documents starts with this list and each new subfolder with its parent's. Not empty. The caller's own tier and every tier above it are always kept.",
  )
  who_can_see?: string[] | null;
}

/** Whether a member can add a Drive file by link here (#5434). */
export class GoogleDriveLinkInfoDto {
  @ApiProperty({
    description:
      'Whether this server offers Google Drive. False until its service account is set; clients then hide the link field.',
  })
  available: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The address a file that not anyone with the link can open is shared with',
  })
  service_account_email: string | null;
}

export class AddGoogleDriveLinkDto {
  @ApiProperty({
    description:
      'A Google Docs, Sheets, Slides or Drive file link (or the file id)',
    example: 'https://docs.google.com/document/d/1AbC.../edit',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  link: string;

  @ApiPropertyOptional({
    description: 'Folder to file it in; left out for the top level',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  folder?: string | null;

  @WhoCanSee(FILE_WHO_CAN_SEE)
  who_can_see?: string[] | null;
}
