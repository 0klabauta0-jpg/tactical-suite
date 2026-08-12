"use client";

import { notFound } from "next/navigation";
import { useRef } from "react";
import { MobileLinkDialog } from "@/app/components/mobile/mobile-link-dialog";

export default function MobileLinkTestPage() {
  const issued = useRef(0);
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES !== "1") notFound();
  const fetchImpl: typeof fetch = async (_input, init) => {
    if (init?.method === "DELETE") return new Response(JSON.stringify({ sessionRevision: 3 }), { status: 200 });
    issued.current += 1;
    const token = (issued.current % 2 === 1 ? "a" : "b").repeat(43);
    return new Response(JSON.stringify({
      url: `https://app.example/connect#r=room&p=p1&t=${token}`,
      expiresAtMs: Date.now() + 86_400_000,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return <MobileLinkDialog roomId="room" playerName="KRT Ada" getIdToken={async () => "test-token"} onClose={() => undefined} fetchImpl={fetchImpl} />;
}
