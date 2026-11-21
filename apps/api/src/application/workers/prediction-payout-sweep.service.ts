import { Injectable } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { ReportedCron } from './reported-cron.decorator';
import { PredictionService } from '../services/prediction.service';

/**
 * Pays every settled prediction whose 24-hour question window ended with no
 * question (`spec/behavior/predictions.md` § Lifecycle). Safe on every
 * replica: `pay_prediction_market` locks the market row, and paying a paid
 * market again on the same answer returns it unchanged.
 */
@Injectable()
export class PredictionPayoutSweepService {
  constructor(private readonly predictions: PredictionService) {}

  @ReportedCron(CronExpression.EVERY_5_MINUTES)
  async handlePredictionPayoutSweep(): Promise<void> {
    await this.predictions.payDueMarkets(new Date());
  }
}
