import app from './app';
import { config } from './config/env';
import { reviewJobService } from './services/reviewJobService';
import { auditInvoiceSchemaAtBoot } from './services/invoiceSchemaGuard';

// Hostinger (and any plain Node host) assigns the port via process.env.PORT.
// Bind 0.0.0.0 so the platform's reverse proxy can reach the process.
const PORT = Number(process.env.PORT) || 5000;
const HOST = '0.0.0.0';

// The invoice pipeline degrades quietly when its migration is missing, which is
// how it shipped broken: no invoice, no error recorded, admin shows "Order not
// found". Audit at boot so the mismatch is visible immediately.
auditInvoiceSchemaAtBoot().catch((err) => {
  console.error('[InvoiceSchema] boot audit failed:', err?.message || err);
});

app.listen(PORT, HOST, () => {
  console.log(`Backend server is running on http://${HOST}:${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

export default app;

// ---------------------------------------------------------------------------
// Local development scheduler.
// In production the scheduled jobs call the protected /api/jobs/* endpoints
// (see DEPLOY_HOSTINGER.md — Hostinger cron or an external scheduler sends
// `Authorization: Bearer $CRON_SECRET`). Locally we replicate that schedule
// here so the 7-day review request job behaves the same way without a
// deployment.
// ---------------------------------------------------------------------------
if (config.nodeEnv !== 'production') {
  const EVERY_6_HOURS = 6 * 60 * 60 * 1000;
  const runReviewJob = async () => {
    try {
      const stats = await reviewJobService.process();
      if (stats.scanned > 0) {
        console.log('[ReviewJob] processed:', stats);
      }
    } catch (err: any) {
      console.error('[ReviewJob] run failed:', err?.message || err);
    }
  };

  setTimeout(runReviewJob, 30_000); // first pass shortly after boot
  setInterval(runReviewJob, EVERY_6_HOURS);
}
