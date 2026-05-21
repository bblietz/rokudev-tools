// Public surface re-exports — spec §2.3.
export * from './errors/index.js';
export {
  RegistryReader,
  RegistryWriter,
  parseRegistry,
  serializeRegistry,
} from './registry/index.js';
export type { Registry, DeviceEntry, NetworkEntry, NetworkTag } from './registry/index.js';
export {
  EcpClient,
  EcpControl,
  isAllowedKey,
  isAllowedInputParamKey,
  isAllowedLaunchParamKey,
} from './ecp/index.js';
export { DevPortal, DevPortalInspect, diffInstalled } from './devportal/index.js';
export type { SideloadResult, SideloadOptions } from './devportal/index.js';
export { TelnetClient, LogStream, type TelnetPort } from './telnet/index.js';
export { discover, type Discovered } from './discovery/index.js';
export {
  readFingerprint,
  classifyNetwork,
  isReachable,
  type Fingerprint,
} from './network/index.js';
export {
  BdpClient,
  BdpSession,
  SourceMapResolver,
  findSourceMap,
  HANDSHAKE_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  SUPPORTED_BDP_VERSIONS,
  type BdpSessionState,
  type BdpStoppedEvent,
  type BdpVersion,
  type BdpVersionRange,
  type BdpStopReason,
  type BdpStackFrame,
  type BdpVariable,
  type BdpBreakpointEntry,
  type BdpThreadEntry,
  type BdpRequest,
  type BdpResponse,
  type BdpUpdateEvent,
} from './bdp/index.js';
export const VERSION = '0.1.0';
