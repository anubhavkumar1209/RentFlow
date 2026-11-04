import { LoginForm } from "./form";

/** /login is "Log in"; /login?start=1 (the landing page's "Start free") is the sign-up wording. */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ start?: string }> }) {
  const { start } = await searchParams;
  return <LoginForm mode={start ? "signup" : "login"} />;
}
