import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '../../domain/entities/task.entity';

export class CreateTaskDto {
  @ApiProperty()
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: 'User ID of the assignee' })
  @IsUUID()
  assignee_id: string;

  @ApiProperty({ description: 'Due date (YYYY-MM-DD)' })
  @IsDateString()
  due_date: string;

  @ApiPropertyOptional({ description: 'Points to award on completion' })
  @IsOptional()
  @IsInt()
  @Min(0)
  point_reward?: number;
}

export class UpdateTaskStatusDto {
  @ApiProperty({ enum: TaskStatus })
  @IsEnum(TaskStatus)
  status: TaskStatus;
}

export class RejectTaskCompletionDto {
  @ApiPropertyOptional({ description: 'Optional comment for rejection' })
  @IsOptional()
  @IsString()
  comment?: string;
}
