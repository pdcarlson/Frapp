export class PointTransaction {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly userId: string,
    public readonly amount: number,
    public readonly category: string,
    public readonly description: string,
    public readonly metadata: Record<string, unknown> | null,
    public readonly createdAt: Date,
  ) {}
}
