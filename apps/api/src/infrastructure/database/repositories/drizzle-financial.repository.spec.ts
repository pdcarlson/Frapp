import { Test, TestingModule } from '@nestjs/testing';
import { DrizzleFinancialRepository } from './drizzle-financial.repository';
import { DRIZZLE_DB } from '../drizzle.provider';

describe('DrizzleFinancialRepository', () => {
  let repository: DrizzleFinancialRepository;

  const mockDb = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    returning: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrizzleFinancialRepository,
        {
          provide: DRIZZLE_DB,
          useValue: mockDb,
        },
      ],
    }).compile();

    repository = module.get<DrizzleFinancialRepository>(DrizzleFinancialRepository);
  });

  it('should be defined', () => {
    expect(repository).toBeDefined();
  });

  describe('createInvoice', () => {
    it('should create and return an invoice', async () => {
      const mockInvoice = {
        id: 'i1',
        chapterId: 'c1',
        userId: 'u1',
        title: 'Dues',
        description: null,
        amount: 5000,
        status: 'OPEN',
        dueDate: new Date(),
        paidAt: null,
        stripePaymentIntentId: null,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockInvoice]);

      const result = await repository.createInvoice({
        chapterId: 'c1',
        userId: 'u1',
        title: 'Dues',
        description: null,
        amount: 5000,
        status: 'OPEN',
        dueDate: new Date(),
        paidAt: null,
        stripePaymentIntentId: null,
      });

      expect(result.id).toBe('i1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });

  describe('createTransaction', () => {
    it('should create and return a transaction', async () => {
      const mockTx = {
        id: 't1',
        chapterId: 'c1',
        invoiceId: 'i1',
        amount: 5000,
        type: 'PAYMENT',
        stripeChargeId: null,
        createdAt: new Date(),
      };
      mockDb.returning.mockResolvedValue([mockTx]);

      const result = await repository.createTransaction({
        chapterId: 'c1',
        invoiceId: 'i1',
        amount: 5000,
        type: 'PAYMENT',
        stripeChargeId: null,
      });

      expect(result.id).toBe('t1');
      expect(mockDb.insert).toHaveBeenCalled();
    });
  });
});
