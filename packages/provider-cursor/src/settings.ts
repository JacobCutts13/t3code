import { CustomModelSetting, makeProviderSettingsSchema, TrimmedString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const CursorRuntime = Schema.Literals(["local", "cloud"]);
export type CursorRuntime = typeof CursorRuntime.Type;

export const CursorSettings = makeProviderSettingsSchema(
  {
    enabled: Schema.Boolean.pipe(
      Schema.withDecodingDefault(Effect.succeed(false)),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    runtime: CursorRuntime.pipe(
      Schema.withDecodingDefault(Effect.succeed("local" as const)),
      Schema.annotateKey({
        title: "Runtime",
        description:
          "Cursor Cloud runs each thread on a Cursor-hosted VM against the project's pushed branch and opens a pull request.",
        providerSettingsForm: {
          control: "select",
          options: [
            { value: "local", label: "Local workspace" },
            { value: "cloud", label: "Cursor Cloud" },
          ],
        },
      }),
    ),
    // Preserve V1 CLI fields when V2's SDK rewrites shared settings.
    binaryPath: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    apiEndpoint: Schema.optionalKey(TrimmedString).pipe(
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
    customModels: Schema.Array(CustomModelSetting).pipe(
      Schema.withDecodingDefault(Effect.succeed([])),
      Schema.annotateKey({ providerSettingsForm: { hidden: true } }),
    ),
  },
  {
    order: ["runtime"],
  },
);
export type CursorSettings = typeof CursorSettings.Type;
