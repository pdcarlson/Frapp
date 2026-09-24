import { ApiProperty } from '@nestjs/swagger';

/**
 * What a mobile binary is told at launch (#2526).
 *
 * Every field here is read by binaries that can't be updated over the air, so
 * none can be removed or change meaning while a build that reads it is still
 * supported. Add fields; never repurpose one.
 */
export class ClientPolicyDto {
  @ApiProperty({
    description:
      "True when the build named in X-Client-Version is below this deployment's minimum for its platform. The app then shows a blocking update screen. False whenever the header is missing, malformed, or names an unknown platform, and whenever no minimum is set.",
  })
  update_required: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Where the update screen sends the member: the store listing, or a per-platform override such as a TestFlight link. Null when the header does not name a known platform.',
    example: 'https://apps.apple.com/app/id6812025642',
  })
  update_url: string | null;
}
