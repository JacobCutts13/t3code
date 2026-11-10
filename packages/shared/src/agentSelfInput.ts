import { type SelfInvocation, selfInvocationArgs } from "./nodeRuntime.ts";

/**
 * How an interface tells an agent to reach its own session: the name of an environment variable
 * whose value is a shell command that reads text on stdin and delivers it to that agent as its
 * next user input. A skill can then give the agent input, such as `/goal`, without knowing which
 * interface runs it.
 */
export const AGENT_SELF_INPUT_ENV = "AGENT_SELF_INPUT";

const shellQuote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/**
 * The command for an agent in a T3 thread: `t3 thread send` to its own thread, which a busy thread
 * queues as its next turn. `$T3CODE_THREAD_ID` is expanded in the agent's shell, where it is set.
 */
export function agentSelfInputCommand(self: SelfInvocation): string {
  const words = [self.command, ...selfInvocationArgs(self, ["thread", "send"])].map(shellQuote);
  return `${words.join(" ")} "$T3CODE_THREAD_ID" -`;
}
