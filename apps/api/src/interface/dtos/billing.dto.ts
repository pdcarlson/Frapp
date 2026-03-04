import { IsEmail, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCheckoutDto {
  @ApiProperty({ description: 'Email for the checkout session' })
  @IsEmail()
  customer_email: string;

  @ApiProperty({ description: 'URL to redirect on successful payment' })
  @IsUrl({ require_tld: false })
  success_url: string;

  @ApiProperty({ description: 'URL to redirect on canceled payment' })
  @IsUrl({ require_tld: false })
  cancel_url: string;
}

export class CreatePortalDto {
  @ApiProperty({ description: 'URL to redirect when leaving the portal' })
  @IsUrl({ require_tld: false })
  return_url: string;
}
