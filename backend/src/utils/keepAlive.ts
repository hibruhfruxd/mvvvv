/**
 * Keep post-response work alive.
 *
 * The invoice dispatch (and the Shiprocket push) run AFTER the order response
 * has been sent, so the customer's checkout is never delayed by PDF rendering or
 * Meta/Resend latency. On a plain Node host (Hostinger) the process keeps
 * running after the response flushes, so holding a reference to the promise is
 * enough — the work is never torn down mid-flight.
 *
 * Never let this become an unhandled rejection: failures are logged, and the
 * database records them via the usual error paths inside the work functions.
 */
export function keepAlive(work: Promise<unknown>): void {
  // Never let this become an unhandled rejection.
  void Promise.resolve(work).catch((err: unknown) => {
    console.error('[keepAlive] background work failed:', (err as Error)?.message || err);
  });
}
