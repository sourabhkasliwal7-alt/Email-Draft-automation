import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublic } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (getSupabasePublic()) {
    const supabase = await createClient();
    // Ends this browser session only; other devices stay signed in.
    await supabase.auth.signOut({ scope: "local" });
  }
  // 303 so the browser follows with GET.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
