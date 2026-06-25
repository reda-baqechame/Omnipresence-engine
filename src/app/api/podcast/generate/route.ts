import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyProjectAccess } from "@/lib/security/project-access";
import { apiError, apiForbidden, apiNotFound, apiUnauthorized } from "@/lib/security/api-response";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiUnauthorized();

  const { projectId, assetId } = await request.json();
  if (!projectId || !assetId) return apiError("projectId and assetId required");

  const access = await verifyProjectAccess(supabase, projectId, user.id, "member");
  if (!access) return apiForbidden();

  const { data: asset } = await supabase
    .from("content_assets")
    .select("id, title, content, type")
    .eq("id", assetId)
    .eq("project_id", projectId)
    .single();

  if (!asset || asset.type !== "podcast_script") return apiNotFound();

  const script = (asset.content || "").slice(0, 4000);
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openaiKey) {
    return NextResponse.json({
      ready: false,
      assetId,
      title: asset.title,
      scriptPreview: script.slice(0, 500),
      message: "Set OPENAI_API_KEY for TTS audio generation",
    });
  }

  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "alloy",
        input: script.slice(0, 4096),
        response_format: "mp3",
      }),
    });

    if (!res.ok) {
      return NextResponse.json({
        ready: false,
        error: "TTS request failed",
        scriptPreview: script.slice(0, 500),
      });
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const base64 = buffer.toString("base64");
    const audioUrl = `data:audio/mpeg;base64,${base64}`;

    await supabase
      .from("content_assets")
      .update({
        metadata: {
          audio_generated_at: new Date().toISOString(),
          audio_format: "mp3",
        },
      })
      .eq("id", assetId);

    return NextResponse.json({
      ready: true,
      assetId,
      title: asset.title,
      audioUrl,
      format: "mp3",
    });
  } catch {
    return NextResponse.json({
      ready: false,
      scriptPreview: script.slice(0, 500),
      message: "TTS generation failed",
    });
  }
}
