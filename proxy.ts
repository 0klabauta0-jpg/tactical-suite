import { NextResponse } from "next/server";

export function proxy() {
  if (process.env.NEXT_PUBLIC_ENABLE_UI_TEST_ROUTES === "1") {
    return NextResponse.next();
  }
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

export const config = {
  matcher: "/ui-test/:path*",
};
