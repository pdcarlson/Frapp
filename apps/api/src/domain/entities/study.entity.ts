export class StudyGeofence {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly name: string,
    public readonly coordinates: { lat: number; lng: number }[],
    public readonly isActive: boolean,
    public readonly createdAt: Date,
  ) {}
}

export class StudySession {
  constructor(
    public readonly id: string,
    public readonly chapterId: string,
    public readonly userId: string,
    public readonly geofenceId: string,
    public readonly status: 'ACTIVE' | 'COMPLETED' | 'EXPIRED',
    public readonly startTime: Date,
    public readonly endTime: Date | null,
    public readonly lastHeartbeatAt: Date,
    public readonly totalMinutes: number,
    public readonly pointsAwarded: boolean,
    public readonly createdAt: Date,
  ) {}
}
