"use client";

import Script from "next/script";
import { analyticsEnabled, gaId, metaPixelSwitchEnabled, pixelId } from "@/lib/analytics";

/**
 * GA4 + Meta Pixel loader, mounted once in the root layout so the scripts land
 * in the document on every page. There is no consent gate.
 *
 * - GA4 loads when NEXT_PUBLIC_ANALYTICS_ENABLED === "true" and NEXT_PUBLIC_GA_ID is set.
 * - Meta Pixel uses NEXT_PUBLIC_META_PIXEL_ID (defaulting to 1106420419060702)
 *   unless NEXT_PUBLIC_ANALYTICS_ENABLED === "false" or NEXT_PUBLIC_META_PIXEL_ID === "".
 */
export default function AnalyticsScripts() {
  const gaActive = analyticsEnabled() && !!gaId();
  const resolvedGaId = gaId();
  const resolvedPixelId = metaPixelSwitchEnabled() ? pixelId() : "";

  return (
    <>
      {gaActive ? (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${resolvedGaId}`}
            strategy="afterInteractive"
            id="ga4-loader"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = window.gtag || gtag;
              gtag('js', new Date());
              gtag('config', '${resolvedGaId}', { send_page_view: true });
            `}
          </Script>
        </>
      ) : null}

      {resolvedPixelId ? (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${resolvedPixelId}');
              fbq('track', 'PageView');
            `}
          </Script>
          <noscript>
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              src={`https://www.facebook.com/tr?id=${resolvedPixelId}&ev=PageView&noscript=1`}
              alt=""
            />
          </noscript>
        </>
      ) : null}
    </>
  );
}
