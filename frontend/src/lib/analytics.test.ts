import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_META_PIXEL_ID,
  analyticsEnabled,
  claimPurchaseOnce,
  gaEnabled,
  metaPixelSwitchEnabled,
  pixelEnabled,
  pixelId,
  sanitizeParams,
  setBeacon,
  track,
  trackPixelPageView,
} from "./analytics";

/**
 * The analytics contract:
 *   - GA4 fires only when NEXT_PUBLIC_ANALYTICS_ENABLED === "true" + NEXT_PUBLIC_GA_ID.
 *   - Meta Pixel defaults to DEFAULT_META_PIXEL_ID (1106420419060702) and fires
 *     unless NEXT_PUBLIC_ANALYTICS_ENABLED === "false" or NEXT_PUBLIC_META_PIXEL_ID === "".
 *   - purchase is counted once per order, across refreshes.
 *
 * The first-party beacon is cookieless by design (it is our own database),
 * so it is stubbed here and asserted separately.
 */

function makeStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

/** Minimal browser-ish global: window + localStorage/sessionStorage + location. */
function installBrowser() {
  const localStorage = makeStorage();
  const sessionStorage = makeStorage();

  const win: any = {
    localStorage,
    sessionStorage,
    location: { pathname: "/products" },
  };

  (globalThis as any).window = win;

  return {
    win,
    localStorage,
    reset: () => {
      localStorage.clear();
      sessionStorage.clear();
      delete win.gtag;
      delete win.fbq;
    },
  };
}

/**
 * One shared fake browser for the whole file. Describe bodies all run BEFORE
 * any test, so installing a fresh `window` per describe would leave the module
 * reading a newer object than the tests were writing to.
 */
const env = installBrowser();

