import type { Metadata } from "next";
import { MobileConnect } from "@/app/components/mobile/mobile-connect";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ConnectPage() {
  return <MobileConnect />;
}
