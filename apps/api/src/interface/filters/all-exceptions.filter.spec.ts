import { Test, TestingModule } from '@nestjs/testing';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { HttpAdapterHost } from '@nestjs/core';
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let adapterHost: HttpAdapterHost;

  const mockHttpAdapter = {
    getRequestUrl: jest.fn(() => '/test'),
    reply: jest.fn(),
  };

  const mockArgumentsHost = {
    switchToHttp: jest.fn().mockReturnThis(),
    getRequest: jest.fn(),
    getResponse: jest.fn(),
  } as unknown as ArgumentsHost;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AllExceptionsFilter,
        {
          provide: HttpAdapterHost,
          useValue: { httpAdapter: mockHttpAdapter },
        },
      ],
    }).compile();

    filter = module.get<AllExceptionsFilter>(AllExceptionsFilter);
    adapterHost = module.get<HttpAdapterHost>(HttpAdapterHost);
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  describe('catch', () => {
    it('should catch HttpException and format response', () => {
      const exception = new HttpException('Forbidden', HttpStatus.FORBIDDEN);

      filter.catch(exception, mockArgumentsHost);

      expect(mockHttpAdapter.reply).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          statusCode: 403,
          message: 'Forbidden',
        }),
        403,
      );
    });

    it('should catch generic error and return 500', () => {
      const exception = new Error('Random Error');

      filter.catch(exception, mockArgumentsHost);

      expect(mockHttpAdapter.reply).toHaveBeenLastCalledWith(
        undefined,
        expect.objectContaining({
          statusCode: 500,
          message: 'Internal server error',
        }),
        500,
      );
    });
  });
});
