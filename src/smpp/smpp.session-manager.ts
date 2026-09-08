import { Injectable } from "@nestjs/common";

import { Loggers } from "@pague-co-uk/sms-gateway-telemetry";

import type { SmppSession as SmppLibrarySession } from "smpp";

import { SmppSession } from "./smpp.session.js";

@Injectable()
export class SmppSessionManager {
  private readonly logger = Loggers.smpp;

  private readonly sessions = new Map<string, SmppSession>();

  public create(
    session: SmppLibrarySession,
  ): SmppSession {
    const smppSession = new SmppSession(session);

    this.sessions.set(
      smppSession.id,
      smppSession,
    );

    session.once("close", () => {
      this.remove(smppSession.id);
    });

    this.logger.info(
      {
        sessionId: smppSession.id,
        activeSessions: this.sessions.size,
      },
      "SMPP session registered.",
    );

    return smppSession;
  }

  public get(
    sessionId: string,
  ): SmppSession | undefined {
    return this.sessions.get(sessionId);
  }

  public values(): readonly SmppSession[] {
    return [...this.sessions.values()];
  }

  public remove(sessionId: string): void {
    const removed = this.sessions.delete(sessionId);

    if (!removed) {
      return;
    }

    this.logger.info(
      {
        sessionId,
        activeSessions: this.sessions.size,
      },
      "SMPP session removed.",
    );
  }

  public async closeAll(): Promise<void> {
    const sessions = this.values();

    this.logger.info(
      {
        sessionCount: sessions.length,
      },
      "Closing SMPP sessions.",
    );

    for (const session of sessions) {
      session.close();
    }

    this.sessions.clear();
  }
}