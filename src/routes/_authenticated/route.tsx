import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const response = await fetch("/api/auth/me", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw redirect({ to: "/auth" });
    const user = await response.json() as {
      id: string; email: string; display_name: string | null; gender: string | null; is_admin: boolean;
    };
    return { user };
  },
  component: () => <Outlet />,
});
