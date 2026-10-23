import { Wagering, type WageringPort } from '../application/wagering';
import { metric, log } from './telemetry';
export function instrumentedWagering(store: WageringPort): Wagering {
  return new Wagering(
    store,
    undefined,
    ({ response, error, milliseconds, walletId, providerId }) => {
      metric('wager_processing_seconds_sum', milliseconds / 1000);
      metric('wager_processing_seconds_count');
      for (const bucket of [0.01, 0.05, 0.1, 0.5, 1, 5])
        if (milliseconds / 1000 <= bucket) {
          metric('wager_processing_seconds_bucket{le="' + bucket + '"}');
        }
      metric('wager_processing_seconds_bucket{le="+Inf"}');
      if (response) {
        metric('wager_transactions_total{status="' + response.status + '"}');
        if (response.idempotentReplay) {
          metric('wager_duplicates_total');
        }
        log('transaction_result', {
          walletId,
          providerId,
          transactionId: response.transactionId,
          status: response.status,
        });
      } else if (error) {
        log('transaction_error', {
          walletId,
          providerId,
          code: 'PROCESSING_FAILED',
        });
      }
    },
  );
}
