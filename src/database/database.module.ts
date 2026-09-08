import {
  Global,
  Module,
} from "@nestjs/common";

import {
  DATABASE,
} from "./database.constants.js";

import {
  databaseProvider,
} from "./database.provider.js";

@Global()
@Module({
  providers: [
    databaseProvider,
  ],

  exports: [
    DATABASE,
  ],
})
export class DatabaseModule { }