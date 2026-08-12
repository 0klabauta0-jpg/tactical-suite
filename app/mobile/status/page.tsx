import type { Metadata } from "next";
import { MobileStatusControls } from "@/app/components/mobile/mobile-status-controls";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function MobileStatusPage() {
  return <MobileStatusControls />;
}
