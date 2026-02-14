import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from './drizzle.module';
import { DRIZZLE_DB } from './drizzle.provider';

describe('DrizzleModule', () => {
  let moduleRef: TestingModule;

  beforeEach(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
            }),
          ],
        }),
        DrizzleModule,
      ],
    }).compile();
  });

  it('should compile the module', () => {
    expect(moduleRef).toBeDefined();
  });

  it('should provide DRIZZLE_DB', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const db = moduleRef.get<any>(DRIZZLE_DB);
    expect(db).toBeDefined();
  });
});
