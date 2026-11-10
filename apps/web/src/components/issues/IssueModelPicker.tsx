import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";

import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";

/** T3's model and effort pickers, listing what the project's environment offers. */
export function IssueModelPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly value: ModelSelection | null;
  readonly disabled?: boolean;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const settings = useEnvironmentSettings(props.environmentId);
  const providers = useEnvironmentProviders().get(props.environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = providerInstanceEntriesFor(providers, settings, props.projectId);
  const first = instanceEntries[0];
  if (first === undefined) return null;
  const activeInstanceId = props.value?.instanceId ?? first.instanceId;
  const activeEntry = instanceEntries.find((entry) => entry.instanceId === activeInstanceId);
  const model = props.value?.model ?? "";
  const disabled = props.disabled === true;
  return (
    <div className="flex items-center gap-1.5">
      <ProviderModelPicker
        environmentId={props.environmentId}
        disabled={disabled}
        activeInstanceId={activeInstanceId}
        model={model}
        lockedProvider={null}
        instanceEntries={instanceEntries}
        modelOptionsByInstance={getCustomModelOptionsByInstance(
          settings,
          providers,
          activeInstanceId,
          model,
        )}
        isComposerOwned={false}
        popupAlign="end"
        onInstanceModelChange={(instanceId, nextModel) =>
          props.onChange(createModelSelection(instanceId, nextModel))
        }
      />
      {activeEntry === undefined ? null : (
        <TraitsPicker
          provider={activeEntry.driverKind}
          instanceId={activeInstanceId}
          models={activeEntry.models}
          model={model}
          modelOptions={props.value?.options ?? []}
          // The first message starts with /complete-task, so a prompt-injected effort never applies.
          allowPromptInjectedEffort={false}
          disabled={disabled}
          onModelOptionsChange={(options) =>
            props.onChange(createModelSelection(activeInstanceId, model, options))
          }
        />
      )}
    </div>
  );
}
