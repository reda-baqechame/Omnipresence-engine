import { createClient } from "@/lib/supabase/server";

export async function getProject(id: string) {
  const supabase = await createClient();
  const { data: project } = await supabase.from("projects").select("*").eq("id", id).single();
  return project;
}
