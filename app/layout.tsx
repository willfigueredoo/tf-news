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
    images: [{ url: "/og.png", width: 1732, height: 909, alt: "TF News — Inteligência editorial" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TF News — Inteligência editorial",
    description: "Notícias relevantes transformadas em inteligência e conteúdo original.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
