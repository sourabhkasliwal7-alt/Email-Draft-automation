import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublic } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (getSupabasePublic()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  // 303 so the browser follows with GET.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
