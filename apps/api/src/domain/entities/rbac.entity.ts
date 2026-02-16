export class Role {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly name: string,
    public readonly permissions: string[],
    public readonly isSystem: boolean,
    public readonly createdAt: Date,
  ) {}
}
