// User-funded LLM subscription transports.
//
// These adapters deliberately invoke each provider's official CLI under an
// isolated per-user home. Provider API-key environment variables are removed
// before launch, so the only remote credential source is that user's cached
// OAuth/subscription login. AXIOM application code never reads token values;
// the official CLIs persist them in the user's isolated service-side profile.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ProviderError } from './types.js';
import { GrokMediaResult, type GrokMediaArtifact, type GrokMediaKind } from './grok-media.js';
import { grokSandboxCommand } from './grok-sandbox.js';
import { waitForLinuxProcessGroup } from './subscription-process.js';

export interface GrokMediaRequest {
  userId: string;
  kind: GrokMediaKind;
  prompt: string;
  aspectRatio?: 'auto' | '1:1' | '16:9' | '9:16' | '4:5' | '3:2' | '2:3';
  /** Required for image-to-video; bytes supplied by the authorized caller. */
  image?: Buffer;
  duration?: 6 | 10;
  signal?: AbortSignal;
}

export type SubscriptionProvider = 'openai' | 'anthropic' | 'grok';

export interface SubscriptionMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SubscriptionRequest {
  provider: SubscriptionProvider;
  userId: string;
  model: string;
  messages: SubscriptionMessage[];
  signal?: AbortSignal;
}

export interface SubscriptionUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface SubscriptionResult {
  content: string;
  model: string;
  usage: SubscriptionUsage;
}

export interface SubscriptionConnectionStatus {
  provider: SubscriptionProvider;
  connected: boolean;
}

export interface SubscriptionTransport {
  readonly providers: ReadonlySet<SubscriptionProvider>;
  chat(request: SubscriptionRequest): Promise<SubscriptionResult>;
  stream(request: SubscriptionRequest): AsyncIterable<string>;
  status(
    provider: SubscriptionProvider,
    userId: string,
    signal?: AbortSignal,
  ): Promise<SubscriptionConnectionStatus>;
  connect(
    provider: SubscriptionProvider,
    userId: string,
    signal?: AbortSignal,
  ): AsyncIterable<string>;
  disconnect(provider: SubscriptionProvider, userId: string, signal?: AbortSignal): Promise<void>;
}

type CommandSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  prompt: string;
  promptFile?: string;
  cwd?: string;
};

type ParsedLine = {
  chunks: string[];
  usage?: Partial<SubscriptionUsage>;
  fatal?: string;
};

const require = createRequire(import.meta.url);
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
// Provider CLIs are untrusted subprocess boundaries. Keep one malformed or
// newline-free JSON record from becoming an unbounded allocation, and cap the
// total stream retained by one completion. Valid output beyond these limits is
// rejected rather than truncated so callers never receive a misleading
// partial completion.
const SUBSCRIPTION_JSON_LINE_MAX_BYTES = 1 * 1024 * 1024;
const SUBSCRIPTION_STDOUT_MAX_BYTES = 4 * 1024 * 1024;
const SUBSCRIPTION_AUTH_OUTPUT_MAX_BYTES = 64 * 1024;
const SUBSCRIPTION_AUTH_LINE_MAX_BYTES = 64 * 1024;
const CHILD_ENVIRONMENT_KEYS = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'WINDIR',
  'LANG',
  'LC_ALL',
  'TERM',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
] as const;

