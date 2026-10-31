import type { SessionUser } from "./services/auth";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      sessionId?: number;
      csrfToken?: string;
      requestId?: string;
    }
  }
}

export {};
