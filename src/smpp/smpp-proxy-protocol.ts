import {
  isIP,
  type Socket,
} from "node:net";

const PROXY_PROTOCOL_MAX_HEADER_LENGTH = 107;
const PROXY_PROTOCOL_TIMEOUT_MS = 10_000;

export interface SmppProxyProtocolInfo {
  readonly remoteAddress: string;
  readonly remotePort: number;
  readonly proxyAddress: string;
  readonly proxyPort: number;
}

export interface SmppProxyProtocolResult {
  readonly info: SmppProxyProtocolInfo;
  readonly remaining: Buffer;
}

export async function readSmppProxyProtocol(
  socket: Socket,
): Promise<SmppProxyProtocolResult> {
  socket.pause();

  return new Promise(
    (resolve, reject) => {
      let buffer = Buffer.alloc(0);

      let settled = false;

      const timeout =
        setTimeout(
          () => {
            fail(
              new Error(
                "Timed out waiting for PROXY protocol header.",
              ),
            );
          },
          PROXY_PROTOCOL_TIMEOUT_MS,
        );

      const cleanup =
        (): void => {
          clearTimeout(timeout);

          socket.removeListener(
            "readable",
            onReadable,
          );

          socket.removeListener(
            "error",
            onError,
          );

          socket.removeListener(
            "close",
            onClose,
          );
        };

      const fail =
        (error: Error): void => {
          if (settled) {
            return;
          }

          settled = true;

          cleanup();

          reject(error);
        };

      const succeed =
        (
          result:
            SmppProxyProtocolResult,
        ): void => {
          if (settled) {
            return;
          }

          settled = true;

          cleanup();

          resolve(result);
        };

      const onError =
        (error: Error): void => {
          fail(error);
        };

      const onClose =
        (): void => {
          fail(
            new Error(
              "SMPP connection closed before PROXY protocol header was received.",
            ),
          );
        };

      const onReadable =
        (): void => {
          while (!settled) {
            const chunk =
              socket.read();

            if (
              chunk === null
            ) {
              return;
            }

            buffer =
              Buffer.concat([
                buffer,
                chunk,
              ]);

            const crlfIndex =
              buffer.indexOf(
                "\r\n",
              );

            if (
              crlfIndex === -1
            ) {
              if (
                buffer.length >
                PROXY_PROTOCOL_MAX_HEADER_LENGTH +
                2
              ) {
                fail(
                  new Error(
                    "PROXY protocol header is too long.",
                  ),
                );
              }

              continue;
            }

            if (
              crlfIndex >
              PROXY_PROTOCOL_MAX_HEADER_LENGTH
            ) {
              fail(
                new Error(
                  "PROXY protocol header is too long.",
                ),
              );

              return;
            }

            const header =
              buffer
                .subarray(
                  0,
                  crlfIndex,
                )
                .toString(
                  "ascii",
                );

            const remaining =
              buffer.subarray(
                crlfIndex + 2,
              );

            const info =
              parseProxyHeader(
                header,
              );

            succeed({
              info,
              remaining,
            });

            return;
          }
        };

      socket.on(
        "readable",
        onReadable,
      );

      socket.once(
        "error",
        onError,
      );

      socket.once(
        "close",
        onClose,
      );

      onReadable();
    },
  );
}

function parseProxyHeader(
  header: string,
): SmppProxyProtocolInfo {
  if (
    !header.startsWith(
      "PROXY ",
    )
  ) {
    throw new Error(
      "Invalid PROXY protocol header.",
    );
  }

  const parts =
    header.split(" ");

  if (
    parts.length !== 6
  ) {
    throw new Error(
      "Invalid PROXY protocol header format.",
    );
  }

  const [
    protocol,
    sourceAddress,
    destinationAddress,
    sourcePort,
    destinationPort,
  ] =
    parts.slice(1);

  if (
    protocol !== "TCP4" &&
    protocol !== "TCP6"
  ) {
    throw new Error(
      `Unsupported PROXY protocol transport: ${protocol}.`,
    );
  }

  const expectedIpVersion =
    protocol === "TCP4"
      ? 4
      : 6;

  if (
    isIP(sourceAddress) !==
    expectedIpVersion
  ) {
    throw new Error(
      "Invalid PROXY protocol source address.",
    );
  }

  if (
    isIP(destinationAddress) !==
    expectedIpVersion
  ) {
    throw new Error(
      "Invalid PROXY protocol destination address.",
    );
  }

  const remotePort =
    Number(sourcePort);

  const proxyPort =
    Number(destinationPort);

  if (
    !Number.isInteger(
      remotePort,
    ) ||
    remotePort < 1 ||
    remotePort > 65535
  ) {
    throw new Error(
      "Invalid PROXY protocol source port.",
    );
  }

  if (
    !Number.isInteger(
      proxyPort,
    ) ||
    proxyPort < 1 ||
    proxyPort > 65535
  ) {
    throw new Error(
      "Invalid PROXY protocol destination port.",
    );
  }

  return {
    remoteAddress:
      sourceAddress,

    remotePort,

    proxyAddress:
      destinationAddress,

    proxyPort,
  };
}