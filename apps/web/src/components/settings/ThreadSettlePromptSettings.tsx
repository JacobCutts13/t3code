import { useRef } from "react";

import { Textarea } from "../ui/textarea";
import { SettingsRow, SettingResetButton } from "./settingsLayout";
import { useSettingsScope } from "./SettingsScopeContext";
import { searchableSetting } from "./settingsSearch";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

export function ThreadSettlePromptSettings() {
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
      description="Sent to the agent when a finished thread settles. Leave empty to disable. Runs an extra turn before cleanup."
      resetAction={
        mixed || settings.threadSettlePrompt !== "" ? (
          <SettingResetButton
            label="prompt to run on settle"
            onClick={() => updateSettings({ threadSettlePrompt: "" })}
          />
        ) : null
      }
    >
      <div className="mt-3 max-w-2xl pb-3.5">
        <Textarea
          key={`${scopeKey}:${mixed}:${settings.threadSettlePrompt}`}
          aria-label="Prompt to run on settle"
          onChange={() => {
            edited.current = true;
          }}
          rows={4}
          defaultValue={mixed ? "" : settings.threadSettlePrompt}
          placeholder={
            mixed
              ? "Mixed. Enter instructions to apply to all selected targets."
              : "Summarise what changed and update the project notes."
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