function packageRoot(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

function executableFor(provider: SubscriptionProvider): { command: string; prefix: string[] } {
  if (provider === 'openai') {
    return {
      command: process.execPath,
      prefix: [join(packageRoot('@openai/codex'), 'bin', 'codex.js')],
    };
  }
  if (provider === 'grok') {
    return {
      command: process.env.AXIOM_GROK_CLI || join(homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok'),
      prefix: [],
    };
  }
  return {
    command: join(packageRoot('@anthropic-ai/claude-code'), 'bin', 'claude.exe'),
    prefix: [],
  };
}

function subscriptionRoot(): string {
  return resolve(process.env.AXIOM_SUBSCRIPTION_HOME || join(homedir(), '.axiom-subscriptions'));
}

function profileRoot(userId: string, provider: SubscriptionProvider): string {
  if (!userId) throw new ProviderError('Authenticated user is required', 401, provider);
  const userHash = createHash('sha256').update(userId).digest('hex');
  const root = join(subscriptionRoot(), userHash, provider);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    chmodSync(root, 0o700);
  } catch {
    // Windows ACLs are inherited from the service account; chmod is best effort.
  }
  return root;
}

function childEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of CHILD_ENVIRONMENT_KEYS) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function oauthOnlyEnvironment(provider: SubscriptionProvider, userId: string): NodeJS.ProcessEnv {
  const env = childEnvironment();
  const root = profileRoot(userId, provider);
  if (provider === 'openai') env.CODEX_HOME = root;
  if (provider === 'grok') {
    env.GROK_HOME = root;
    // New logins use a dedicated directory. Do not read/copy/migrate existing
    // token values; legacy text profiles continue to work until reconnected.
    const credentialFile = join(root, 'credentials', 'auth.json');
    if (existsSync(join(dirname(credentialFile), '.active'))) env.GROK_AUTH_PATH = credentialFile;
    env.GROK_MEMORY = '0';
    env.GROK_DISABLE_AUTOUPDATER = '1';
  }
  if (provider === 'anthropic') {
    env.CLAUDE_CONFIG_DIR = root;
    env.ANTHROPIC_CONFIG_DIR = root;
  }
  env.NO_COLOR = '1';
  env.CI = '1';
  return env;
}

