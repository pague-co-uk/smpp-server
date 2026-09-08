import { Injectable } from "@nestjs/common";

import {
  Loggers
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
} from "./types/smpp-bind.types.js";

import { SmppSession } from "./smpp.session.js";
import type {
  SmppBindRequest,
} from "./types/smpp-bind.types.js";



@Injectable()
export class SmppBindHandler {
  private readonly logger = Loggers.smpp;
  constructor(
    private readonly authentication:
      SmppAuthenticationService,
  ) { }

  public register(
    session: SmppSession,
  ): void {
    session.raw.on(
      "bind_transceiver",
      (pdu: SmppPdu) => {
        void this.handleBindTransceiver(
          session,
          pdu,
        );
      },
    );

    session.raw.on(
      "bind_receiver",
      (pdu: SmppPdu) => {
        this.handleUnsupportedBind(
          session,
          pdu,
        );
      },
    );

    session.raw.on(
      "bind_transmitter",
      (pdu: SmppPdu) => {
        this.handleUnsupportedBind(
          session,
          pdu,
        );
      },
    );
  }

  private async handleBindTransceiver(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<void> {
    if (
      session.currentState ===
      "BOUND"
    ) {
      this.sendBindResponse(
        session.raw,
        pdu,
        0x00000005,
      );

      this.logger.warn(
        {
          sessionId: session.id,
          systemId: pdu.system_id,
        },
        "SMPP bind rejected: session is already bound.",
      );

      return;
    }

    const request: SmppBindRequest = {
      systemId: pdu.system_id,
      password: pdu.password,
      bindType:
        SMPP_BIND_TYPES.TRANSCEIVER,
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
        this.sendBindResponse(
          session.raw,
          pdu,
          this.mapAuthenticationResult(
            result.result,
          ),
        );

        return;
      }

      session.setBound({
        systemId: result.account.systemId,
        accountId: result.account.id,
        clientId: result.account.clientId,
      });

      this.sendBindResponse(
        session.raw,
        pdu,
        0x00000000,
      );

      this.logger.info(
        {
          sessionId: session.id,
          systemId: result.account.systemId,
          accountId: result.account.id,
          clientId: result.account.clientId,
        },
        "SMPP bind accepted.",
      );
    } catch (error) {
      this.logger.error(
        {
          err: error,
          sessionId: session.id,
          systemId: pdu.system_id,
        },
        "SMPP bind failed unexpectedly.",
      );

      this.sendBindResponse(
        session.raw,
        pdu,
        0x00000008,
      );
    }
  }

  private handleUnsupportedBind(
    session: SmppSession,
    pdu: SmppPdu,
  ): void {
    this.sendBindResponse(
      session.raw,
      pdu,
      0x00000003,
    );

    this.logger.warn(
      {
        sessionId: session.id,
        systemId: pdu.system_id,
        command: pdu.command,
      },
      "SMPP bind rejected: bind type not supported.",
    );
  }

  private sendBindResponse(
    rawSession: SmppLibrarySession,
    pdu: SmppPdu,
    commandStatus: number,
  ): void {
    rawSession.bind_transceiver_resp({
      sequence_number:
        pdu.sequence_number,
      command_status: commandStatus,
      system_id: "",
    });
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
        return 0x0000000f;

      case SMPP_AUTH_RESULTS.INVALID_PASSWORD:
        return 0x0000000e;

      case SMPP_AUTH_RESULTS.ACCOUNT_DISABLED:
      case SMPP_AUTH_RESULTS.ACCOUNT_SUSPENDED:
      case SMPP_AUTH_RESULTS.IP_NOT_ALLOWED:
        return 0x0000000f;

      default:
        return 0x00000008;
    }
  }
}