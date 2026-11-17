import { createFileRoute, redirect } from "@tanstack/react-router";

// The former vehicle editor used the retired Supabase backend. Keep old bookmarks
// working by sending administrators to the Cloudflare D1 vehicle catalogue.
export const Route = createFileRoute("/_authenticated/voertuigen")({
  ssr: false,
  beforeLoad: () => {
    throw redirect({ to: "/voertuigmodellen" });
  },
  component: () => null,
});
