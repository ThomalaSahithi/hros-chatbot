
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Verify logged-in user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Please log in to apply for a job." },
        { status: 401 }
      );
    }

    // 2. Verify candidate role from database
    const { data: profile, error: profileError } =
      await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("user_id", user.id)
        .maybeSingle();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: "Unable to verify your HROS profile." },
        { status: 403 }
      );
    }

    if (profile.role !== "candidate") {
      return NextResponse.json(
        { error: "Only candidates can submit applications." },
        { status: 403 }
      );
    }

    // 3. Validate request
    const body = await request.json();
    const jobId = body.jobId;

    if (
      typeof jobId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)
    ) {
      return NextResponse.json(
        { error: "Invalid job ID." },
        { status: 400 }
      );
    }

    // 4. Confirm that the vacancy is published
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id, status")
      .eq("id", jobId)
      .eq("status", "published")
      .maybeSingle();

    if (jobError) {
      return NextResponse.json(
        { error: "Unable to verify vacancy." },
        { status: 500 }
      );
    }

    if (!job) {
      return NextResponse.json(
        { error: "This vacancy is no longer available." },
        { status: 404 }
      );
    }

    // 5. Find existing candidate record
    const { data: existingCandidate, error: candidateError } =
      await supabase
        .from("candidates")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

    if (candidateError) {
      return NextResponse.json(
        { error: "Unable to retrieve candidate profile." },
        { status: 500 }
      );
    }

    let candidateId = existingCandidate?.id;

    // 6. Create candidate record if it does not exist
    if (!candidateId) {
      const fullName =
        profile.full_name ||
        user.user_metadata?.full_name;

      if (!fullName) {
        return NextResponse.json(
          {
            error: "Please complete your profile with your full name before applying."
          },
          { status: 400 }
        );
      }

      const { data: newCandidate, error: insertCandidateError } =
        await supabase
          .from("candidates")
          .insert({
            user_id: user.id,
            full_name: fullName,
            email: user.email,
          })
          .select("id")
          .single();

      if (insertCandidateError || !newCandidate) {
        return NextResponse.json(
          { error: "Unable to create candidate record." },
          { status: 500 }
        );
      }

      candidateId = newCandidate.id;
    }

    // 7. Submit application
    const { data: application, error: applicationError } =
      await supabase
        .from("applications")
        .insert({
          job_id: jobId,
          candidate_id: candidateId,
          status: "submitted",
        })
        .select("id, job_id, status, applied_at")
        .single();

    if (applicationError) {
      // Handle duplicate applications
      if (applicationError.code === "23505") {
        return NextResponse.json(
          {
            error: "You have already applied for this vacancy."
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: "Unable to submit your application. Please try again." },
        { status: 400 }
      );
    }

    // 8. Return successful response
    return NextResponse.json(
      {
        success: true,
        message: "Your application has been submitted successfully!",
        application,
      },
      { status: 201 }
    );

  } catch {
    return NextResponse.json(
      { error: "An unexpected error occurred." },
      { status: 500 }
    );
  }
}
