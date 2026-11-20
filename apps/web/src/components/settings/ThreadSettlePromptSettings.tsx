import { useGT } from "gt-react";
import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { useSearchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ThreadSettlePromptSettings() {
  const gt = useGT();
  const searchableSetting = useSearchableSetting();
  const settings = useScopedSettings();
  const { targets } = useSettingsScope();
  const scopeKey = targets.map((target) => `${target.environmentId}:${target.projectId}`).join(",");
  const edited = useRef(false);
  const updateSettings = useUpdateScopedSettings();
  const mixed = useScopedSettingsMixed(["threadSettlePrompt"]);

  return (
    <SettingsRow
      serverScoped
      settingKeys={["threadSettlePrompt"]}
      {...searchableSetting("thread-settle-prompt")}
      description={gt(
        "Sent to the agent when a finished thread settles. Leave empty to disable. Runs an extra turn before cleanup.",
      )}
      resetAction={
        mixed || settings.threadSettlePrompt !== "" ? (
          <SettingResetButton
            ariaLabel={gt("Reset prompt to run on settle")}
            onClick={() => updateSettings({ threadSettlePrompt: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.threadSettlePrompt}`}
          aria-label={gt("Prompt to run on settle")}
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={mixed ? "" : settings.threadSettlePrompt}
          placeholder={
            mixed
              ? gt("Mixed. Enter instructions to apply to all selected targets.")
              : gt("Summarise what changed and update the project notes.")
          }
          onBlur={(event) => {
            const value = event.target.value.trim();
            if (edited.current && (mixed || value !== settings.threadSettlePrompt))
              updateSettings({ threadSettlePrompt: value });
            edited.current = false;
          }}
        />
      </div>
    </SettingsRow>
  );
}