function splitMessages(messages: SubscriptionMessage[]): { system: string; prompt: string } {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversation = messages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role.toUpperCase()}:\n${message.content}`)
    .join('\n\n');
  return {
    system,
    prompt: `${conversation}\n\nASSISTANT:\nRespond directly. Do not invoke tools.`,
  };
}

function optionalModelArgs(provider: SubscriptionProvider, model: string): string[] {
  const sentinel = `${provider}-default`;
  return model && model !== sentinel ? ['--model', model] : [];
}

function buildCommand(request: SubscriptionRequest): CommandSpec {
  const executable = executableFor(request.provider);
  const env = oauthOnlyEnvironment(request.provider, request.userId);
  const { system, prompt } = splitMessages(request.messages);

  if (request.provider === 'openai') {
    const emptyWorkspace = join(profileRoot(request.userId, request.provider), 'workspace');
    mkdirSync(emptyWorkspace, { recursive: true, mode: 0o700 });
    return {
      command: executable.command,
      args: [
        ...executable.prefix,
        'exec',
        '--json',
        '--ephemeral',
        '--ignore-user-config',
        '--ignore-rules',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '--cd',
        emptyWorkspace,
        ...optionalModelArgs(request.provider, request.model),
        '-',
      ],
      env,
      prompt: `${system ? `SYSTEM:\n${system}\n\n` : ''}${prompt}`,
      cwd: emptyWorkspace,
    };
  }

  if (request.provider === 'anthropic') {
    const emptyWorkspace = join(profileRoot(request.userId, request.provider), 'workspace');
    mkdirSync(emptyWorkspace, { recursive: true, mode: 0o700 });
    return {
      command: executable.command,
      args: [
        ...executable.prefix,
        '--print',
        '--output-format',
        'stream-json',
        '--include-partial-messages',
        '--no-session-persistence',
        '--safe-mode',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--tools',
        '',
        '--max-turns',
        '1',
        ...(system ? ['--system-prompt', system] : []),
        ...optionalModelArgs(request.provider, request.model),
      ],
      env,
      prompt,
      cwd: emptyWorkspace,
    };
  }

  const runtimeDir = join(profileRoot(request.userId, request.provider), 'runtime');
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const emptyWorkspace = join(profileRoot(request.userId, request.provider), 'workspace');
  mkdirSync(emptyWorkspace, { recursive: true, mode: 0o700 });
  const promptFile = join(runtimeDir, `${randomUUID()}.prompt`);
  writeFileSync(promptFile, `${system ? `SYSTEM:\n${system}\n\n` : ''}${prompt}`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    command: executable.command,
    args: [
      ...executable.prefix,
      '--prompt-file',
      promptFile,
      '--output-format',
      'streaming-messages-json',
      '--include-partial-messages',
      // An empty --tools list means inherit, not deny-all. Use a curated
      // empty registry with optional tool injection disabled instead.
      // Contract: xai-org/grok-build 37949780, AgentDefinition + AgentBuilder.
      '--agents',
      JSON.stringify({
        'axiom-text': {
          description: 'AXIOM text-only completion without tool execution',
          toolConfig: { tools: [] },
          injectDefaultTools: false,
          discoverSkills: false,
          inheritSkills: false,
          agentsMd: false,
          mcpInheritance: 'none',
        },
      }),
      '--agent',
      'axiom-text',
      '--tools',
      // A nonempty, recognized allowlist prevents older CLIs from inheriting
      // all tools when they ignore injectDefaultTools. Deny both MCP tools
      // below: the intersection is empty (deny wins over allow).
      'search_tool',
      '--disallowed-tools',
      'run_terminal_cmd,read_file,search_replace,write_file,grep,web_fetch,web_search,x_search,search_tool,use_tool,Agent',
      '--disable-web-search',
      '--no-subagents',
      '--no-plan',
      '--verbatim',
      '--max-turns',
      '1',
      ...optionalModelArgs(request.provider, request.model),
    ],
    env,
    prompt: '',
    promptFile,
    cwd: emptyWorkspace,
  };
}

function parseJsonLine(provider: SubscriptionProvider, line: string): ParsedLine {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return { chunks: [] };
  }

  if (provider === 'openai') {
    const item = value.item as Record<string, unknown> | undefined;
    const usage = value.usage as Record<string, unknown> | undefined;
    const error = value.error as Record<string, unknown> | undefined;
    if (value.type === 'item.completed' && item?.type === 'agent_message') {
      return { chunks: typeof item.text === 'string' ? [item.text] : [] };
    }
    if (value.type === 'turn.completed') {
      return {
        chunks: [],
        usage: {
          promptTokens: Number(usage?.input_tokens || 0),
          completionTokens: Number(usage?.output_tokens || 0),
        },
      };
    }
    if (value.type === 'turn.failed' || value.type === 'error') {
      return { chunks: [], fatal: String(error?.message || value.message || 'Codex failed') };
    }
    return { chunks: [] };
  }

  const event = (value.type === 'stream_event' ? value.event : value) as
    Record<string, unknown> | undefined;
  const delta = event?.delta as Record<string, unknown> | undefined;
  const message = event?.message as Record<string, unknown> | undefined;
  const messageUsage = message?.usage as Record<string, unknown> | undefined;
  const eventUsage = event?.usage as Record<string, unknown> | undefined;
  const valueError = value.error as Record<string, unknown> | undefined;
  if (event?.type === 'content_block_delta' && typeof delta?.text === 'string') {
    return { chunks: [delta.text] };
  }
  if (event?.type === 'message_start') {
    return {
      chunks: [],
      usage: { promptTokens: Number(messageUsage?.input_tokens || 0) },
    };
  }
  if (event?.type === 'message_delta') {
    return {
      chunks: [],
      usage: { completionTokens: Number(eventUsage?.output_tokens || 0) },
    };
  }
  if (value.type === 'result' && value.is_error) {
    return { chunks: [], fatal: String(value.result || 'Subscription transport failed') };
  }
  if (value.type === 'error') {
    return {
      chunks: [],
      fatal: String(valueError?.message || value.message || 'Transport failed'),
    };
  }
  return { chunks: [] };
}

function sanitizedDiagnostic(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .filter(
      (line) => !/(access[_ -]?token|refresh[_ -]?token|api[_ -]?key|secret|cookie)/i.test(line),
    )
    .slice(-8);
  return lines.join('\n').slice(0, 2000);
}

function authCommand(
  provider: SubscriptionProvider,
  userId: string,
  operation: 'status' | 'connect' | 'disconnect',
): CommandSpec {
  const executable = executableFor(provider);
  const env = oauthOnlyEnvironment(provider, userId);
  env.CI = '0';
  if (provider === 'grok' && operation === 'connect') {
    const credentials = join(profileRoot(userId, provider), 'credentials');
    mkdirSync(credentials, { recursive: true, mode: 0o700 });
    env.GROK_AUTH_PATH = join(credentials, 'auth.json');
  }
  const commandArgs: Record<SubscriptionProvider, Record<typeof operation, string[]>> = {
    openai: {
      status: ['login', 'status'],
      connect: ['login', '--device-auth'],
      disconnect: ['logout'],
    },
    anthropic: {
      status: ['auth', 'status', '--json'],
      connect: ['auth', 'login', '--claudeai'],
      disconnect: ['auth', 'logout'],
    },
    grok: {
      status: ['inspect', '--json'],
      connect: ['login', '--oauth', '--device-auth'],
      disconnect: ['logout'],
    },
  };
  return {
    command: executable.command,
    args: [...executable.prefix, ...commandArgs[provider][operation]],
    env,
    prompt: '',
  };
}

async function runAuthCommand(
  provider: SubscriptionProvider,
  userId: string,
  operation: 'status' | 'disconnect',
  signal?: AbortSignal,
): Promise<{ exitCode: number | null; output: string }> {
  if (signal?.aborted) throw new DOMException('Subscription command aborted', 'AbortError');
  const spec = authCommand(provider, userId, operation);
  const child = spawn(spec.command, spec.args, {
    env: spec.env,
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const output: string[] = [];
  let outputBytes = 0;
  let outputLimitExceeded = false;
  const appendOutput = (chunk: string) => {
    if (outputLimitExceeded) return;
    outputBytes += Buffer.byteLength(chunk, 'utf8');
    if (outputBytes > SUBSCRIPTION_AUTH_OUTPUT_MAX_BYTES) {
      outputLimitExceeded = true;
      child.kill();
      return;
    }
    output.push(chunk);
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', appendOutput);
  child.stderr.on('data', appendOutput);
  const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  const timeoutMs = Number(process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let timedOut = false;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      child.kill();
      reject(new ProviderError('Subscription command timed out', 504, provider));
    }, timeoutMs);
    timer.unref();
  });
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        abort = () => {
          child.kill();
          reject(new DOMException('Subscription command aborted', 'AbortError'));
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      })
    : undefined;
  try {
    const exitCode = await Promise.race(
      abortPromise ? [exitPromise, timeoutPromise, abortPromise] : [exitPromise, timeoutPromise],
    );
    if (timedOut) throw new ProviderError('Subscription command timed out', 504, provider);
    if (signal?.aborted) throw new DOMException('Subscription command aborted', 'AbortError');
    if (outputLimitExceeded) {
      throw new ProviderError('Subscription command output exceeded its limit', 502, provider);
    }
    return { exitCode, output: sanitizedDiagnostic(output.join('')) };
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener('abort', abort);
  }
}

async function* runAuthConnect(
  provider: SubscriptionProvider,
  userId: string,
  signal?: AbortSignal,
): AsyncIterable<string> {
  const spec = authCommand(provider, userId, 'connect');
  const child = spawn(spec.command, spec.args, {
    env: spec.env,
    cwd: PACKAGE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', resolveExit);
  });
  const abort = () => child.kill();
  signal?.addEventListener('abort', abort, { once: true });
  const timeoutMs = Number(process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => child.kill(), timeoutMs);
  timer.unref();

  const combined = new PassThrough();
  let openStreams = 2;
  const closeCombined = () => {
    openStreams -= 1;
    if (openStreams === 0) combined.end();
  };
  child.stdout.pipe(combined, { end: false });
  child.stderr.pipe(combined, { end: false });
  child.stdout.once('end', closeCombined);
  child.stderr.once('end', closeCombined);
  const lines = createInterface({ input: combined, crlfDelay: Infinity });
  let output = '';
  let outputLimitError: ProviderError | undefined;
  for await (const line of lines) {
    if (Buffer.byteLength(line, 'utf8') > SUBSCRIPTION_AUTH_LINE_MAX_BYTES) {
      outputLimitError = new ProviderError(
        'Subscription login output line exceeded its limit',
        502,
        provider,
      );
      child.kill();
      break;
    }
    const safeLine = sanitizedDiagnostic(line);
    if (safeLine) {
      output = `${output}\n${safeLine}`.slice(-2000);
      yield safeLine;
    }
  }
  const exitCode = await exitPromise;
  clearTimeout(timer);
  signal?.removeEventListener('abort', abort);
  if (signal?.aborted) throw new DOMException('Subscription login aborted', 'AbortError');
  if (outputLimitError) throw outputLimitError;
  if (exitCode !== 0) {
    throw new ProviderError(
      output || 'Subscription login failed',
      statusForFailure(output),
      provider,
    );
  }
  if (provider === 'grok') {
    // Activate only after a completed login. A cancelled reconnect must not
    // hide a working legacy session merely because its directory was created.
    writeFileSync(join(profileRoot(userId, provider), 'credentials', '.active'), '', { mode: 0o600 });
  }
}

function statusForFailure(message: string): number {
  if (/(login|sign in|authenticate|unauthorized|oauth|credential)/i.test(message)) return 401;
  if (/(usage limit|weekly limit|quota|payment|required|credits|rate limit)/i.test(message))
    return 402;
  if (/(not found|enoent|could not find)/i.test(message)) return 503;
  return 502;
}

async function* runSubscription(request: SubscriptionRequest, control?: {
  spec: CommandSpec;
  onLine: (line: string) => void;
  onStopped?: () => void;
  imageBytes?: Buffer;
}): AsyncIterable<{
  text?: string;
  usage?: Partial<SubscriptionUsage>;
}> {
  if (request.signal?.aborted) throw new DOMException('Subscription request aborted', 'AbortError');
  const spec = control?.spec ?? buildCommand(request);
  let child: ChildProcessWithoutNullStreams | undefined;
  let stderr = '';
  let fatal = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let exitPromise: Promise<number | null> | undefined;
  let terminalError: Error | undefined;
  let stopping = false;
  let treeTermination = Promise.resolve(true);
  let resolveStopped!: () => void;
  const stopped = new Promise<void>(resolve => { resolveStopped = resolve; });
  const stop = (error?: Error) => {
    terminalError ??= error;
    resolveStopped();
    if (!child || stopping || (closed && process.platform !== 'linux')) return;
    stopping = true;
    // Stop the owned process tree, including CLI launch wrappers. Killing only
    // codex.js bypasses its signal forwarding and leaves its native child alive.
    if (child.pid && process.platform === 'win32') {
      const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], {
          windowsHide: true, stdio: 'ignore', env: { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' },
        });
      treeTermination = new Promise(resolveTree => {
        const killDeadline = setTimeout(() => { killer.kill('SIGKILL'); resolveTree(false); }, 2000);
        killer.once('error', () => { clearTimeout(killDeadline); resolveTree(false); });
        killer.once('close', code => { clearTimeout(killDeadline); resolveTree(code === 0); });
      });
    } else if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGKILL');
        if (process.platform === 'linux') treeTermination = waitForLinuxProcessGroup(child.pid);
      }
      catch (error) {
        treeTermination = Promise.resolve((error as NodeJS.ErrnoException).code === 'ESRCH');
      }
    } else {
      child.kill('SIGKILL');
    }
    child.stdin.destroy();
    child.stdout.destroy();
    child.stderr.destroy();
  };
  const abort = () => stop(new DOMException('Subscription request aborted', 'AbortError'));
  const configuredTimeout = Number(process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? Math.min(configuredTimeout, 2_147_483_647) : DEFAULT_TIMEOUT_MS;
  let terminationPromise: Promise<void> | undefined;
  const stopAndWait = () => terminationPromise ??= (async () => {
    if (!child) return;
    stop();
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const confirmed = await Promise.race([
      Promise.all([exitPromise!, treeTermination]).then(([, treeStopped]) => treeStopped),
      new Promise<false>(resolveClose => { closeTimer = setTimeout(() => resolveClose(false), 2000); }),
    ]);
    if (closeTimer) clearTimeout(closeTimer);
    if (!confirmed) {
      // Cleanup is not safe without confirmed closure, even if the original
      // request failed for a different reason. Retain its prompt and fail closed.
      throw new ProviderError('Subscription process termination could not be confirmed', 503, request.provider);
    }
  })();

  try {
    child = spawn(spec.command, spec.args, {
      env: spec.env,
      cwd: spec.cwd ?? PACKAGE_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // A new POSIX session gives cancellation an owned process group. On
      // Windows taskkill /T targets the live wrapper and its descendants.
      detached: process.platform !== 'win32',
    });
    exitPromise = new Promise<number | null>((resolveExit) => {
      // Observe errors immediately, even while stdout is still being consumed.
      child!.once('error', (error) => stop(error));
      child!.once('close', (code) => { closed = true; resolveExit(code); });
    });
    child.stdin.on('error', () => stop(new ProviderError('Subscription input transfer failed', 502, request.provider)));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });

    request.signal?.addEventListener('abort', abort, { once: true });
    if (request.signal?.aborted) abort();
    timer = setTimeout(() => stop(new ProviderError('Subscription request timed out', 504, request.provider)), timeoutMs);
    timer.unref();

    if (!terminalError) {
      if (control?.imageBytes) child.stdin.end(control.imageBytes);
      else if (spec.prompt) child.stdin.end(spec.prompt, 'utf8');
      else child.stdin.end();
    }

    let buffer = '';
    let stdoutBytes = 0;
    child.stdout.setEncoding('utf8');
    for await (const chunk of child.stdout) {
      const text = String(chunk);
      stdoutBytes += Buffer.byteLength(text, 'utf8');
      if (stdoutBytes > SUBSCRIPTION_STDOUT_MAX_BYTES) {
        throw new ProviderError(
          'Subscription transport output exceeded its limit',
          502,
          request.provider,
        );
      }
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      if (Buffer.byteLength(buffer, 'utf8') > SUBSCRIPTION_JSON_LINE_MAX_BYTES) {
        throw new ProviderError('Subscription transport JSON line exceeded its limit', 502, request.provider);
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        if (Buffer.byteLength(line, 'utf8') > SUBSCRIPTION_JSON_LINE_MAX_BYTES) {
          throw new ProviderError(
            'Subscription transport JSON line exceeded its limit',
            502,
            request.provider,
          );
        }
        const parsed = parseJsonLine(request.provider, line);
        control?.onLine(line);
        if (parsed.fatal) {
          fatal = parsed.fatal;
          const diagnostic = sanitizedDiagnostic(fatal);
          throw new ProviderError(diagnostic || 'Subscription transport failed', statusForFailure(diagnostic), request.provider);
        }
        if (parsed.usage) yield { usage: parsed.usage };
        for (const text of parsed.chunks) yield { text };
      }
    }
    if (buffer.trim()) {
      if (Buffer.byteLength(buffer, 'utf8') > SUBSCRIPTION_JSON_LINE_MAX_BYTES) {
        throw new ProviderError(
          'Subscription transport JSON line exceeded its limit',
          502,
          request.provider,
        );
      }
      const parsed = parseJsonLine(request.provider, buffer);
      control?.onLine(buffer);
      if (parsed.fatal) {
        fatal = parsed.fatal;
        const diagnostic = sanitizedDiagnostic(fatal);
        throw new ProviderError(diagnostic || 'Subscription transport failed', statusForFailure(diagnostic), request.provider);
      }
      if (parsed.usage) yield { usage: parsed.usage };
      for (const text of parsed.chunks) yield { text };
    }

    if (terminalError) throw terminalError;
    const exitCode = await Promise.race([
      exitPromise,
      stopped.then(async () => { await stopAndWait(); return null; }),
    ]);
    if (terminalError) throw terminalError;
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);

    if (request.signal?.aborted)
      throw new DOMException('Subscription request aborted', 'AbortError');
    if (exitCode !== 0 || fatal) {
      const diagnostic = sanitizedDiagnostic(fatal || stderr || `transport exited ${exitCode}`);
      throw new ProviderError(
        diagnostic || 'Subscription transport failed',
        statusForFailure(diagnostic),
        request.provider,
      );
    }
  } catch (error) {
    if (request.signal?.aborted)
      throw new DOMException('Subscription request aborted', 'AbortError');
    if (terminalError instanceof ProviderError) throw terminalError;
    const failure = terminalError ?? error;
    if (failure instanceof ProviderError) throw failure;
    const message = sanitizedDiagnostic(failure instanceof Error ? failure.message : String(failure));
    throw new ProviderError(
      message || 'Subscription transport failed',
      statusForFailure(message),
      request.provider,
    );
  } finally {
    if (timer) clearTimeout(timer);
    request.signal?.removeEventListener('abort', abort);
    await stopAndWait();
    control?.onStopped?.();
    if (spec.promptFile && existsSync(spec.promptFile)) rmSync(spec.promptFile, { force: true });
  }
}

export class OfficialSubscriptionTransport implements SubscriptionTransport {
  readonly providers = new Set<SubscriptionProvider>(['openai', 'anthropic', 'grok']);

  /** Real official-CLI media transport; not advertised by API/UI until the
   * asset/ToS/worker lifecycle is wired. Never retries a generation implicitly. */
  async generateMedia(request: GrokMediaRequest, beforeDispatch?: () => Promise<void>): Promise<GrokMediaArtifact> {
    if (request.signal?.aborted) throw new DOMException('Subscription request aborted', 'AbortError');
    if (!request.prompt?.trim() || request.prompt.length > 4000
      || !['image', 'video'].includes(request.kind)
      || !['auto', '1:1', '16:9', '9:16', '4:5', '3:2', '2:3'].includes(request.aspectRatio ?? 'auto')) {
      throw new ProviderError('Invalid Grok media request', 400, 'grok');
    }
    let inputExtension: 'jpg' | 'png' | undefined;
    if (request.kind === 'video') {
      if (!Buffer.isBuffer(request.image) || request.image.length < 12
        || request.image.length > 20 * 1024 * 1024 || ![6, 10].includes(request.duration ?? 6)) {
        throw new ProviderError('Video requires a bounded source image and a supported duration', 400, 'grok');
      }
      if (request.image.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) inputExtension = 'jpg';
      else if (request.image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) inputExtension = 'png';
      else throw new ProviderError('Unsupported source image format', 400, 'grok');
    } else if (request.image || request.duration !== undefined) {
      throw new ProviderError('Image generation does not accept video inputs', 400, 'grok');
    }
    // Only the dedicated sealed-input build supports video. Never substitute
    // the stock CLI, whose model-selected file references are not constrained.
    const videoExecutable = process.env.AXIOM_GROK_VIDEO_CLI;
    const imageLauncher = process.env.AXIOM_GROK_IMAGE_LAUNCHER;
    if (request.kind === 'video' && (!videoExecutable || !imageLauncher)) {
      throw new ProviderError('Install the sealed-input Grok video CLI and image launcher', 503, 'grok');
    }
    const imageBytes = inputExtension ? Buffer.from(request.image!) : undefined;
    const profile = profileRoot(request.userId, 'grok');
    const credentials = join(profile, 'credentials');
    if (!existsSync(join(credentials, '.active')) || !existsSync(join(credentials, 'auth.json'))) {
      throw new ProviderError('Reconnect Grok OAuth before using isolated media generation', 401, 'grok');
    }
    // No request may inherit the persistent profile's sessions/config/files.
    const requests = join(profile, 'media-requests');
    mkdirSync(requests, { recursive: true, mode: 0o700 });
    const requestRoot = mkdtempSync(join(requests, 'request-'));
    const sessionId = randomUUID();
    const base: SubscriptionRequest = {
      provider: 'grok', userId: request.userId, model: 'grok-default',
      messages: [], signal: request.signal,
    };
    const spec = buildCommand(base);
    const tool = request.kind === 'image' ? 'image_gen' : 'image_to_video';
    let safeToCleanup = true;
    try {
      // Replace the legacy prompt location before entering the isolated mount.
      rmSync(spec.promptFile!, { force: true });
      spec.promptFile = join(requestRoot, 'intent.prompt');
      spec.args[spec.args.indexOf('--prompt-file') + 1] = spec.promptFile;
      const input = request.kind === 'image'
        ? { prompt: request.prompt, aspect_ratio: request.aspectRatio ?? 'auto' }
        : { prompt: request.prompt, image: 'axiom-input://image', duration: request.duration ?? 6, resolution_name: '480p' };
      writeFileSync(spec.promptFile!, `Call ${tool} exactly once with the following JSON arguments. Do not use another tool, retry, or describe a result without a successful tool response.\n${JSON.stringify(input)}`, { mode: 0o600 });
      // Use the stock media registry, but allow only this one media tool.
      // Both MCP meta-tools remain explicitly denied by buildCommand.
      for (const flag of ['--agents', '--agent']) {
        const index = spec.args.indexOf(flag);
        spec.args.splice(index, 2);
      }
      spec.args[spec.args.indexOf('--tools') + 1] = tool;
      spec.args[spec.args.indexOf('--max-turns') + 1] = '2';
      spec.args.push('--session-id', sessionId, '--always-approve');
      Object.assign(spec, grokSandboxCommand({
        executable: imageBytes ? videoExecutable! : spec.command,
        requestRoot, credentialRoot: credentials, args: spec.args,
        ...(imageBytes ? { imageLauncher: { executable: imageLauncher!, byteLength: imageBytes.length } } : {}),
      }));
      const result = new GrokMediaResult(request.kind);
      // Preparation failures (missing login, unsupported runtime, invalid input)
      // must not be mistaken for an uncertain paid request. The worker commits
      // its one-shot marker here, before any subprocess can contact the provider.
      if (request.signal?.aborted) throw new DOMException('Subscription request aborted', 'AbortError');
      if (beforeDispatch) await beforeDispatch();
      safeToCleanup = false;
      for await (const _event of runSubscription(base, {
        spec, imageBytes, onLine: line => result.accept(line), onStopped: () => { safeToCleanup = true; },
      })) {
        // Text alone never establishes media success.
        void _event;
      }
      return await result.artifact(requestRoot, sessionId);
    } finally {
      if (safeToCleanup) {
        if (spec.promptFile) rmSync(spec.promptFile, { force: true });
      }
    }
  }

  async chat(request: SubscriptionRequest): Promise<SubscriptionResult> {
    let content = '';
    const usage: SubscriptionUsage = { promptTokens: 0, completionTokens: 0 };
    for await (const event of runSubscription(request)) {
      if (event.text) content += event.text;
      if (event.usage?.promptTokens !== undefined) usage.promptTokens = event.usage.promptTokens;
      if (event.usage?.completionTokens !== undefined) {
        usage.completionTokens = event.usage.completionTokens;
      }
    }
    if (!content)
      throw new ProviderError('Subscription transport returned no content', 502, request.provider);
    return { content, model: request.model, usage };
  }

  async *stream(request: SubscriptionRequest): AsyncIterable<string> {
    let emitted = false;
    for await (const event of runSubscription(request)) {
      if (event.text) {
        emitted = true;
        yield event.text;
      }
    }
    if (!emitted)
      throw new ProviderError('Subscription transport returned no content', 502, request.provider);
  }

  async status(
    provider: SubscriptionProvider,
    userId: string,
    signal?: AbortSignal,
  ): Promise<SubscriptionConnectionStatus> {
    if (provider === 'grok') {
      const profile = profileRoot(userId, provider);
      const credentials = join(profile, 'credentials');
      return { provider, connected: existsSync(join(
        existsSync(join(credentials, '.active')) ? credentials : profile, 'auth.json',
      )) };
    }
    const result = await runAuthCommand(provider, userId, 'status', signal);
    const disconnected =
      /(not logged|not authenticated|logged.?in.?false|authenticated.?false)/i.test(result.output);
    return { provider, connected: result.exitCode === 0 && !disconnected };
  }

  connect(
    provider: SubscriptionProvider,
    userId: string,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    return runAuthConnect(provider, userId, signal);
  }

  async disconnect(
    provider: SubscriptionProvider,
    userId: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await runAuthCommand(provider, userId, 'disconnect', signal);
    if (result.exitCode !== 0) {
      throw new ProviderError(
        result.output || 'Subscription logout failed',
        statusForFailure(result.output),
        provider,
      );
    }
    if (provider === 'grok') {
      const profile = profileRoot(userId, provider);
      const credentials = join(profile, 'credentials');
      // Grok can leave an empty auth store after logout. Remove only the
      // selected local store; never reactivate the preserved legacy file.
      rmSync(join(existsSync(join(credentials, '.active')) ? credentials : profile, 'auth.json'), { force: true });
    }
  }
}
