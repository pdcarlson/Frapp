export class Chapter {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly university: string | null,
    public readonly clerkOrganizationId: string | null,
    public readonly stripeCustomerId: string | null,
    public readonly subscriptionStatus: string,
    public readonly subscriptionId: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
