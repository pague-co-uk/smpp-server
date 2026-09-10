import { Injectable } from "@nestjs/common";

import {
  Loggers,
} from "@pague-co-uk/sms-gateway-telemetry";

import type {
  SmppSession as SmppLibrarySession,
  SmppPdu,
} from "smpp";

import {
  SMPP_AUTH_RESULTS,
  SmppAuthenticationService,
} from "./smpp-authentication.service.js";

import {
  SMPP_BIND_TYPES,
  type SmppBindRequest,
  type SmppBindType,
} from "./types/smpp-bind.types.js";

import {
  SMPP_SESSION_STATES,
} from "./smpp.constants.js";

import {
  SmppSession,
} from "./smpp.session.js";

import {
  SmppSessionManager,
} from "./smpp.session-manager.js";

const SMPP_COMMAND_STATUS = {
  ESME_ROK:
    0x00000000,

  ESME_RINVBNDSTS:
    0x00000004,

  ESME_RSYSERR:
    0x00000008,

  ESME_RINVPASWD:
    0x0000000e,

  ESME_RINVSYSID:
    0x0000000f,
} as const;

@Injectable()
export class SmppBindHandler {
  private readonly logger =
    Loggers.smpp;

  constructor(
    private readonly authentication:
      SmppAuthenticationService,

    private readonly sessionManager:
      SmppSessionManager,
  ) { }

  public register(
    session: SmppSession,
  ): void {
    session.raw.on(
      "bind_transmitter",
      (pdu: SmppPdu) => {
        void this.handleBind(
          session,
          pdu,
          SMPP_BIND_TYPES.TRANSMITTER,
        );
      },
    );

    session.raw.on(
      "bind_receiver",
      (pdu: SmppPdu) => {
        void this.handleBind(
          session,
          pdu,
          SMPP_BIND_TYPES.RECEIVER,
        );
      },
    );

    session.raw.on(
      "bind_transceiver",
      (pdu: SmppPdu) => {
        void this.handleBind(
          session,
          pdu,
          SMPP_BIND_TYPES.TRANSCEIVER,
        );
      },
    );
  }

  private async handleBind(
    session: SmppSession,
    pdu: SmppPdu,
    bindType: SmppBindType,
  ): Promise<void> {
    if (
      session.currentState ===
      SMPP_SESSION_STATES.BOUND
    ) {
      this.sendBindResponse(
        session.raw,
        pdu,
        bindType,
        SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,
      );

      this.logger.warn(
        {
          sessionId:
            session.id,

          systemId:
            pdu.system_id,

          bindType,
        },
        "SMPP bind rejected: session is already bound.",
      );

      return;
    }

    const request:
      SmppBindRequest = {
      systemId:
        pdu.system_id,

      password:
        pdu.password,

      bindType,

      remoteAddress:
        session.socket.remoteAddress,
    };

    try {
      const result =
        await this.authentication.authenticate(
          request,
        );

      if (
        result.result !==
        SMPP_AUTH_RESULTS.SUCCESS
      ) {
        const commandStatus =
          this.mapAuthenticationResult(
            result.result,
          );

        this.sendBindResponse(
          session.raw,
          pdu,
          bindType,
          commandStatus,
        );

        this.logger.warn(
          {
            sessionId:
              session.id,

            systemId:
              pdu.system_id,

            bindType,

            result:
              result.result,
          },
          "SMPP bind rejected.",
        );

        return;
      }

      /**
       * Atomically check the account's bind limit
       * and reserve a slot for this session.
       *
       * This must happen immediately before setBound()
       * so that no asynchronous work can occur between
       * the limit check and the reservation.
       */
      const reserved =
        this.sessionManager.tryReserveBind(
          session.id,
          result.account.id,
          result.account.maxConcurrentBinds,
        );

      if (!reserved) {
        this.sendBindResponse(
          session.raw,
          pdu,
          bindType,
          SMPP_COMMAND_STATUS.ESME_RINVBNDSTS,
        );

        this.logger.warn(
          {
            sessionId:
              session.id,

            systemId:
              result.account.systemId,

            accountId:
              result.account.id,

            clientId:
              result.account.clientId,

            bindType,

            maxConcurrentBinds:
              result.account.maxConcurrentBinds,
          },
          "SMPP bind rejected: maximum concurrent binds reached.",
        );

        return;
      }

      session.setBound({
        systemId:
          result.account.systemId,

        accountId:
          result.account.id,

        clientId:
          result.account.clientId,

        bindType,
      });

      this.sendBindResponse(
        session.raw,
        pdu,
        bindType,
        SMPP_COMMAND_STATUS.ESME_ROK,
        result.account.systemId,
      );

      this.logger.info(
        {
          sessionId:
            session.id,

          systemId:
            result.account.systemId,

          accountId:
            result.account.id,

          clientId:
            result.account.clientId,

          bindType,

          maxConcurrentBinds:
            result.account.maxConcurrentBinds,
        },
        "SMPP bind accepted.",
      );
    } catch (error) {
      /**
       * If anything fails after a reservation was made,
       * release it so the slot is not leaked.
       *
       * releaseBind() is idempotent, so this is also
       * safe when no reservation exists.
       */
      this.sessionManager.releaseBind(
        session.id,
      );

      this.logger.error(
        {
          err: error,

          sessionId:
            session.id,

          systemId:
            pdu.system_id,

          bindType,
        },
        "SMPP bind failed unexpectedly.",
      );

      this.sendBindResponse(
        session.raw,
        pdu,
        bindType,
        SMPP_COMMAND_STATUS.ESME_RSYSERR,
      );
    }
  }

  private sendBindResponse(
    rawSession:
      SmppLibrarySession,

    pdu:
      SmppPdu,

    bindType:
      SmppBindType,

    commandStatus:
      number,

    systemId =
      "",
  ): void {
    const options = {
      sequence_number:
        pdu.sequence_number,

      command_status:
        commandStatus,

      system_id:
        systemId,
    };

    switch (bindType) {
      case SMPP_BIND_TYPES.TRANSMITTER:
        rawSession.bind_transmitter_resp(
          options,
        );
        return;

      case SMPP_BIND_TYPES.RECEIVER:
        rawSession.bind_receiver_resp(
          options,
        );
        return;

      case SMPP_BIND_TYPES.TRANSCEIVER:
        rawSession.bind_transceiver_resp(
          options,
        );
        return;
    }
  }

  private mapAuthenticationResult(
    result:
      | typeof SMPP_AUTH_RESULTS.INVALID_SYSTEM_ID
      | typeof SMPP_AUTH_RESULTS.INVALID_PASSWORD
      | typeof SMPP_AUTH_RESULTS.ACCOUNT_DISABLED
      | typeof SMPP_AUTH_RESULTS.ACCOUNT_SUSPENDED
      | typeof SMPP_AUTH_RESULTS.IP_NOT_ALLOWED,
  ): number {
    switch (result) {
      case SMPP_AUTH_RESULTS.INVALID_SYSTEM_ID:
        return SMPP_COMMAND_STATUS.ESME_RINVSYSID;

      case SMPP_AUTH_RESULTS.INVALID_PASSWORD:
        return SMPP_COMMAND_STATUS.ESME_RINVPASWD;

      case SMPP_AUTH_RESULTS.ACCOUNT_DISABLED:
      case SMPP_AUTH_RESULTS.ACCOUNT_SUSPENDED:
      case SMPP_AUTH_RESULTS.IP_NOT_ALLOWED:
        return SMPP_COMMAND_STATUS.ESME_RINVSYSID;

      default:
        return SMPP_COMMAND_STATUS.ESME_RSYSERR;
    }
  }
}