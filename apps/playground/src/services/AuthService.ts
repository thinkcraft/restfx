import { randomUUID } from "node:crypto";
import type { AuthSessionResponse } from "../models/AuthSessionResponse.js";

const demoEmail = "demo@example.test";
const demoPassword = "playground-only";
const demoUser: AuthSessionResponse = {
  userId: "demo-user",
  email: demoEmail,
};

export class AuthService {
  private readonly sessions = new Map<string, AuthSessionResponse>();

  login(email: string, password: string) {
    if (email !== demoEmail || password !== demoPassword) return undefined;

    const token = randomUUID();
    this.sessions.set(token, demoUser);
    return { token, user: demoUser };
  }

  getSession(token: string | undefined) {
    return token === undefined ? undefined : this.sessions.get(token);
  }

  logout(token: string | undefined) {
    if (token !== undefined) this.sessions.delete(token);
  }
}
