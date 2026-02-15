import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBackworkResourceDto {
  @ApiProperty({ example: 'CS101' })
  @IsString()
  @IsNotEmpty()
  courseCode: string;

  @ApiProperty({ example: 'Intro to Computer Science' })
  @IsString()
  @IsNotEmpty()
  courseName: string;

  @ApiProperty({ example: 'Dr. Smith' })
  @IsString()
  @IsNotEmpty()
  professorName: string;

  @ApiProperty({ example: 'Fall 2024' })
  @IsString()
  @IsNotEmpty()
  term: string;

  @ApiProperty({ example: 'Final Exam 2024' })
  @IsString()
  @IsNotEmpty()
  title: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  s3Key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  fileHash: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags: string[] = [];
}
