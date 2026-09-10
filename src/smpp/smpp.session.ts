import { randomUUID } from "node:crypto";

import {
  decrementActiveSessions,
  incrementActiveSessions,
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type { SmppSession as SmppLibrarySession } from "smpp";

import {
  SMPP_SESSION_STATES,
  type SmppSessionState,
} from "./smpp.constants.js";

import type {
  SmppBindType,
} from "./types/smpp-bind.types.js";

import type { SmppSessionInfo } from "./types/smpp.types.js";

export class SmppSession {
  private readonly logger = Loggers.smpp;

  private readonly sessionId = randomUUID();

  private state: SmppSessionState =
    SMPP_SESSION_STATES.CONNECTING;

  private systemId: string | undefined;

  private accountId: string | undefined;

  private clientId: string | undefined;

  private bindType: SmppBindType | undefined;

  private active = false;

  constructor(
    private readonly session: SmppLibrarySession,
  ) {
    this.registerLifecycleHandlers();
  }

  public get id(): string {
    return this.sessionId;
  }

  public get raw(): SmppLibrarySession {
    return this.session;
  }

  public get systemIdentifier(): string | undefined {
    return this.systemId;
  }

  public get currentState(): SmppSessionState {
    return this.state;
  }

  public get socket() {
    return this.session.socket;
  }

  public get authenticatedAccountId(): string | undefined {
    return this.accountId;
  }

  public get authenticatedClientId(): string | undefined {
    return this.clientId;
  }

  public get authenticatedSystemId(): string | undefined {
    return this.systemId;
  }

  public get currentBindType(): SmppBindType | undefined {
    return this.bindType;
  }

  public setConnected(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.state =
      SMPP_SESSION_STATES.CONNECTED;

    this.activate();

    this.logger.info(
      {
        sessionId:
          this.sessionId,
        remoteAddress:
          this.socket.remoteAddress,
        remotePort:
          this.socket.remotePort,
      },
      "SMPP session connected.",
    );
  }

  public setBound(options: {
    readonly systemId: string;
    readonly accountId: string;
    readonly clientId: string;
    readonly bindType: SmppBindType;
  }): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.systemId =
      options.systemId;

    this.accountId =
      options.accountId;

    this.clientId =
      options.clientId;

    this.bindType =
      options.bindType;

    this.state =
      SMPP_SESSION_STATES.BOUND;

    this.logger.info(
      {
        sessionId:
          this.sessionId,
        systemId:
          options.systemId,
        accountId:
          options.accountId,
        clientId:
          options.clientId,
        bindType:
          options.bindType,
      },
      "SMPP session bound.",
    );
  }

  public setUnbound(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.state =
      SMPP_SESSION_STATES.UNBOUND;

    this.logger.info(
      {
        sessionId:
          this.sessionId,
        systemId:
          this.systemId,
        accountId:
          this.accountId,
        clientId:
          this.clientId,
        bindType:
          this.bindType,
      },
      "SMPP session unbound.",
    );
  }

  public close(): void {
    if (
      this.state ===
      SMPP_SESSION_STATES.CLOSED
    ) {
      return;
    }

    this.session.close();
  }

  public sendSubmitSmResponse(options: {
    readonly sequence_number: number;
    readonly command_status: number;
    readonly message_id: string;
  }): void {
    this.session.submit_sm_resp(options);
  }

  public sendDeliverSmResponse(options: {
    readonly sequence_number: number;
    readonly command_status: number;
  }): void {
    this.session.deliver_sm_resp(options);
  }

  public sendEnquireLinkResponse(options: {
    readonly sequence_number: number;
    readonly command_status: number;
  }): void {
    this.session.enquire_link_resp(options);
  }

  public sendUnbindResponse(options: {
    readonly sequence_number: number;
    readonly command_status: number;
  }): void {
    this.session.unbind_resp(options);
  }

  public info(): SmppSessionInfo {
    return {
      sessionId:
        this.sessionId,

      state:
        this.state,

      systemId:
        this.systemId,

      remoteAddress:
        this.socket.remoteAddress,

      remotePort:
        this.socket.remotePort,
    };
  }

  private registerLifecycleHandlers(): void {
    this.session.on(
      "connect",
      () => {
        this.setConnected();
      },
    );

    this.session.on(
      "close",
      () => {
        this.handleClose();
      },
    );

    this.session.on(
      "error",
      (error: Error) => {
        this.logger.error(
          {
            err: error,
            sessionId:
              this.sessionId,
          },
          "SMPP session error.",
        );
      },
    );
  }

  private activate(): void {
    if (this.active) {
      return;
    }

    this.active = true;

    incrementActiveSessions();
  }

  private deactivate(): void {
    if (!this.active) {
      return;
    }

    this.active = false;

    decrementActiveSessions();
  }

  private handleClose(): void {
    this.deactivate();

    this.state =
      SMPP_SESSION_STATES.CLOSED;

    this.logger.info(
      {
        sessionId:
          this.sessionId,
        systemId:
          this.systemId,
        accountId:
          this.accountId,
        clientId:
          this.clientId,
        bindType:
          this.bindType,
      },
      "SMPP session closed.",
    );
  }
}