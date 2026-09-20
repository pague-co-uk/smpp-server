import { Injectable } from "@nestjs/common";

import {
  createServer,
  type Server as NetServer,
  type Socket,
} from "node:net";

import {
  createRequire,
} from "node:module";

import {
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppSession as SmppLibrarySession,
} from "smpp";

import { AppConfigService } from "../config/config.service.js";

import {
  readSmppProxyProtocol,
} from "./smpp-proxy-protocol.js";

import {
  SmppBindHandler,
} from "./smpp-bind.handler.js";

import {
  SmppCommandHandler,
} from "./smpp-command.handler.js";

import {
  SmppSessionManager,
} from "./smpp.session-manager.js";

const require =
  createRequire(
    import.meta.url,
  );

interface SmppRuntimeModule {
  Session: new (
    options: {
      socket: Socket;
      debug?: boolean;
      tls?: boolean;
      debugListener?: unknown;
    },
  ) => SmppLibrarySession;
}

const smppRuntime =
  require("smpp") as SmppRuntimeModule;

interface SmppRuntimeSession {
  remoteAddress:
  | string
  | null;

  remotePort:
  | number
  | null;

  proxyProtocolProxy:
  | {
    address: string;
    port: number;
  }
  | false
  | null;
}

type SmppLibrarySessionWithProxy =
  SmppLibrarySession &
  SmppRuntimeSession;

@Injectable()
export class SmppServer {
  private readonly logger =
    Loggers.smpp;

  private server:
    | NetServer
    | undefined;

  private started =
    false;

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
      createServer(
        (socket) => {
          void this.handleConnection(
            socket,
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

    this.server.listen(
      port,
      host,
      () => {
        this.started = true;

        this.logger.info(
          {
            host,
            port,
            proxyProtocol:
              true,
          },
          "SMPP TCP server listening.",
        );
      },
    );
  }

  private async handleConnection(
    socket: Socket,
  ): Promise<void> {
    try {
      const {
        info,
        remaining,
      } =
        await readSmppProxyProtocol(
          socket,
        );

      const rawSession =
        new smppRuntime.Session({
          socket,
          debug: false,
        });

      const sessionWithProxy =
        rawSession as
        SmppLibrarySessionWithProxy;

      sessionWithProxy.remoteAddress =
        info.remoteAddress;

      sessionWithProxy.remotePort =
        info.remotePort;

      sessionWithProxy.proxyProtocolProxy =
      {
        address:
          info.proxyAddress,

        port:
          info.proxyPort,
      };

      /*
       * The PROXY protocol header has
       * already been consumed.
       *
       * If the SMPP client sent the PROXY
       * header and the first SMPP PDU in
       * the same TCP packet, restore the
       * PDU bytes before the SMPP session
       * begins processing the socket.
       */
      if (
        remaining.length > 0
      ) {
        socket.unshift(
          remaining,
        );
      }

      const session =
        this.sessionManager.create(
          rawSession,
        );

      if (!session) {
        throw new Error(
          "Failed to create SMPP session.",
        );
      }

      session.setConnected();

      this.bindHandler.register(
        session,
      );

      this.commandHandler.register(
        session,
      );

      this.logger.info(
        {
          sessionId:
            session.id,

          remoteAddress:
            session.remoteAddress,

          remotePort:
            info.remotePort,

          proxyAddress:
            session.proxyAddress,

          proxyPort:
            info.proxyPort,
        },
        "SMPP client connected.",
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,

          remoteAddress:
            socket.remoteAddress,

          remotePort:
            socket.remotePort,
        },
        "SMPP connection initialization failed.",
      );

      socket.destroy();
    }
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
      (
        resolve,
        reject,
      ) => {
        this.server?.close(
          (error?: Error) => {
            if (error) {
              reject(error);
              return;
            }

            resolve();
          },
        );
      },
    );

    this.server =
      undefined;

    this.started =
      false;

    this.logger.info(
      "SMPP TCP server stopped.",
    );
  }
}