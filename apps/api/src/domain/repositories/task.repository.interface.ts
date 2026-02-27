import { Task } from '../entities/task.entity';

export const TASK_REPOSITORY = 'TASK_REPOSITORY';

export interface ITaskRepository {
  findById(id: string, chapterId: string): Promise<Task | null>;
  findByChapter(chapterId: string): Promise<Task[]>;
  findByAssignee(chapterId: string, assigneeId: string): Promise<Task[]>;
  create(data: Partial<Task>): Promise<Task>;
  update(id: string, chapterId: string, data: Partial<Task>): Promise<Task>;
  delete(id: string, chapterId: string): Promise<void>;
}
