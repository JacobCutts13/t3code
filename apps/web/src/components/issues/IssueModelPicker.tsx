import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";

import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "../chat/ComposerModelEffort";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import type { TraitsSelectionInput } from "../chat/TraitsPicker";

/** The composer's model picker with its effort column, listing what the project's environment offers. */
export function IssueModelPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
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
  const traits: TraitsSelectionInput | null =
    activeEntry === undefined
      ? null
      : {
          provider: activeEntry.driverKind,
          instanceId: activeInstanceId,
          models: activeEntry.models,
          model,
          modelOptions: props.value?.options ?? [],
          // The first message starts with /complete-task, so a prompt-injected effort never applies.
          allowPromptInjectedEffort: false,
          onModelOptionsChange: (options) =>
            props.onChange(createModelSelection(activeInstanceId, model, options)),
        };
  const effort = describeComposerEffort(traits, settings.effortDisplay, "sm");
  return (
    <ProviderModelPicker
      environmentId={props.environmentId}
      disabled={props.disabled === true}
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
      triggerSuffix={effort.suffix}
      triggerDetail={effort.detail}
      effortColumn={<ComposerEffortColumn traits={traits} />}
      footer={<ComposerPickerFooter traits={traits} />}
      onInstanceModelChange={(instanceId, nextModel) =>
        props.onChange({ instanceId, model: nextModel })
      }
    />
  );
}
