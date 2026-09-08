const smpp = require("smpp");

const session = smpp.connect({
  host: "127.0.0.1",
  port: 2775,
});

session.on("connect", () => {
  console.log("Connected.");

  session.bind_transceiver(
    {
      system_id: "ACME_SMPP",
      password: "123456",
      system_type: "",
      interface_version: 0x50,
      addr_ton: 0,
      addr_npi: 0,
      address_range: "",
    },
    (pdu) => {
      console.log("Bind response:");
      console.dir(pdu, {
        depth: 3,
      });

      session.close();
    },
  );
});

session.on("error", (error) => {
  console.error("SMPP error:", error);
});

session.on("close", () => {
  console.log("Connection closed.");
});