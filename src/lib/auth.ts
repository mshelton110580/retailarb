import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) {
          return null;
        }

        const user = await prisma.users.findUnique({
          where: { email: credentials.email }
        });

        if (!user) {
          return null;
        }

        const valid = await bcrypt.compare(credentials.password, user.password_hash);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          role: user.role
        };
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as unknown as { role: string }).role;
      } else if (token.sub) {
        // Re-validate user exists and sync role on every token refresh
        const dbUser = await prisma.users.findUnique({
          where: { id: token.sub },
          select: { role: true },
        });
        if (!dbUser) return { ...token, invalidated: true };
        token.role = dbUser.role;
      }
      return token;
    },
    async session({ session, token }) {
      if ((token as Record<string, unknown>).invalidated) return null as unknown as typeof session;
      if (session.user) {
        session.user.role = token.role as string;
        session.user.id = token.sub ?? "";
      }
      return session;
    }
  },
  pages: {
    signIn: "/login"
  },
  secret: process.env.NEXTAUTH_SECRET
};
