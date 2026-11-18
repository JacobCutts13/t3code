import { useEffect, useEffectEvent, useRef } from "react";
import { View } from "react-native";

import { AppText as Text, AppTextInput } from "../../../components/ui/AppText";

export function SettlePromptField(props: {
  readonly value: string | null;
  readonly disabled: boolean;
  readonly onSave: (value: string) => void;
}) {
  const draft = useRef<{ text: string; over: string | null } | null>(null);
  const save = () => {
    const pending = draft.current;
    draft.current = null;
    if (pending === null || pending.over !== props.value) return;
    const value = pending.text.trim();
    if (props.value === null || value !== props.value) props.onSave(value);
  };
  const saveOnUnmount = useEffectEvent(save);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Android Back can leave editing active; save the draft when this field unmounts
  useEffect(() => () => saveOnUnmount(), []);

  return (
    <View className="gap-2 px-4 py-3">
      <Text className="text-lg text-foreground">Prompt to run on settle</Text>
      <Text className="text-sm text-foreground-muted">
        Sent to the agent when a finished thread settles. Leave empty to disable. Runs an extra turn
        before cleanup.
      </Text>
      <AppTextInput
        key={props.value}
        accessibilityLabel="Prompt to run on settle"
        defaultValue={props.value ?? ""}
        onChangeText={(text) => {
          draft.current = { text, over: props.value };
        }}
        onEndEditing={() => save()}
        placeholder={
          props.value === null
            ? "Mixed. Enter a prompt for all selected targets."
            : "Summarise what changed and update the project notes."
        }
        editable={!props.disabled}
        multiline
        autoCapitalize="sentences"
        className="min-h-24 rounded-xl px-3 py-2 text-base text-foreground"
      />
    </View>
  );
}
