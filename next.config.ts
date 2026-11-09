import type { NextConfig } from "next";

// Every page reads live data from Supabase, so pages are rendered per request
// (`dynamic = "force-dynamic"`) instead of using Cache Components.
const nextConfig: NextConfig = {
  experimental: {
    // A page the header fetched ahead (as the pointer reached its link, components/fetch-on-intent.ts) is used for 30
    // seconds at most, the least allowed (the default is 5 minutes): a change made by someone else shows soon.
    staleTimes: { static: 30 },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
