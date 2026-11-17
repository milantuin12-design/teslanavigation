// Backward-compatible middleware name: server functions now authenticate against Cloudflare D1.
import { createMiddleware } from "@tanstack/react-start";
import { getCurrentD1User } from "@/lib/auth-d1.server";
import { createD1SupabaseClient } from "@/lib/d1-supabase-adapter.server";

export const requireSupabaseAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = await getCurrentD1User();
  if (!user) throw new Error("Niet ingelogd. Log opnieuw in.");
  return next({
    context: {
      supabase: createD1SupabaseClient(),
      userId: user.id,
      claims: { sub: user.id, email: user.email },
    },
  });
});
