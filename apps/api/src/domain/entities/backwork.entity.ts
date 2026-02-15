export class BackworkCourse {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly code: string,
    public readonly name: string,
    public readonly createdAt: Date,
  ) {}
}

export class BackworkProfessor {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly name: string,
    public readonly createdAt: Date,
  ) {}
}

export class BackworkResource {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly courseId: string,
    public readonly professorId: string,
    public readonly uploaderId: string,
    public readonly title: string,
    public readonly term: string,
    public readonly s3Key: string,
    public readonly fileHash: string,
    public readonly tags: string[],
    public readonly createdAt: Date,
  ) {}
}
