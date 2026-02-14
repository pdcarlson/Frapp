export class User {
  constructor(
    public readonly id: string,
    public readonly clerkId: string,
    public readonly email: string,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
