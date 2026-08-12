import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KlabsCom",
  description: "Kollaboratives Echtzeit-Lageboard für Gruppen, Karten und Einsatzstatus.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
