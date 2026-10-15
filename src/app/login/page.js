import LoginForm from "@/components/login-form";
import { getTurnstileClientConfig } from "@/lib/security/turnstile";
import { connection } from "next/server";

export default async function Login() {
  await connection();
  return <LoginForm turnstile={getTurnstileClientConfig()} />;
}
