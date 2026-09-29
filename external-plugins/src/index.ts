import type { Plugin } from "@opencode-ai/plugin"
import { bundledGlobalExtensions } from "../../agent-kernel-extension/src/custom-hw/extension/bundled-global-extensions"
import { composeGlobalExtensions } from "../../agent-kernel-extension/src/custom-hw/extension/global-extension"

// The pinned kernel has no native GlobalExtension bootstrap. Its public plugin
// loader invokes this bridge, which runs the same bundled registry.
export const CodeAgentPlugin: Plugin = async (input) => composeGlobalExtensions(bundledGlobalExtensions, input)
