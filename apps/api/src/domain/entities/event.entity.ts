export class Event {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly name: string,
    public readonly description: string | null,
    public readonly startTime: Date,
    public readonly endTime: Date,
    public readonly pointValue: number,
    public readonly isMandatory: boolean,
    public readonly createdAt: Date,
  ) {}
}

export class EventAttendance {
  constructor(
    public readonly id: string,
    public readonly eventId: string,
    public readonly userId: string,
    public readonly status: string,
    public readonly checkInTime: Date | null,
    public readonly createdAt: Date,
  ) {}
}
