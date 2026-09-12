import type { SmppPdu } from "smpp";

export interface SmppReassembledMessage {
  /**
   * The complete logical message reconstructed from
   * the received multipart submit_sm PDUs.
   */
  readonly pdu: SmppPdu;

  /**
   * The unique logical message parts, ordered by
   * concatenation segment number.
   *
   * Duplicate segments are deliberately excluded because
   * their payload must not be included more than once.
   */
  readonly parts: readonly SmppPdu[];

  /**
   * Every submit_sm PDU received for this logical message.
   *
   * This includes duplicate segments and is retained so
   * the caller can acknowledge every original SMPP request
   * independently.
   */
  readonly acknowledgementParts: readonly SmppPdu[];

  /**
   * Concatenated message reference from the UDH.
   *
   * For an 8-bit reference this is 0..255.
   * For a 16-bit reference this is 0..65535.
   */
  readonly referenceNumber: number;

  /**
   * Number of expected segments.
   */
  readonly totalSegments: number;
}

export interface SmppReassemblyResult {
  /**
   * True when the incoming PDU can be processed as a
   * complete logical message.
   */
  readonly complete: boolean;

  /**
   * True when the multipart message is still waiting
   * for additional segments.
   */
  readonly pending: boolean;

  /**
   * True when a multipart message has been fully
   * reassembled.
   */
  readonly reassembled: boolean;

  /**
   * True when this PDU was a duplicate of an already
   * received logical segment.
   */
  readonly duplicate: boolean;

  /**
   * The complete logical message, when available.
   */
  readonly message?: SmppReassembledMessage;
}

export interface SmppExpiredReassembly {
  /**
   * Concatenated message reference.
   */
  readonly referenceNumber: number;

  /**
   * Number of expected segments.
   */
  readonly totalSegments: number;

  /**
   * Unique logical parts that were received before
   * expiry, ordered by segment number.
   */
  readonly parts: readonly SmppPdu[];

  /**
   * Every submit_sm PDU received before expiry,
   * including duplicates.
   *
   * These are the PDUs that should receive failure
   * responses while the SMPP session remains connected.
   */
  readonly acknowledgementParts: readonly SmppPdu[];
}

interface ConcatenationInfo {
  readonly referenceNumber: number;
  readonly totalSegments: number;
  readonly sequenceNumber: number;
}

interface StoredPart {
  readonly pdu: SmppPdu;
  readonly sequenceNumber: number;
}

interface PendingMessage {
  readonly key: string;
  readonly referenceNumber: number;
  readonly totalSegments: number;
  readonly sourceAddress: string;
  readonly destinationAddress: string;
  readonly dataCoding: number;
  readonly createdAt: number;

  /**
   * Unique logical segments indexed by concatenation
   * sequence number.
   */
  readonly parts: Map<number, StoredPart>;

  /**
   * Every received SMPP submit_sm PDU.
   *
   * Duplicate segments are retained here so that every
   * original request can eventually receive a response.
   */
  readonly acknowledgementParts: SmppPdu[];
}

/**
 * Reassembles SMPP concatenated SMS messages.
 *
 * The SMPP ESME is responsible for splitting a long SMS
 * into multiple submit_sm PDUs. This component performs
 * the inverse operation:
 *
 *     submit_sm #1 ─┐
 *     submit_sm #2 ─┼──> one logical message
 *     submit_sm #3 ─┘
 *
 * The reassembler does NOT submit anything to the API.
 * It also does NOT acknowledge SMPP PDUs.
 *
 * The caller remains responsible for:
 *
 * 1. submitting the reassembled message to the API;
 * 2. waiting for the API result;
 * 3. acknowledging every original PDU.
 *
 * A reassembler instance is intended to belong to one
 * SMPP session.
 */
export class SmppMessageReassembler {
  /**
   * Standard 8-bit concatenation SMS IEI.
   */
  private static readonly CONCATENATION_8BIT_IEI =
    0x00;

  /**
   * Standard 8-bit concatenation IE length.
   *
   *   reference
   *   total segments
   *   segment number
   */
  private static readonly CONCATENATION_8BIT_IE_LENGTH =
    0x03;

  /**
   * Standard 16-bit concatenation SMS IEI.
   */
  private static readonly CONCATENATION_16BIT_IEI =
    0x08;

  /**
   * Standard 16-bit concatenation IE length.
   *
   *   reference high byte
   *   reference low byte
   *   total segments
   *   segment number
   */
  private static readonly CONCATENATION_16BIT_IE_LENGTH =
    0x04;

  /**
   * SMPP UDHI flag in esm_class.
   */
  private static readonly UDHI_FLAG =
    0x40;

  /**
   * Default lifetime of an incomplete multipart
   * message.
   */
  private static readonly DEFAULT_TTL_MS =
    5 * 60 * 1000;

