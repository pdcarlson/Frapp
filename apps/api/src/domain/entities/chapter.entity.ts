export class Chapter {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly clerkOrganizationId: string | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
