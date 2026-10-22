import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 대시보드는 순수 클라이언트 앱 — 정적 export 로 SBC/NGINX 어디에나 올릴 수 있게
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["three"],
};

export default nextConfig;
