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

type SmppMessageEncoding =
  | "GSM7"
  | "UCS2"
  | "BINARY";

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
     * Resolve and validate the SMPP data_coding before constructing the
     * request. Unsupported encodings are rejected rather than silently
     * being interpreted as GSM7.
     */
    const encoding =
      this.resolveEncoding(pdu);

    const requestBody = {
      sender:
        pdu.source_addr,

      destination:
        pdu.destination_addr,

      body:
        this.resolveMessageBody(
          pdu,
          encoding,
        ),

      encoding,
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

        encoding,
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

              Authorization:
                `Bearer ${this.config.api.apiKey}`,
            },

            body:
              JSON.stringify(
                requestBody,
              ),
          },
        );

      /*
       * A non-2xx response represents a deliberate API/business rejection.
       * It is not treated as an infrastructure failure.
       */
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
       * Business/API rejections are returned above as accepted: false.
       *
       * ServiceUnavailableException is preserved if an upstream layer
       * already produced one.
       *
       * Other errors include network failures, DNS failures, connection
       * failures, invalid API responses, and other infrastructure errors.
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
  // Message body
  // --------------------------------------------------------------------------

  /**
   * Resolves the actual message payload from node-smpp's short_message.
   *
   * node-smpp may expose short_message as:
   *
   *   string
   *
   *   Buffer
   *
   *   Uint8Array
   *
   *   {
   *     udh: Buffer | Buffer[],
   *     message: string | Buffer | Uint8Array
   *   }
   *
   * When UDH is present, only the message property is used. The UDH itself
   * is transport metadata and must never be sent to the Message API.
   */
  private resolveMessageBody(
    pdu: SmppPdu,
    encoding: SmppMessageEncoding,
  ): string {
    return this.normalizeMessagePayload(
      pdu.short_message as unknown,
      encoding,
    );
  }

  private normalizeMessagePayload(
    payload: unknown,
    encoding: SmppMessageEncoding,
  ): string {
    /*
     * Empty payload.
     */
    if (
      payload === null ||
      payload === undefined
    ) {
      return "";
    }

    /*
     * node-smpp normally provides decoded textual messages as strings.
     *
     * This is particularly important for UCS2: if node-smpp has already
     * decoded the payload into a JavaScript string, it must remain a string
     * and must not be converted to UTF-8 and subsequently decoded as UCS2.
     */
    if (
      typeof payload === "string"
    ) {
      return payload;
    }

    /*
     * Raw byte payload.
     */
    if (
      Buffer.isBuffer(payload)
    ) {
      return this.decodeBuffer(
        payload,
        encoding,
      );
    }

    /*
     * Uint8Array payload.
     */
    if (
      payload instanceof Uint8Array
    ) {
      return this.decodeBuffer(
        Buffer.from(payload),
        encoding,
      );
    }

    /*
     * node-smpp's UDH representation:
     *
     * {
     *   udh: [...],
     *   message: "Hello"
     * }
     *
     * Only the message property represents the actual message body.
     */
    if (
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload
    ) {
      const message =
        (
          payload as {
            readonly message?: unknown;
          }
        ).message;

      return this.normalizeMessagePayload(
        message,
        encoding,
      );
    }

    /*
     * Do not silently stringify unknown objects. Doing so was the source
     * of the previous "[object Object]" submission problem and could hide
     * malformed SMPP payloads.
     */
    throw new Error(
      "Unsupported SMPP short_message payload type.",
    );
  }

  // --------------------------------------------------------------------------
  // Buffer decoding
  // --------------------------------------------------------------------------

  private decodeBuffer(
    payload: Buffer,
    encoding: SmppMessageEncoding,
  ): string {
    if (
      payload.length === 0
    ) {
      return "";
    }

    switch (encoding) {
      case "UCS2":
        return this.decodeUcs2(
          payload,
        );

      case "BINARY":
        /*
         * Binary data is represented as hexadecimal text for the Message
         * API while preserving the exact byte values.
         */
        return payload.toString(
          "hex",
        );

      case "GSM7":
        /*
         * node-smpp normally exposes decoded GSM7/ASCII-compatible text
         * as a string. This branch handles a Buffer representation
         * defensively.
         */
        return payload.toString(
          "utf8",
        );
    }
  }

  // --------------------------------------------------------------------------
  // UCS2
  // --------------------------------------------------------------------------

  /**
   * SMPP UCS2 uses big-endian UTF-16 code units.
   *
   * Node's utf16le decoder expects little-endian data, so the bytes are
   * swapped before decoding.
   */
  private decodeUcs2(
    payload: Buffer,
  ): string {
    if (
      payload.length === 0
    ) {
      return "";
    }

    /*
     * A UCS2 payload must contain complete two-byte code units.
     */
    if (
      payload.length % 2 !== 0
    ) {
      throw new Error(
        "Invalid UCS2 SMPP payload: payload length must be even.",
      );
    }

    const littleEndian =
      Buffer.allocUnsafe(
        payload.length,
      );

    for (
      let index = 0;
      index < payload.length;
      index += 2
    ) {
      littleEndian[index] =
        payload[index + 1];

      littleEndian[index + 1] =
        payload[index];
    }

    return littleEndian.toString(
      "utf16le",
    );
  }

  // --------------------------------------------------------------------------
  // Encoding
  // --------------------------------------------------------------------------

  private resolveEncoding(
    pdu: SmppPdu,
  ): SmppMessageEncoding {
    /*
     * SMPP data_coding values supported by Pague:
     *
     * 0x00 = SMSC Default Alphabet
     * 0x01 = IA5 / ASCII
     * 0x03 = Latin-1
     * 0x04 = Octet / Binary
     * 0x08 = UCS2
     *
     * Pague currently exposes these through the Message API as:
     *
     *   GSM7
     *   BINARY
     *   UCS2
     *
     * Unknown data_coding values are rejected rather than silently falling
     * back to GSM7.
     */
    switch (pdu.data_coding) {
      case 0x00:
      case 0x01:
      case 0x03:
        return "GSM7";

      case 0x04:
        return "BINARY";

      case 0x08:
        return "UCS2";

      default:
        throw new Error(
          `Unsupported SMPP data_coding value: 0x${pdu.data_coding
            .toString(16)
            .padStart(2, "0")}.`,
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
     * Standardized API envelope:
     *
     * {
     *   data: {
     *     id,
     *     publicId
     *   }
     * }
     */
    if (
      "data" in payload &&
      payload.data
    ) {
      return payload.data;
    }

    /*
     * Tolerate a direct resource response as well.
     */
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
  // Error response
  // --------------------------------------------------------------------------

  private async readError(
    response: Response,
  ): Promise<MessageApiErrorResponse> {
    try {
      return (
        await response.json()
      ) as MessageApiErrorResponse;
    } catch {
      return {};
    }
  }
}