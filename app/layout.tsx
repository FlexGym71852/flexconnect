import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Flex Connect | Gym Management",
  description: "Memberships, access control, NFC check-ins, reporting, and clothing point of sale.",
  other: { "codex-preview": "development" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
