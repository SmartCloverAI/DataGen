import Image from "next/image";
import type { Metadata } from "next";
import { Mona_Sans, Roboto_Mono } from "next/font/google";
import "./globals.css";

const monaSans = Mona_Sans({
  variable: "--font-mona-sans",
  subsets: ["latin"],
});

const robotoMono = Roboto_Mono({
  variable: "--font-roboto-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DataGen",
  description: "Generate synthetic datasets with one-call-per-record inference.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${monaSans.variable} ${robotoMono.variable}`}>
        <div className="app-shell">
          <header className="topbar">
            <div className="brand">
              <Image
                src="/datagenLogo.svg"
                alt="DataGen logo"
                width={180}
                height={32}
                className="brand__logo"
                priority
              />
              <div className="brand__copy">
                <p className="brand__tagline">Synthetic dataset generator</p>
              </div>
            </div>
            <div className="pill">CStore-secured workspace</div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
