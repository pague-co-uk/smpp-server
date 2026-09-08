                         ┌──────────────────────┐
                         │      SMPP Client     │
                         └──────────┬───────────┘
                                    │
                         SMPP TCP / PDUs
                                    │
                                    ▼
                         ┌──────────────────────┐
                         │     Pague SMPP       │
                         │       Server         │
                         │                      │
                         │  Bind / Auth         │
                         │  Sessions            │
                         │  submit_sm           │
                         │  enquire_link        │
                         │  unbind              │
                         │  deliver_sm          │
                         └──────────┬───────────┘
                                    │
                              RabbitMQ
                                    │
                 ┌──────────────────┴──────────────────┐
                 │                                     │
                 ▼                                     ▲
          Message Ingestion                       Status Events
                 │                                     │
                 ▼                                     │
          Routing Service                              │
                 │                                     │
          ┌──────┴──────┐                              │
          │             │                              │
          ▼             ▼                              │
   HTTP Connector   SMPP Connector                     │
          │             │                              │
          ▼             ▼                              │
       Provider       SMSC                             │
          │             │                              │
          └──────┬──────┘                              │
                 │                                     │
                 └──────── results / DLRs ─────────────┘