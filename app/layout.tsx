import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

// フォントは Adobe Fonts (Typekit) のキット utl4rhu から読む。
// - 英字: LoRes 9 OT Narrow ("lores-9-narrow")
// - 日本語: 游ゴシック Pr6N ("yu-gothic-pr6n")
// 日本語フォントはダイナミックサブセット (JS 埋め込み) でないと配信されないので、CSS の <link> ではなく
// Adobe が発行する JS スニペットをそのまま使う。globals.css の --font-pixel / --font-text で参照する
const ADOBE_FONTS_KIT_ID = "utl4rhu";
const ADOBE_FONTS_LOADER = `(function(d){var config={kitId:'${ADOBE_FONTS_KIT_ID}',scriptTimeout:3000,async:true},h=d.documentElement,t=setTimeout(function(){h.className=h.className.replace(/\bwf-loading\b/g,"")+" wf-inactive";},config.scriptTimeout),tk=d.createElement("script"),f=false,s=d.getElementsByTagName("script")[0],a;h.className+=" wf-loading";tk.src='https://use.typekit.net/'+config.kitId+'.js';tk.async=true;tk.onload=tk.onreadystatechange=function(){a=this.readyState;if(f||a&&a!="complete"&&a!="loaded")return;f=true;clearTimeout(t);try{Typekit.load(config)}catch(e){}};s.parentNode.insertBefore(tk,s)})(document);`;

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
    <html lang="ja">
      <body>
        <Script id="adobe-fonts" dangerouslySetInnerHTML={{ __html: ADOBE_FONTS_LOADER }} />
        {children}
      </body>
    </html>
  );
}
