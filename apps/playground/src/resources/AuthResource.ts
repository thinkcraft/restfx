import {
  HttpContext,
  HttpDelete,
  HttpGet,
  HttpPost,
  HttpResource,
  HttpResult,
  Inject,
} from "@framework/server";
import { AuthSessionResponse } from "../models/AuthSessionResponse.js";
import { LoginRequest } from "../models/LoginRequest.js";
import { AuthService } from "../services/AuthService.js";

const cookieName = "northstar_session";
const cookieLifetimeSeconds = 60 * 60;

@HttpResource("auth")
export class AuthResource {
  @Inject(AuthService)
  private readonly auth!: AuthService;

  @HttpPost({
    path: "session",
    summary: "Create a demo session",
    description:
      "Signs in the playground demo user and sets an HttpOnly session cookie. This hard-coded example is not production authentication.",
    tags: ["Auth"],
    body: LoginRequest,
    response: AuthSessionResponse,
    responses: {
      "200": {
        description: "Demo session created",
        headers: {
          "Set-Cookie": {
            description:
              "HttpOnly northstar_session cookie for the demo session",
            schema: { type: "string" },
          },
        },
      },
      "401": { description: "Invalid demo credentials" },
    },
  })
  async createSession(context: HttpContext) {
    const credentials = await context.req.parseBody({ model: LoginRequest });
    const session = this.auth.login(credentials.email, credentials.password);
    if (!session) return new HttpResult(401);

    context.cookies.set(cookieName, session.token, {
      path: "/",
      maxAge: cookieLifetimeSeconds,
      httpOnly: true,
      secure: context.req.url.protocol === "https:",
      sameSite: "lax",
    });
    return session.user;
  }

  @HttpGet({
    path: "session",
    summary: "Get the current demo session",
    tags: ["Auth"],
    response: AuthSessionResponse,
    security: [{ sessionCookie: [] }],
    responses: { "401": { description: "No active session" } },
  })
  getSession(context: HttpContext) {
    const user = this.auth.getSession(context.cookies.get(cookieName));
    return user ?? new HttpResult(401);
  }

  @HttpDelete({
    path: "session",
    summary: "End the current demo session",
    tags: ["Auth"],
    security: [{ sessionCookie: [] }],
    responses: { "204": { description: "Session ended" } },
  })
  endSession(context: HttpContext) {
    const token = context.cookies.get(cookieName);
    this.auth.logout(token);
    context.cookies.clear(cookieName, {
      path: "/",
      httpOnly: true,
      secure: context.req.url.protocol === "https:",
      sameSite: "lax",
    });
    return new HttpResult(204);
  }
}
