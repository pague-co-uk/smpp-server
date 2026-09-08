declare module "smpp" {
  import type { EventEmitter } from "node:events";
  import type { Socket } from "node:net";

  export interface SmppPdu {
    readonly command: string;
    readonly command_length: number;
    readonly command_id: number;
    command_status: number;
    sequence_number: number;

    readonly system_id: string;
    readonly password: string;
    readonly system_type: string;
    readonly interface_version: number;
    readonly addr_ton: number;
    readonly addr_npi: number;
    readonly address_range: string;
  }

  export interface SmppSession
    extends EventEmitter {
    readonly socket: Socket;

    send(
      pdu: SmppPdu,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_receiver(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_receiver_resp(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_transmitter(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_transmitter_resp(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_transceiver(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    bind_transceiver_resp(
      options?: Record<string, unknown>,
      responseCallback?: (
        pdu: SmppPdu,
      ) => void,
      sendCallback?: (
        pdu: SmppPdu,
      ) => void,
    ): boolean;

    close(): void;

    destroy(): void;
  }

  export interface SmppServer
    extends EventEmitter {
    readonly sessions: SmppSession[];

    listen(
      port: number,
      host?: string,
      callback?: () => void,
    ): this;

    close(
      callback?: (error?: Error) => void,
    ): this;
  }

  export interface SmppServerOptions {
    readonly debug?: boolean;
    readonly host?: string;
    readonly port?: number;
    readonly key?: string | Buffer;
    readonly cert?: string | Buffer;
  }

  export function createServer(
    options?: SmppServerOptions,
    listener?: (
      session: SmppSession,
    ) => void,
  ): SmppServer;

  export function createServer(
    listener: (
      session: SmppSession,
    ) => void,
  ): SmppServer;
}