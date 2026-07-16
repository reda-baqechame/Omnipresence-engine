import { redirect } from "next/navigation";

/** The guided setup now lives in the project wizard (fork -> domain
 * intelligence -> competitor confirmation -> prompt approval). This route is
 * kept only so old links keep working. */
export default function OnboardingPage() {
  redirect("/app/projects/new");
}
