import type {
  ProviderCloudEnvironmentSelection,
  ServerProviderCloudEnvironment,
} from "@t3tools/contracts";
import { useGT } from "gt-react";

import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import {
  cloudEnvironmentLabel,
  cloudEnvironmentSelection,
  sortCloudEnvironmentsForProject,
} from "./ProviderSettingsPanel.logic";
import { SettingsRow } from "./settingsLayout";

const RUN_LOCALLY = "";

export function CursorCloudEnvironmentRow({
  environments,
  projectRepository,
  value,
  hasProject,
  readOnly,
  onChange,
}: {
  readonly environments: ReadonlyArray<ServerProviderCloudEnvironment>;
  readonly projectRepository: string | undefined;
  readonly value: ProviderCloudEnvironmentSelection | undefined;
  readonly hasProject: boolean;
  readonly readOnly: boolean;
  readonly onChange: (next: ProviderCloudEnvironmentSelection | undefined) => void;
}) {
  const gt = useGT();
  const sorted = sortCloudEnvironmentsForProject(environments, projectRepository);
  const options = sorted.map((environment) => ({
    value: environment.id,
    label:
      environment.owner === "personal"
        ? gt("{environment} (personal)", {
            environment: cloudEnvironmentLabel(environment) ?? environment.id,
          })
        : (cloudEnvironmentLabel(environment) ?? environment.id),
  }));
  // A saved environment Cursor no longer lists still decides where threads run, so keep showing it.
  if (value !== undefined && !sorted.some((environment) => environment.id === value.id)) {
    options.push({ value: value.id, label: cloudEnvironmentLabel(value) ?? value.id });
  }
  const current = hasProject ? (value?.id ?? RUN_LOCALLY) : RUN_LOCALLY;
  const runLocally = gt("Run locally");
  const label = options.find((option) => option.value === current)?.label ?? runLocally;
  return (
    <SettingsRow
      title={gt("Cloud environment")}
      description={
        hasProject
          ? gt(
              "Cursor threads in this project start a Cursor Cloud agent from the pushed branch and open a pull request.",
            )
          : gt("Choose a project above to run its Cursor threads in a Cursor Cloud environment.")
      }
      control={
        <div className="w-full sm:w-80">
          <Select
            value={current}
            disabled={readOnly || !hasProject}
            onValueChange={(next) => {
              if (typeof next !== "string") return;
              const environment = sorted.find((candidate) => candidate.id === next);
              onChange(
                next === RUN_LOCALLY
                  ? undefined
                  : environment === undefined
                    ? value
                    : cloudEnvironmentSelection(environment),
              );
            }}
          >
            <SelectTrigger size="sm" aria-label={gt("Cloud environment")}>
              <SelectValue>{label}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="start" alignItemWithTrigger={false}>
              <SelectItem value={RUN_LOCALLY}>{runLocally}</SelectItem>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}
