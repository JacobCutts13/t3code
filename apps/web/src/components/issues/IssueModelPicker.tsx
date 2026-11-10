import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";

import { useEnvironmentSettings } from "~/hooks/useSettings";
import { getCustomModelOptionsByInstance } from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";

import { ProviderModelPicker } from "../chat/ProviderModelPicker";

/** T3's model picker, listing what the project's environment offers. */
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
  const model = props.value?.model ?? "";
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
      onInstanceModelChange={(instanceId, nextModel) =>
        props.onChange({ instanceId, model: nextModel })
      }
    />
  );
}
