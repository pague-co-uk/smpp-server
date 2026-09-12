import { Injectable } from "@nestjs/common";

import {
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import * as smpp from "smpp";

import { AppConfigService } from "../config/config.service.js";

import { SmppBindHandler } from "./smpp-bind.handler.js";
import { SmppCommandHandler } from "./smpp-command.handler.js";
import { SmppSessionManager } from "./smpp.session-manager.js";

@Injectable()
export class SmppServer {
  private readonly logger =
    Loggers.smpp;

  private server:
    smpp.SmppServer | undefined;

  private started = false;

  constructor(
    private readonly config:
      AppConfigService,

    private readonly sessionManager:
      SmppSessionManager,

    private readonly bindHandler:
      SmppBindHandler,

    private readonly commandHandler:
      SmppCommandHandler,
  ) { }

  public start(): void {
    if (this.started) {
      return;
    }

    const {
      host,
      port,
    } = this.config.smpp;

    this.server =
      smpp.createServer(
        {
          debug: false,
        },
        (session) => {
          const smppSession =
            this.sessionManager.create(
              session,
            );

          smppSession.setConnected();

          /*
           * Bind commands are handled exclusively
           * by SmppBindHandler.
           */
          this.bindHandler.register(
            smppSession,
          );

          /*
           * All non-bind SMPP commands are handled
           * centrally by SmppCommandHandler.
           *
           * This replaces the former SmppSubmitHandler
           * and prevents duplicate submit_sm listeners.
           */
          this.commandHandler.register(
            smppSession,
          );

          this.logger.info(
            {
              sessionId:
                smppSession.id,

              remoteAddress:
                session.socket.remoteAddress,

              remotePort:
                session.socket.remotePort,
            },
            "SMPP client connected.",
          );
        },
      );

    this.server.listen(
      port,
      host,
      () => {
        this.started = true;

        this.logger.info(
          {
            host,
            port,
          },
          "SMPP TCP server listening.",
        );
      },
    );

    this.server.on(
      "error",
      (error: Error) => {
        this.logger.error(
          {
            err: error,

            host,
            port,
          },
          "SMPP TCP server error.",
        );
      },
    );
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    this.logger.info(
      "Stopping SMPP TCP server.",
    );

    await this.sessionManager.closeAll();

    await new Promise<void>(
      (resolve) => {
        this.server?.close(() => {
          resolve();
        });
      },
    );

    this.server = undefined;
    this.started = false;

    this.logger.info(
      "SMPP TCP server stopped.",
    );
  }
}