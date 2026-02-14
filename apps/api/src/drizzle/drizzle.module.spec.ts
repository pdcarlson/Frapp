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
          load: [() => ({ DATABASE_URL: 'postgresql://test:test@localhost:5432/test' })],
        }),
        DrizzleModule,
      ],
    }).compile();
  });

  it('should compile the module', async () => {
    expect(moduleRef).toBeDefined();
  });

  it('should provide DRIZZLE_DB', async () => {
    const db = moduleRef.get(DRIZZLE_DB);
    expect(db).toBeDefined();
  });
});
