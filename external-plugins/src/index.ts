import type { Plugin } from "@opencode-ai/plugin"
import { bundledGlobalExtensions } from "../../agent-kernel-extension/src/custom-hw/extension/bundled-global-extensions"
import { composeGlobalExtensions } from "../../agent-kernel-extension/src/custom-hw/extension/global-extension"
import { SteeringPlugin } from "./steering"
import { composeSteeringHooks } from "./steering/compose.ts"

// The pinned kernel has no native GlobalExtension bootstrap. Its public plugin
// loader invokes this bridge, which runs the same bundled registry.
export const CodeAgentPlugin: Plugin = async (input) => composeSteeringHooks(
  await composeGlobalExtensions(bundledGlobalExtensions, input),
  await SteeringPlugin(input),
)
