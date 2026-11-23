import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Use the Worker-owned session endpoint shared with login and AccountMenu.
    // This avoids a second, independent TanStack server-function session path.
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (response.status === 401) throw redirect({ to: "/auth" });
    const result = await response.json().catch(() => null) as
      | { id: string; email: string; display_name: string | null; gender?: string | null; is_admin: boolean; error?: string }
      | null;
    if (!response.ok) {
      throw new Error(result?.error || "Je sessie kon niet worden gecontroleerd.");
    }
    if (!result?.id) throw redirect({ to: "/auth" });
    return { user: result };
  },
  component: () => <Outlet />,
});