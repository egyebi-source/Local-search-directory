import { redirect } from "next/navigation";

// Organizations are now created from the pre-sign-up questions at /start.
export default function OnboardingPage() {
  redirect("/start");
}
