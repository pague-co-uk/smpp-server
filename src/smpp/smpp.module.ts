import { Module } from "@nestjs/common";

import { ConfigModule } from "../config/config.module.js";

import { SmppAuthenticationService } from "./smpp-authentication.service.js";
import { SmppBindAuthorizationService } from "./smpp-bind-authorization.service.js";
import { SmppBindHandler } from "./smpp-bind.handler.js";
import { SmppCommandHandler } from "./smpp-command.handler.js";
import { SmppSubmitService } from "./smpp-submit.service.js";
import { SmppServer } from "./smpp.server.js";
import { SmppSessionManager } from "./smpp.session-manager.js";
import { SmppIpAllowlistService } from "./validation/smpp-ip-allowlist.service.js";

@Module({
  imports: [
    ConfigModule,
  ],

  providers: [
    SmppIpAllowlistService,
    SmppAuthenticationService,
    SmppBindAuthorizationService,
    SmppSubmitService,
    SmppBindHandler,
    SmppCommandHandler,
    SmppSessionManager,
    SmppServer,
  ],

  exports: [
    SmppServer,
    SmppSessionManager,
  ],
})
export class SmppModule { }