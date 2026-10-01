import "server-only";
import NextAuth from "next-auth";
import { buildAuthConfig } from "./config";

// Config is built lazily so environment variables are read at request time.
export const { handlers, auth, signIn, signOut } = NextAuth(() => buildAuthConfig());
