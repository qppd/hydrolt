import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "HYDROLYT — Vertical Hydroponic Monitor",
  description:
    "IoT monitoring and management for a vertical hydroponic melon system: pH, EC, climate, irrigation and dosing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main>{children}</main>
        <footer className="site">
          HYDROLYT · IoT vertical hydroponic system · Cucumis melo (melon)
          <br />
        </footer>
      </body>
    </html>
  );
}
