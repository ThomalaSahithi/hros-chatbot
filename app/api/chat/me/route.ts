import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const roleLabels: Record<string, string> = {
  candidate: "Candidate",
  recruiter: "Recruiter",
  hr_manager: "HR Manager",
  admin: "Administrator",
};

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      console.error("HROS profile lookup error:", profileError.message);
      return NextResponse.json(
        { error: "Unable to retrieve your profile." },
        { status: 500 }
      );
    }

    const metadataName =
      typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "";
    const emailName = user.email?.split("@")[0] ?? "HROS User";
    const fullName =
      (typeof profile?.full_name === "string" && profile.full_name.trim()) ||
      metadataName ||
      emailName;
    const role = String(profile?.role ?? "").trim().toLowerCase();

    return NextResponse.json(
      {
        success: true,
        profile: {
          fullName,
          role,
          roleLabel: roleLabels[role] ?? "HROS member",
        },
      },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("HROS current-user API error:", error);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