  /**
   * Pending multipart messages.
   */
  private readonly pending =
    new Map<string, PendingMessage>();

  private readonly ttlMs: number;

  constructor(
    ttlMs =
      SmppMessageReassembler.DEFAULT_TTL_MS,
  ) {
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs <= 0
    ) {
      throw new Error(
        "SMPP reassembler TTL must be a positive integer.",
      );
    }

    this.ttlMs = ttlMs;
  }

  /**
   * Accept an incoming submit_sm PDU.
   *
   * A normal single-part message is returned
   * immediately.
   *
   * A multipart message is buffered until all
   * segments have arrived.
   */
  public accept(
    pdu: SmppPdu,
  ): SmppReassemblyResult {
    const concatenation =
      this.parseConcatenationUdh(
        pdu,
      );

    /*
     * No concatenation UDH means this is an ordinary
     * submit_sm and should continue immediately.
     */
    if (!concatenation) {
      return {
        complete: true,

        pending: false,

        reassembled: false,

        duplicate: false,

        message: {
          pdu,

          parts: [
            pdu,
          ],

          acknowledgementParts: [
            pdu,
          ],

          referenceNumber: 0,

          totalSegments: 1,
        },
      };
    }

    const {
      referenceNumber,
      totalSegments,
      sequenceNumber,
    } = concatenation;

    /*
     * A concatenated message must contain at least
     * two segments.
     */
    if (
      totalSegments < 2
    ) {
      throw new Error(
        `Invalid SMPP concatenation UDH: total segments must be at least 2, received ${totalSegments}.`,
      );
    }

    if (
      sequenceNumber < 1 ||
      sequenceNumber > totalSegments
    ) {
      throw new Error(
        `Invalid SMPP concatenation UDH: sequence number ${sequenceNumber} is outside 1..${totalSegments}.`,
      );
    }

    const key =
      this.createKey(
        pdu,
        referenceNumber,
        totalSegments,
      );

    let pendingMessage =
      this.pending.get(
        key,
      );

    if (!pendingMessage) {
      pendingMessage = {
        key,

        referenceNumber,

        totalSegments,

        sourceAddress:
          pdu.source_addr ?? "",

        destinationAddress:
          pdu.destination_addr ?? "",

        dataCoding:
          pdu.data_coding ?? 0,

        createdAt:
          Date.now(),

        parts:
          new Map(),

        acknowledgementParts:
          [],
      };

      this.pending.set(
        key,
        pendingMessage,
      );
    }

    /*
     * Protect against inconsistent multipart metadata.
     */
    if (
      pendingMessage.totalSegments !==
      totalSegments
    ) {
      throw new Error(
        "SMPP multipart message contains inconsistent total segment counts.",
      );
    }

    if (
      pendingMessage.sourceAddress !==
      (pdu.source_addr ?? "")
    ) {
      throw new Error(
        "SMPP multipart message contains inconsistent source addresses.",
      );
    }

    if (
      pendingMessage.destinationAddress !==
      (pdu.destination_addr ?? "")
    ) {
      throw new Error(
        "SMPP multipart message contains inconsistent destination addresses.",
      );
    }

    if (
      pendingMessage.dataCoding !==
      (pdu.data_coding ?? 0)
    ) {
      throw new Error(
        "SMPP multipart message contains inconsistent data_coding values.",
      );
    }

    /*
     * Every received submit_sm PDU is retained for
     * acknowledgement purposes.
     *
     * This includes duplicates.
     */
    pendingMessage.acknowledgementParts.push(
      pdu,
    );

    /*
     * Duplicate logical segment.
     *
     * The first received copy remains the authoritative
     * payload for reassembly. The duplicate PDU is retained
     * in acknowledgementParts so it can receive its own
     * submit_sm_resp later.
     */
    if (
      pendingMessage.parts.has(
        sequenceNumber,
      )
    ) {
      return {
        complete: false,

        pending:
          pendingMessage.parts.size <
          pendingMessage.totalSegments,

        reassembled: false,

        duplicate: true,
      };
    }

    pendingMessage.parts.set(
      sequenceNumber,
      {
        pdu,

        sequenceNumber,
      },
    );

    /*
     * The logical message is not complete yet.
     */
    if (
      pendingMessage.parts.size <
      pendingMessage.totalSegments
    ) {
      return {
        complete: false,

        pending: true,

        reassembled: false,

        duplicate: false,
      };
    }

    const parts =
      this.getOrderedParts(
        pendingMessage,
      );

    const reassembledPdu =
      this.createReassembledPdu(
        parts,
      );

    /*
     * The logical message is complete, so remove it
     * from the pending collection.
     */
    this.pending.delete(
      key,
    );

    return {
      complete: true,

      pending: false,

      reassembled: true,

      duplicate: false,

      message: {
        pdu:
          reassembledPdu,

        parts,

        acknowledgementParts:
          [
            ...pendingMessage.acknowledgementParts,
          ],

        referenceNumber,

        totalSegments,
      },
    };
  }
  /**
   * Remove expired incomplete multipart messages.
   *
   * The returned objects contain the PDUs that were
   * received for each expired logical message so the
   * caller can reject them while the SMPP session remains
   * connected.
   */
  public expire(): SmppExpiredReassembly[] {
    const now =
      Date.now();

    const expired:
      SmppExpiredReassembly[] = [];

    for (
      const [
        key,
        message,
      ] of this.pending
    ) {
      if (
        now -
        message.createdAt >=
        this.ttlMs
      ) {
        const parts =
          this.getOrderedReceivedParts(
            message,
          );

        expired.push({
          referenceNumber:
            message.referenceNumber,

          totalSegments:
            message.totalSegments,

          parts,

          acknowledgementParts:
            [
              ...message.acknowledgementParts,
            ],
        });

        this.pending.delete(
          key,
        );
      }
    }

    return expired;
  }

  /**
   * Remove all pending multipart messages.
   *
   * Primarily useful during graceful shutdown or
   * when the SMPP session closes.
   *
   * No SMPP responses are generated because the
   * caller may no longer have an active connection.
   */
  public clear(): void {
    this.pending.clear();
  }

  /**
   * Number of multipart messages currently waiting
   * for additional segments.
   */
  public get pendingCount(): number {
    return this.pending.size;
  }

  /**
   * Parse the concatenation UDH.
   *
   * node-smpp exposes the UDH payload without the
   * leading UDHL byte.
   *
   * 8-bit concatenation:
   *
   *   00 03 XX NN PP
   *
   * 16-bit concatenation:
   *
   *   08 04 XX XX NN PP
   *
   * where:
   *
   *   XX     = reference
   *   NN     = total segments
   *   PP     = sequence number
   */
  private parseConcatenationUdh(
    pdu: SmppPdu,
  ): ConcatenationInfo | undefined {
    /*
     * UDHI must be set for a UDH to be present.
     */
    if (
      (
        (pdu.esm_class ?? 0) &
        SmppMessageReassembler.UDHI_FLAG
      ) ===
      0
    ) {
      return undefined;
    }

    const payload =
      pdu.short_message;

    /*
     * node-smpp represents a UDH-bearing message as:
     *
     * {
     *   udh: [Buffer],
     *   message: ...
     * }
     */
    if (
      !payload ||
      typeof payload !== "object" ||
      Buffer.isBuffer(payload) ||
      payload instanceof Uint8Array
    ) {
      return undefined;
    }

    if (
      !("udh" in payload)
    ) {
      return undefined;
    }

    const rawUdh =
      payload.udh;

    let udh: Buffer;

    /*
     * node-smpp currently exposes:
     *
     * udh: [Buffer]
     */
    if (
      Array.isArray(rawUdh)
    ) {
      if (
        rawUdh.length === 0 ||
        !Buffer.isBuffer(
          rawUdh[0],
        )
      ) {
        return undefined;
      }

      udh =
        rawUdh[0];
    } else if (
      Buffer.isBuffer(rawUdh)
    ) {
      udh =
        rawUdh;
    } else {
      return undefined;
    }

    /*
     * The smallest supported concatenation IE is the
     * 8-bit format:
     *
     *   00 03 XX NN PP
     */
    if (
      udh.length < 5
    ) {
      return undefined;
    }

    let offset = 0;

    while (
      offset + 2 <=
      udh.length
    ) {
      const iei =
        udh[offset];

      const ieLength =
        udh[offset + 1];

      offset += 2;

      if (
        offset + ieLength >
        udh.length
      ) {
        throw new Error(
          "Invalid SMPP UDH: information element exceeds UDH payload.",
        );
      }

      /*
       * Standard 8-bit concatenation IE:
       *
       *   IEI       = 00
       *   Length    = 03
       *   Reference = XX
       *   Total     = NN
       *   Sequence  = PP
       */
      if (
        iei ===
        SmppMessageReassembler.CONCATENATION_8BIT_IEI &&
        ieLength ===
        SmppMessageReassembler.CONCATENATION_8BIT_IE_LENGTH
      ) {
        return {
          referenceNumber:
            udh[offset],

          totalSegments:
            udh[offset + 1],

          sequenceNumber:
            udh[offset + 2],
        };
      }

      /*
       * Standard 16-bit concatenation IE:
       *
       *   IEI       = 08
       *   Length    = 04
       *   Reference = XX XX
       *   Total     = NN
       *   Sequence  = PP
       */
      if (
        iei ===
        SmppMessageReassembler.CONCATENATION_16BIT_IEI &&
        ieLength ===
        SmppMessageReassembler.CONCATENATION_16BIT_IE_LENGTH
      ) {
        const referenceNumber =
          (
            udh[offset] << 8
          ) |
          udh[offset + 1];

        return {
          referenceNumber,

          totalSegments:
            udh[offset + 2],

          sequenceNumber:
            udh[offset + 3],
        };
      }

      offset +=
        ieLength;
    }

    return undefined;
  }

  /**
   * Build the key used to identify a multipart
   * logical message.
   *
   * The reassembler is session-scoped, so session ID
   * does not need to be included in the key.
   */
  private createKey(
    pdu: SmppPdu,
    referenceNumber: number,
    totalSegments: number,
  ): string {
    return [
      pdu.source_addr ?? "",

      pdu.destination_addr ?? "",

      pdu.data_coding ?? 0,

      referenceNumber,

      totalSegments,
    ].join("|");
  }

  /**
   * Return unique original PDUs in logical segment order.
   *
   * Every segment must be present before this method
   * is called for a completed message.
   */
  private getOrderedParts(
    pendingMessage: PendingMessage,
  ): SmppPdu[] {
    const parts: SmppPdu[] = [];

    for (
      let sequenceNumber = 1;
      sequenceNumber <=
      pendingMessage.totalSegments;
      sequenceNumber += 1
    ) {
      const part =
        pendingMessage.parts.get(
          sequenceNumber,
        );

      if (!part) {
        throw new Error(
          `SMPP multipart message is missing segment ${sequenceNumber}.`,
        );
      }

      parts.push(
        part.pdu,
      );
    }

    return parts;
  }

  /**
   * Return the unique parts that have been received
   * so far, ordered by segment number.
   *
   * Used when an incomplete multipart message expires.
   */
  private getOrderedReceivedParts(
    pendingMessage: PendingMessage,
  ): SmppPdu[] {
    return [
      ...pendingMessage.parts.entries(),
    ]
      .sort(
        (
          [sequenceA],
          [sequenceB],
        ) =>
          sequenceA -
          sequenceB,
      )
      .map(
        ([, part]) =>
          part.pdu,
      );
  }

  /**
   * Create the logical PDU that will be passed to
   * SmppSubmitService.
   *
   * The concatenation UDH is removed and the message
   * payloads are combined into one Buffer.
   */
  private createReassembledPdu(
    parts: readonly SmppPdu[],
  ): SmppPdu {
    if (
      parts.length === 0
    ) {
      throw new Error(
        "Cannot reassemble an empty SMPP message.",
      );
    }

    const first =
      parts[0];

    const message =
      this.concatenateMessagePayloads(
        parts,
      );

    return {
      ...first,

      /*
       * The logical message is no longer carrying the
       * concatenation UDH.
       */
      esm_class:
        (
          first.esm_class ??
          0
        ) &
        ~SmppMessageReassembler.UDHI_FLAG,

      /*
       * Pass only the complete message payload.
       * This deliberately does not contain the UDH.
       */
      short_message:
        message,
    };
  }

  /**
   * Concatenate the actual message payloads while
   * preserving their byte representation.
   *
   * No character decoding or encoding is performed here.
   */
  private concatenateMessagePayloads(
    parts: readonly SmppPdu[],
  ): Buffer {
    return Buffer.concat(
      parts.map(
        (part) =>
          this.extractMessagePayload(
            part.short_message,
          ),
      ),
    );
  }

  /**
   * Extract only the actual message payload from
   * node-smpp's short_message representation.
   *
   * The UDH itself is deliberately excluded.
   */
  private extractMessagePayload(
    payload: SmppPdu["short_message"],
  ): Buffer {
    if (
      typeof payload ===
      "string"
    ) {
      return Buffer.from(
        payload,
        "utf8",
      );
    }

    if (
      Buffer.isBuffer(payload)
    ) {
      return Buffer.from(
        payload,
      );
    }

    if (
      payload instanceof Uint8Array
    ) {
      return Buffer.from(
        payload,
      );
    }

    if (
      payload &&
      typeof payload ===
      "object" &&
      "message" in payload
    ) {
      const message =
        payload.message;

      if (
        typeof message ===
        "string"
      ) {
        return Buffer.from(
          message,
          "utf8",
        );
      }

      if (
        Buffer.isBuffer(message)
      ) {
        return Buffer.from(
          message,
        );
      }

      if (
        message instanceof
        Uint8Array
      ) {
        return Buffer.from(
          message,
        );
      }
    }

    throw new Error(
      "Unsupported SMPP short_message payload representation.",
    );
  }
}