"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import axiosInstance from "@/api/axiosInstance";
import { getSessionId, trackPixelPageView } from "@/lib/analytics";

function getDeviceType(): string {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent || "";
  if (/Mobi|Android|iPhone|iPod|Mobile/i.test(ua)) return "mobile";
  if (/Tablet|iPad/i.test(ua)) return "tablet";
  return "desktop";
}

/**
 * First-party pageview beacon + SPA route-change Meta Pixel PageView.
 * Fires once per route change, fire-and-forget (errors swallowed) so a tracking
 * failure never affects navigation or UX. Backs the admin Analytics traffic cards.
 */
export default function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTracked.current === pathname) return;
    const isRouteChange = lastTracked.current !== null;
    lastTracked.current = pathname;

    // Initial PageView is fired by AnalyticsScripts on load; fire subsequent
    // Next.js App Router client-side navigations here.
    if (isRouteChange) {
      trackPixelPageView();
    }

    try {
      axiosInstance
        .post("/analytics/pageview", {
          path: pathname,
          referrer: typeof document !== "undefined" ? document.referrer : "",
          sessionId: getSessionId(),
          deviceType: getDeviceType(),
        })
        .catch(() => {
          /* fire-and-forget */
        });
    } catch {
      /* never break navigation */
    }
  }, [pathname]);

  return null;
}
