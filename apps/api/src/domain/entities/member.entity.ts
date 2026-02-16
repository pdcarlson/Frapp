export class Member {
  constructor(
    public readonly id: string,
    public readonly userId: string,
    public readonly chapterId: string,
    public readonly roleIds: string[] | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}
}
