import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TB3 관제",
  description: "TurtleBot3 · OpenMANIPULATOR-X 로봇 관제 대시보드",
};

export const viewport: Viewport = { themeColor: "#070a0e", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
