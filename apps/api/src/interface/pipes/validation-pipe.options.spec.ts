import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { REQUEST_VALIDATION_FAILED_CODE } from '@repo/validation';
import { VALIDATION_PIPE_OPTIONS } from './validation-pipe.options';

class NoteDto {
  @IsString()
  @MaxLength(5)
  title!: string;
}

/**
 * A DTO refusal carries `code: request.validation_failed` beside Nest's own
 * field messages (#4096), so the clients can report it as a contract bug and
 * still word nothing new.
 */
describe('VALIDATION_PIPE_OPTIONS refusals', () => {
  const pipe = new ValidationPipe(VALIDATION_PIPE_OPTIONS);

  async function refusalOf(value: unknown): Promise<BadRequestException> {
    try {
      await pipe.transform(value, { type: 'body', metatype: NoteDto });
    } catch (error) {
      return error as BadRequestException;
    }
    throw new Error('expected the pipe to refuse');
  }

  it('is a 400 with the code and Nest’s field messages', async () => {
    const refusal = await refusalOf({ title: 'too long a title' });

    expect(refusal).toBeInstanceOf(BadRequestException);
    expect(refusal.getStatus()).toBe(400);
    expect(refusal.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['title must be shorter than or equal to 5 characters'],
      code: REQUEST_VALIDATION_FAILED_CODE,
    });
  });

  it('codes an undeclared property the same way', async () => {
    const refusal = await refusalOf({ title: 'ok', role: 'president' });
    expect(refusal.getResponse()).toMatchObject({
      message: ['property role should not exist'],
      code: REQUEST_VALIDATION_FAILED_CODE,
    });
  });
});
