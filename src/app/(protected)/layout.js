import {redirect} from "next/navigation";
import {getSessionUser} from "@/lib/auth/session";
import AppShell from "@/components/app-shell";
export const dynamic="force-dynamic";
export default async function Layout({children}){const user=await getSessionUser();if(!user)redirect("/login");return <AppShell user={user}>{children}</AppShell>}
