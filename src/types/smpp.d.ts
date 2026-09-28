declare module "smpp" {
  import type { EventEmitter } from "node:events";
  import type { Socket } from "node:net";

  export type SmppShortMessage =
    | string
    | Buffer
    | Uint8Array
    | {
      readonly udh?:
      | Buffer
      | readonly Buffer[];
      readonly message:
      | string
      | Buffer
      | Uint8Array;
    };

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

    // submit_sm / deliver_sm fields
    readonly service_type: string;

    readonly source_addr_ton: number;
    readonly source_addr_npi: number;
    readonly source_addr: string;

    readonly dest_addr_ton: number;
    readonly dest_addr_npi: number;
    readonly destination_addr: string;

    readonly esm_class: number;
    readonly protocol_id: number;
    readonly priority_flag: number;

    readonly schedule_delivery_time: string;
    readonly validity_period: string;

    readonly registered_delivery: number;
    readonly replace_if_present_flag: number;

    readonly data_coding: number;
    readonly sm_default_msg_id: number;

    readonly short_message: SmppShortMessage;

    // submit_sm specific fields
    readonly message_payload?: SmppShortMessage;

    // deliver_sm optional fields
    readonly receipted_message_id?: string;
    readonly message_state?: number;
    readonly network_error_code?: Buffer;
  }

  export type SmppCommand =
    | "bind_receiver"
    | "bind_transmitter"
    | "bind_transceiver"
    | "submit_sm"
    | "submit_sm_resp"
    | "deliver_sm"
    | "deliver_sm_resp"
    | "enquire_link"
    | "enquire_link_resp"
    | "unbind"
    | "unbind_resp"
    | "generic_nack";

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
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): boolean;

    bind_receiver_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): boolean;

    bind_transmitter(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): boolean;

    bind_transmitter_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
        readonly system_id?: string;
      },
    ): boolean;

    bind_transceiver(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): boolean;

    bind_transceiver_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
        readonly system_id?: string;
      },
    ): boolean;

    submit_sm_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
        readonly message_id: string;
      },
    ): void;

    deliver_sm(
      options: {
        readonly service_type: string;

        readonly source_addr_ton: number;
        readonly source_addr_npi: number;
        readonly source_addr: string;

        readonly dest_addr_ton: number;
        readonly dest_addr_npi: number;
        readonly destination_addr: string;

        readonly esm_class: number;
        readonly protocol_id: number;
        readonly priority_flag: number;

        readonly schedule_delivery_time: string;
        readonly validity_period: string;

        readonly registered_delivery: number;
        readonly replace_if_present_flag: number;

        readonly data_coding: number;
        readonly sm_default_msg_id: number;

        readonly short_message: SmppShortMessage;
      },
    ): boolean;

    deliver_sm_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): void;

    enquire_link_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): void;

    unbind_resp(
      options: {
        readonly sequence_number: number;
        readonly command_status: number;
      },
    ): void;

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
      callback?: () => void,
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
    options: SmppServerOptions,
    listener?: (
      session: SmppSession,
    ) => void,
  ): SmppServer;
}