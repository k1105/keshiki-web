import type { Metadata } from "next";
import { DotGothic16, Noto_Sans_JP, Pixelify_Sans } from "next/font/google";
import "./globals.css";

// デザイン指定の LoRes 9 OT Narrow (Adobe Fonts) の代替。
// 本番フォントに差し替えるときは globals.css の --font-pixel を書き換える
const pixelifySans = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const dotGothic = DotGothic16({
  variable: "--font-dotgothic",
  subsets: ["latin"],
  weight: "400",
});

const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Glaiz",
  description: "釉薬の色・質感・焼成条件からレシピと焼き上がりをシミュレートするツール",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      className={`${pixelifySans.variable} ${dotGothic.variable} ${notoSansJp.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
