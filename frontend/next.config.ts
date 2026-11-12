import type { NextConfig } from "next";

const backend = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);
const config: NextConfig = {
  poweredByHeader: false,
  output: process.env.KAZI_STANDALONE === "true" ? "standalone" : undefined,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
