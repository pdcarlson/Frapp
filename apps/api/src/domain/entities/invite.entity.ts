export class Invite {
  constructor(
    public readonly id: string,
    public readonly token: string,
    public readonly chapterId: string,
    public readonly role: string,
    public readonly expiresAt: Date,
    public readonly createdBy: string,
    public readonly usedAt: Date | null,
    public readonly createdAt: Date,
  ) {}

  /**
   * Domain Logic: Check if the invite is still valid.
   */
  isValid(): boolean {
    return !this.usedAt && this.expiresAt > new Date();
  }
}
