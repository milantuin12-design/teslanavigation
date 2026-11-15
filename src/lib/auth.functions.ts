import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { claimInitialD1Admin, getCurrentD1User, loginD1User, logoutD1User, registerD1User } from "./auth-d1.server";

const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  return await getCurrentD1User();
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => loginD1User(data.email, data.password));

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => registerD1User(data.email, data.password));

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  await logoutD1User();
  return { ok: true };
});

export const claimAdmin = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(32).max(256) }).parse(input))
  .handler(async ({ data }) => claimInitialD1Admin(data.token));
