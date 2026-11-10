import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ModelSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { createModelCapabilities, createModelSelection } from "@t3tools/shared/model";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock(import("~/hooks/useSettings"), () => ({
  useEnvironmentSettings: (() => ({})) as never,
}));
vi.mock(import("~/state/environments"), () => ({
  useEnvironmentProviders: () => new Map(),
}));
vi.mock(import("~/modelSelection"), () => ({
  getCustomModelOptionsByInstance: (() => ({})) as never,
}));
// TraitsPicker reads this store only to persist composer drafts, which a callback replaces here.
vi.mock(import("../../composerDraftStore"), () => ({
  DraftId: undefined as never,
  clearComposerDraftsEnvironment: (() => undefined) as never,
  useComposerDraftStore: ((select: (store: unknown) => unknown) =>
    select({ setProviderModelOptions: () => undefined })) as never,
}));
vi.mock(import("~/providerInstances"), () => ({
  providerInstanceEntriesFor: (() => state.entries) as never,
}));
// The model menu has its own tests; here it only reports a model change.
vi.mock(import("../chat/ProviderModelPicker"), () => ({
  ProviderModelPicker: (({
    disabled,
    onInstanceModelChange,
  }: {
    disabled: boolean;
    onInstanceModelChange: (instanceId: string, model: string) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onInstanceModelChange("agent", "plain")}
    >
      Pick model
    </button>
  )) as never,
}));

import { IssueModelPicker } from "./IssueModelPicker";

const instanceId = ProviderInstanceId.make("agent");
const models: ReadonlyArray<ServerProviderModel> = [
  {
    slug: "deep",
    name: "Deep",
    isCustom: false,
    capabilities: createModelCapabilities({
      optionDescriptors: [
        {
          id: "thought_level",
          label: "Thinking",
          type: "select",
          role: "reasoning",
          currentValue: "medium",
          options: [
            { id: "low", label: "Low" },
            { id: "medium", label: "Medium" },
            { id: "high", label: "High" },
          ],
        },
      ],
    }),
  },
  {
    slug: "plain",
    name: "Plain",
    isCustom: false,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  },
];

function renderPicker(
  value: ModelSelection,
  onChange: (next: ModelSelection) => void,
  disabled = false,
) {
  state.entries = [{ instanceId, driverKind: ProviderDriverKind.make("acpRegistry"), models }];
  return render(
    <IssueModelPicker
      environmentId={EnvironmentId.make("env")}
      projectId={ProjectId.make("project")}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />,
    { router: false }, // no routes involved
  );
}

const effortButton = () => page.getByRole("button", { name: /Thinking|Medium/ });

it("sets the picked model's effort", async () => {
  const onChange = vi.fn();
  await using _screen = await renderPicker(createModelSelection(instanceId, "deep"), onChange);
  await userEvent.click(effortButton());
  await userEvent.click(page.getByRole("menuitemradio", { name: "High" }));
  expect(onChange).toHaveBeenLastCalledWith(
    createModelSelection(instanceId, "deep", [{ id: "thought_level", value: "high" }]),
  );
});

it("clears a picked effort when the model changes", async () => {
  const onChange = vi.fn();
  await using screen = await renderPicker(
    createModelSelection(instanceId, "deep", [{ id: "thought_level", value: "high" }]),
    onChange,
  );
  await userEvent.click(screen.getByRole("button", { name: "Pick model" }));
  expect(onChange).toHaveBeenLastCalledWith(createModelSelection(instanceId, "plain"));
});

it("shows no effort control for a model without one", async () => {
  await using screen = await renderPicker(createModelSelection(instanceId, "plain"), vi.fn());
  await expect.element(screen.getByRole("button", { name: "Pick model" })).toBeInTheDocument();
  await expect.element(effortButton()).not.toBeInTheDocument();
});

it("disables the effort control while a dispatch is in flight", async () => {
  await using _screen = await renderPicker(createModelSelection(instanceId, "deep"), vi.fn(), true);
  await expect.element(effortButton()).toBeDisabled();
});
