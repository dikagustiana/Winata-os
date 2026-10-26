import type { Metadata, Viewport } from "next";
import "./tokens.css";

export const metadata: Metadata = {
  title: "Winata Egg Position",
  description: "Posisi telur harian PT Winata Mega Agro",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6b3a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
