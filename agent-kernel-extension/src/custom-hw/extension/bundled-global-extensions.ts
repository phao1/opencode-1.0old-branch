import { CapabilityWatchExtension } from "../../codeagent/capability-watch/capability-watch-extension"
import { OneShotExtension } from "../../codeagent/one-shot/one-shot-extension"
import type { GlobalExtension } from "./global-extension"

export const bundledGlobalExtensions: GlobalExtension[] = [CapabilityWatchExtension, OneShotExtension]
