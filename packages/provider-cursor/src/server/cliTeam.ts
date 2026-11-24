import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";

const decodeCursorCliConfig = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      authInfo: Schema.optional(Schema.Struct({ teamId: Schema.optional(Schema.Int) })),
    }),
  ),
);

/**
 * The team the Cursor CLI is signed in to. Cloud requests without a team run under the account's
 * ambient team, which may not reach the repositories of the team the user works in.
 */
export const readCursorCliTeamId = Effect.fn("readCursorCliTeamId")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const hostEnvironment = yield* HostProcess.Environment;
  const cursorDataDirectory =
    hostEnvironment.CURSOR_DATA_DIR || path.join(yield* HostProcess.HomeDirectory, ".cursor");
  const contents = yield* fileSystem
    .readFileString(path.join(cursorDataDirectory, "cli-config.json"))
    .pipe(Effect.orElseSucceed(() => ""));
  const teamId = Option.getOrUndefined(decodeCursorCliConfig(contents))?.authInfo?.teamId;
  return teamId !== undefined && teamId > 0 ? teamId : undefined;
});
