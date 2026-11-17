import type { NextConfig } from "next";

// Public media host comes from R2_PUBLIC_BASE_URL (Cloudflare R2 custom domain).
// Nothing here hardcodes a storage provider.
const publicMediaBase = process.env.R2_PUBLIC_BASE_URL?.trim();
let mediaRemotePattern: { protocol: "http" | "https"; hostname: string } | null = null;
try {
  if (publicMediaBase) {
    const url = new URL(publicMediaBase);
    mediaRemotePattern = {
      protocol: url.protocol === "http:" ? "http" : "https",
      hostname: url.hostname,
    };
  }
} catch {
  mediaRemotePattern = null;
}

// The storefront's own host: the catalogue artwork is served statically from
// frontend/public/images, so the site serves its own product photos.
const ownHostRemotePattern = {
  protocol: "https" as const,
  hostname: "meruvedawellness.com",
};

// The API host serves /api/* through the rewrite below; listing it lets
// next/image accept backend-hosted URLs if they are ever used directly.
const apiHostRemotePattern = {
  protocol: "https" as const,
  hostname: "api.meruvedawellness.com",
};

const wwwHostRemotePattern = {
  protocol: "https" as const,
  hostname: "www.meruvedawellness.com",
};

const nextConfig: NextConfig = {
  transpilePackages: ["@meruveda/shared"],
  images: {
    // Remote photos go through the backend proxy (/api/images/fetch): storage
    // serves multi-megabyte originals and Next's optimizer aborts the upstream
    // download after 7 seconds, which 500'd every product photo on a slow link.
    // The proxy fetches patiently, resizes and caches instead.
    loader: "custom",
    loaderFile: "./src/imageLoader.ts",
    remotePatterns: mediaRemotePattern
      ? [mediaRemotePattern, ownHostRemotePattern, wwwHostRemotePattern, apiHostRemotePattern]
      : [ownHostRemotePattern, wwwHostRemotePattern, apiHostRemotePattern],
    // Product images live in object storage. On networks that resolve the
    // storage host through NAT64/IPv6, Next's SSRF guard misreads the address as
    // a private IP and answers every remote image with 400 ("url parameter is
    // not allowed"), so no product photo renders. Fetches stay pinned to the
    // single trusted hostname above, so nothing else can be requested.
    dangerouslyAllowLocalIP: true,
  },
  async redirects() {
    // The cart page was removed: the cart icon and Buy Now both land on
    // checkout, which renders the cart contents inline.
    return [
      {
        source: '/cart',
        destination: '/checkout',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    // Same-origin /api/* → Express backend. The custom image loader (and the
    // axios client) request /api/... on the frontend origin; the rewrite here
    // forwards those to the backend service. This works identically on
    // Hostinger (`next start`) because BACKEND_SERVICE_URL is read at
    // build/startup time on the server — it never reaches the browser bundle.
    // On Vercel the vercel.json rewrite handles /api/* instead, so the
    // rewrite is skipped there to avoid double-proxying.
    if (process.env.VERCEL) return [];

    const backendUrl =
      process.env.BACKEND_SERVICE_URL || process.env.NEXT_PUBLIC_API_URL;

    if (!backendUrl) {
      // Without the platform rewrite, a missing backend URL would silently
      // rewrite every /api call to localhost and break the whole storefront —
      // fail the build/startup with an actionable message instead.
      if (process.env.NODE_ENV === 'production') {
        throw new Error(
          '[next.config] BACKEND_SERVICE_URL (or NEXT_PUBLIC_API_URL) must be set when building ' +
            'for production outside Vercel (e.g. on Hostinger, where `next start` owns the ' +
            '/api/* rewrite). It is the backend service origin /api/* is rewritten to — ' +
            'without it every API and image request 404s.'
        );
      }
      // Local dev convenience default.
      return [
        { source: '/api/:path*', destination: 'http://localhost:5000/api/:path*' },
      ];
    }

    let base = backendUrl.replace(/\/+$/, '');
    if (base.endsWith('/api')) base = base.slice(0, -4);
    return [{ source: '/api/:path*', destination: `${base}/api/:path*` }];
  },
};

export default nextConfig;