describe("track()", () => {
  let beacon: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    env.reset();
    beacon = vi.fn();
    setBeacon((path, body) => beacon(path, body));
    // The module reads these at call time, so each test can set them freely.
    delete process.env.NEXT_PUBLIC_GA_ID;
    delete process.env.NEXT_PUBLIC_META_PIXEL_ID;
    delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED;
  });

  it("sends the first-party beacon on its own (it is our own database)", () => {
    track("view_item", { items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500 }] });

    expect(beacon).toHaveBeenCalledTimes(1);
    const [path, body] = beacon.mock.calls[0];
    expect(path).toBe("/analytics/event");
    expect(body.event).toBe("view_item");
    expect(body.product_id).toBe("p1");
  });

  it("is a no-op for GA4 when the master switch is OFF, while Meta Pixel uses the default ID", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    expect(pixelId()).toBe(DEFAULT_META_PIXEL_ID);
    expect(gaEnabled()).toBe(false);
    expect(pixelEnabled()).toBe(true);

    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });

    expect(gtag).not.toHaveBeenCalled();
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][0]).toBe("track");
    expect(fbq.mock.calls[0][1]).toBe("AddToCart");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("disables Meta Pixel when NEXT_PUBLIC_ANALYTICS_ENABLED is 'false' or NEXT_PUBLIC_META_PIXEL_ID is empty", () => {
    const fbq = vi.fn();
    env.win.fbq = fbq;

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "false";
    expect(metaPixelSwitchEnabled()).toBe(false);
    expect(pixelEnabled()).toBe(false);
    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });
    expect(fbq).not.toHaveBeenCalled();

    delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED;
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "";
    expect(pixelId()).toBe("");
    expect(pixelEnabled()).toBe(false);
    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });
    expect(fbq).not.toHaveBeenCalled();
  });

  it("does not call GA4 when NEXT_PUBLIC_GA_ID is unset, even with the switch on", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    const gtag = vi.fn();
    env.win.gtag = gtag;

    expect(gaEnabled()).toBe(false);

    track("add_to_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });

    expect(gtag).not.toHaveBeenCalled();
  });

  it("GA4 switch is OFF unless NEXT_PUBLIC_ANALYTICS_ENABLED is exactly 'true'", () => {
    expect(analyticsEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "false";
    expect(analyticsEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "1";
    expect(analyticsEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "";
    expect(analyticsEnabled()).toBe(false);

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    expect(analyticsEnabled()).toBe(true);
  });

  it("maps storefront events to GA4 and Meta Pixel standard events", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    const gtag = vi.fn();
    const fbq = vi.fn();
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    expect(gaEnabled()).toBe(true);
    expect(pixelEnabled()).toBe(true);

    track("add_to_cart", { items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500, quantity: 2 }] });

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(gtag.mock.calls[0][0]).toBe("event");
    expect(gtag.mock.calls[0][1]).toBe("add_to_cart");

    expect(fbq).toHaveBeenCalledTimes(1);
    expect(fbq.mock.calls[0][0]).toBe("track");
    expect(fbq.mock.calls[0][1]).toBe("AddToCart");
    expect(fbq.mock.calls[0][2]).toMatchObject({
      content_ids: ["p1"],
      content_type: "product",
      content_name: "Ashwagandha",
      value: 1000,
      currency: "INR",
      num_items: 2,
    });
    expect((fbq.mock.calls[0][3] as any).eventID).toEqual(expect.any(String));

    track("remove_from_cart", { items: [{ item_id: "p1", price: 500, quantity: 1 }] });
    expect(fbq.mock.calls[1][0]).toBe("trackCustom");
    expect(fbq.mock.calls[1][1]).toBe("remove_from_cart");
  });

  it("tracks SPA route-change PageView via trackPixelPageView", () => {
    const fbq = vi.fn();
    env.win.fbq = fbq;

    trackPixelPageView();
    expect(fbq).toHaveBeenCalledWith("track", "PageView");

    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "false";
    trackPixelPageView();
    expect(fbq).toHaveBeenCalledTimes(1);
  });

  it("strips PII from every destination", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    // `as any` on purpose: the PII fields below are exactly what the type
    // system rejects at compile time. This proves the RUNTIME scrub drops them
    // too, for any caller that manages to pass them (e.g. JS or a future refactor).
    track("purchase", {
      transaction_id: "MV-123456",
      value: 600,
      currency: "INR",
      payment_type: "cod",
      email: "buyer@example.com",
      phone: "+919876543210",
      shipping_address: { city: "Pune" },
      user_id: "user-42",
      items: [{ item_id: "p1", item_name: "Ashwagandha", price: 500, quantity: 1 }],
    } as any);

    const gaPayload = gtag.mock.calls[0][2] as Record<string, unknown>;
    expect(gaPayload.email).toBeUndefined();
    expect(gaPayload.phone).toBeUndefined();
    expect(gaPayload.shipping_address).toBeUndefined();
    expect(gaPayload.user_id).toBeUndefined();
    expect(gaPayload.transaction_id).toBe("MV-123456");
    expect(gaPayload.payment_type).toBe("cod");

    expect(fbq.mock.calls[0][1]).toBe("Purchase");
    const pixelPayload = fbq.mock.calls[0][2] as Record<string, unknown>;
    expect(pixelPayload.email).toBeUndefined();
    expect(pixelPayload.phone).toBeUndefined();
    expect(pixelPayload.shipping_address).toBeUndefined();
    expect(pixelPayload.user_id).toBeUndefined();
    expect(pixelPayload.order_id).toBe("MV-123456");
    expect(pixelPayload.value).toBe(600);
    expect(pixelPayload.currency).toBe("INR");

    const beaconBody = beacon.mock.calls[0][1];
    expect(beaconBody.email).toBeUndefined();
    expect(beaconBody.user_id).toBeUndefined();
  });

  it("fires purchase exactly once per order, even on refresh", () => {
    const gtag = vi.fn();
    const fbq = vi.fn();
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;
    env.win.fbq = fbq;

    const params = {
      transaction_id: "MV-654321",
      value: 1250,
      currency: "INR",
      payment_type: "payu",
      items: [{ item_id: "p1", price: 1200, quantity: 1 }],
    };

    track("purchase", params);
    // The success page polls while PayU confirms, and a refresh re-runs it.
    track("purchase", params);
    track("purchase", params);

    expect(gtag).toHaveBeenCalledTimes(1);
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("counts a different order separately", () => {
    const gtag = vi.fn();
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    process.env.NEXT_PUBLIC_GA_ID = "G-TEST123";
    process.env.NEXT_PUBLIC_META_PIXEL_ID = "9876543210";
    env.win.gtag = gtag;

    track("purchase", { transaction_id: "MV-1", value: 100, items: [{ item_id: "p1", price: 100, quantity: 1 }] });
    track("purchase", { transaction_id: "MV-2", value: 200, items: [{ item_id: "p2", price: 200, quantity: 1 }] });

    expect(gtag).toHaveBeenCalledTimes(2);
  });

  it("does not send purchase at all when the order number is missing", () => {
    const gtag = vi.fn();
    env.win.gtag = gtag;

    track("purchase", { value: 100 });

    expect(gtag).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it("claimPurchaseOnce is idempotent per order id", () => {
    expect(claimPurchaseOnce("MV-777")).toBe(true);
    expect(claimPurchaseOnce("MV-777")).toBe(false);
    expect(claimPurchaseOnce("MV-778")).toBe(true);
  });

  it("only forwards known commerce events to the first-party table", () => {
    track("order_placed", { value: 10 });
    expect(beacon).not.toHaveBeenCalled();

    track("begin_checkout", { value: 10 });
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("survives a beacon that throws", () => {
    setBeacon(() => {
      throw new Error("network down");
    });
    expect(() => track("view_item", { items: [{ item_id: "p1", price: 1, quantity: 1 }] })).not.toThrow();
  });
});

describe("sanitizeParams", () => {
  it("keeps commerce fields and drops identity fields", () => {
    const clean = sanitizeParams({
      value: 500,
      currency: "INR",
      transaction_id: "MV-1",
      payment_type: "cod",
      email: "a@b.c",
      user_id: "u1",
      customer_id: "c1",
      first_name: "Asha",
      phone_number: "9876543210",
      session_id: "sid-123",
    } as any);

    expect(clean).toEqual({
      value: 500,
      currency: "INR",
      transaction_id: "MV-1",
      payment_type: "cod",
      session_id: "sid-123",
    });
  });
});
