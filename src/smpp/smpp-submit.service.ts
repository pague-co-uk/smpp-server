import {
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";

import {
  Loggers,
  recordException,
} from "@pague-co-uk/sms-gateway-telemetry";

import type { SmppPdu } from "smpp";

import { AppConfigService } from "../config/config.service.js";

import type { SmppSession } from "./smpp.session.js";

// ============================================================================
// Types
// ============================================================================

export interface SmppSubmitResult {
  readonly accepted: boolean;
  readonly messageId?: string;
  readonly publicId?: string;
}

interface MessageResponse {
  readonly id: string;
  readonly publicId: string;
}

interface MessageApiResponse {
  readonly data?: MessageResponse;
  readonly message?: MessageResponse;
}

interface MessageApiErrorResponse {
  readonly message?: string;
  readonly error?: string;
  readonly errors?: readonly {
    readonly field?: string;
    readonly message?: string;
  }[];
}

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class SmppSubmitService {
  private readonly logger = Loggers.smpp;

  constructor(
    private readonly config: AppConfigService,
  ) { }

  // --------------------------------------------------------------------------
  // Submit
  // --------------------------------------------------------------------------

  public async submit(
    session: SmppSession,
    pdu: SmppPdu,
  ): Promise<SmppSubmitResult> {
    const clientId =
      session.authenticatedClientId;

    if (!clientId) {
      throw new Error(
        "Cannot submit SMPP message without an authenticated client.",
      );
    }

    /*
     * source_addr is the human-readable Sender ID supplied by the SMPP
     * client, e.g. "PAGUE".
     *
     * The Control Plane API resolves this Sender ID to the internal
     * senderId UUID after validating that it belongs to the client and
     * is approved.
     */
    const requestBody = {
      sender:
        pdu.source_addr,

      destination:
        pdu.destination_addr,

      body:
        pdu.short_message,

      encoding:
        this.resolveEncoding(pdu),
    };

    this.logger.debug(
      {
        sessionId:
          session.id,

        clientId,

        systemId:
          session.authenticatedSystemId,

        sequenceNumber:
          pdu.sequence_number,

        encoding:
          requestBody.encoding,
      },
      "Submitting SMPP message to message API.",
    );

    try {
      const response =
        await fetch(
          `${this.config.api.baseUrl}/clients/${encodeURIComponent(clientId)}/messages`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify(
                requestBody,
              ),
          },
        );

      if (!response.ok) {
        const error =
          await this.readError(
            response,
          );

        this.logger.warn(
          {
            sessionId:
              session.id,

            clientId,

            systemId:
              session.authenticatedSystemId,

            sequenceNumber:
              pdu.sequence_number,

            statusCode:
              response.status,

            errorMessage:
              error.message,
          },
          "Message API rejected SMPP message.",
        );

        return {
          accepted: false,
        };
      }

      const result =
        await this.readSuccess(
          response,
        );

      if (
        !result.id ||
        !result.publicId
      ) {
        throw new Error(
          "Message API returned an invalid message response.",
        );
      }

      this.logger.info(
        {
          sessionId:
            session.id,

          clientId,

          systemId:
            session.authenticatedSystemId,

          sequenceNumber:
            pdu.sequence_number,

          messageId:
            result.id,

          publicId:
            result.publicId,
        },
        "SMPP message accepted by message API.",
      );

      return {
        accepted: true,

        messageId:
          result.id,

        publicId:
          result.publicId,
      };
    } catch (error) {
      recordException(error);

      /*
       * Do not convert a deliberate message rejection into a service
       * unavailable error. Business/API rejections are returned above.
       *
       * Errors reaching the API, invalid API responses, DNS failures,
       * connection failures, etc. are infrastructure failures.
       */
      if (
        error instanceof
        ServiceUnavailableException
      ) {
        throw error;
      }

      this.logger.error(
        {
          err: error,

          sessionId:
            session.id,

          clientId,

          systemId:
            session.authenticatedSystemId,

          sequenceNumber:
            pdu.sequence_number,
        },
        "Failed to submit SMPP message to message API.",
      );

      throw new ServiceUnavailableException(
        "Message ingestion service is unavailable.",
      );
    }
  }

  // --------------------------------------------------------------------------
  // Success response
  // --------------------------------------------------------------------------

  private async readSuccess(
    response: Response,
  ): Promise<MessageResponse> {
    const payload =
      (await response.json()) as
      | MessageResponse
      | MessageApiResponse;

    /*
     * Support the standardized API envelope if the controller returns:
     *
     * {
     *   data: {
     *     id,
     *     publicId
     *   }
     * }
     *
     * while also tolerating a direct resource response.
     */
    if (
      "data" in payload &&
      payload.data
    ) {
      return payload.data;
    }

    if (
      "id" in payload &&
      "publicId" in payload
    ) {
      return payload;
    }

    throw new Error(
      "Message API returned an invalid message response.",
    );
  }

  // --------------------------------------------------------------------------
  // Encoding
  // --------------------------------------------------------------------------

  private resolveEncoding(
    pdu: SmppPdu,
  ): "GSM7" | "UCS2" | "BINARY" {
    /*
     * SMPP data_coding values:
     *
     * 0x00 = SMSC Default Alphabet
     * 0x01 = IA5 / ASCII
     * 0x03 = Latin-1
     * 0x04 = Octet
     * 0x08 = UCS2
     *
     * Pague currently exposes GSM7, UCS2 and BINARY
     * to the message API.
     */

    switch (pdu.data_coding) {
      case 0x08:
        return "UCS2";

      case 0x04:
        return "BINARY";

      case 0x00:
      case 0x01:
      case 0x03:
      default:
        return "GSM7";
    }
  }

  // --------------------------------------------------------------------------
  // Error response
  // --------------------------------------------------------------------------

  private async readError(
    response: Response,
  ): Promise<MessageApiErrorResponse> {
    try {
      return (await response.json()) as MessageApiErrorResponse;
    } catch {
      return {};
    }
  }
}