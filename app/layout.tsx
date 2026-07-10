import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://tf-news.sites.openai.com"),
  title: "TF News — Inteligência editorial",
  description:
    "Monitoramento de mercado e produção editorial para os segmentos atendidos pela TransFAST.",
  openGraph: {
    title: "TF News — Inteligência editorial",
    description:
      "Notícias relevantes transformadas em inteligência e conteúdo original.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TF News — Inteligência editorial",
    description: "Notícias relevantes transformadas em inteligência e conteúdo original.",
  },
  icons: {
    icon: "/brand/tf-news-icon.svg",
    shortcut: "/brand/tf-news-icon.svg",
    apple: "/brand/tf-news-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('tf-news-theme');var d=t||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');document.documentElement.dataset.theme=d;document.documentElement.style.colorScheme=d}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
