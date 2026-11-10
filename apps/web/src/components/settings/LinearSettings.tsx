import {
  type EnvironmentId,
  isSecretReference,
  type SettingsSecretValue,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { issueEnvironment } from "../../state/issues";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";
import { Label } from "../ui/label";
import { SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { SecretSourceInput, useSecretSources } from "./SecretSourceInput";

const NEW_KEY_URL = "https://linear.app/settings/account/security";

/** The Linear personal API key the Issues page lists and dispatches Linear issues with. */
export function LinearSettingsSection({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const saved = useEnvironmentSettings(environmentId, (settings) => settings.linear.apiKey);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "save Linear API key",
  });
  const viewer = useEnvironmentQuery(issueEnvironment.linearViewer({ environmentId, input: {} }));
  const secretSources = useSecretSources(environmentId);
  const [draft, setDraft] = useState<SettingsSecretValue | null>(null);
  const [saving, setSaving] = useState(false);
  const isSaved = typeof saved === "string" ? saved.length > 0 : true;
  const value = draft ?? (isSecretReference(saved) ? saved : "");
  const submission = typeof value === "string" ? value.trim() : value;

  const save = async (apiKey: SettingsSecretValue) => {
    setSaving(true);
    const result = await updateSettings({
      environmentId,
      input: { patch: { linear: { apiKey } } },
    });
    setSaving(false);
    if (result._tag === "Success") {
      setDraft(null);
      viewer.refresh();
    }
  };

  const id = `linear-api-key-${environmentId}`;
  return (
    <SettingsSection {...searchableSetting("linear")}>
      <form
        className="grid gap-3 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (submission !== "") void save(submission);
        }}
      >
        {/* Locked while saving: a successful save clears the draft, which would drop edits made mid-request. */}
        <fieldset disabled={saving} className="contents">
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Lists your Linear issues on the Issues page next to GitHub issues, and moves an issue to
            In Progress when you dispatch it. A key saved here is used before{" "}
            <code className="rounded bg-muted px-1 py-px text-2xs">LINEAR_API_KEY</code>.{" "}
            <InlineButton
              render={<a href={NEW_KEY_URL} target="_blank" rel="noreferrer noopener" />}
            >
              Create a key
              <ExternalLinkIcon aria-hidden className="size-3" />
            </InlineButton>
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>Personal API key</Label>
            <SecretSourceInput
              id={id}
              size="sm"
              aria-label="Linear API key"
              placeholder="lin_api_…"
              configured={isSaved && !isSecretReference(saved)}
              value={value}
              sources={secretSources}
              onChange={(event) => setDraft(event.target.value)}
              onSecretChange={(secret) => setDraft(secret ?? "")}
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {/* A refresh that fails keeps the last data; the error is the current answer. */}
              {viewer.error !== null
                ? isSaved
                  ? viewer.error
                  : "Not connected."
                : viewer.data !== null
                  ? `Connected as ${viewer.data.name} in ${viewer.data.organization}.`
                  : "Checking the connection…"}
            </p>
            <div className="flex shrink-0 gap-2">
              {isSaved ? (
                <Button size="xs" variant="outline" disabled={saving} onClick={() => void save("")}>
                  Remove
                </Button>
              ) : null}
              <Button type="submit" size="xs" disabled={submission === "" || saving}>
                Save
              </Button>
            </div>
          </div>
        </fieldset>
      </form>
    </SettingsSection>
  );
}
