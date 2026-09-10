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
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ProviderError } from './types.js';

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
      command: join(homedir(), '.grok', 'bin', process.platform === 'win32' ? 'grok.exe' : 'grok'),
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
  if (provider === 'grok') env.GROK_HOME = root;
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
      '--tools',
      '',
      '--disallowed-tools',
      'Bash,Edit,Write,Read,Grep,WebFetch,WebSearch,Agent,MCPTool',
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
}

function statusForFailure(message: string): number {
  if (/(login|sign in|authenticate|unauthorized|oauth|credential)/i.test(message)) return 401;
  if (/(usage limit|weekly limit|quota|payment|required|credits|rate limit)/i.test(message))
    return 402;
  if (/(not found|enoent|could not find)/i.test(message)) return 503;
  return 502;
}

async function* runSubscription(request: SubscriptionRequest): AsyncIterable<{
  text?: string;
  usage?: Partial<SubscriptionUsage>;
}> {
  const spec = buildCommand(request);
  let child: ChildProcessWithoutNullStreams | undefined;
  let stderr = '';
  let fatal = '';
  const timeoutMs = Number(process.env.AXIOM_LLM_TRANSPORT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

  try {
    child = spawn(spec.command, spec.args, {
      env: spec.env,
      cwd: spec.cwd ?? PACKAGE_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const exitPromise = new Promise<number | null>((resolveExit, rejectExit) => {
      child!.once('error', rejectExit);
      child!.once('exit', (code) => resolveExit(code));
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8192);
    });

    const abort = () => child?.kill();
    request.signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => child?.kill(), timeoutMs);
    timer.unref();

    if (spec.prompt) child.stdin.end(spec.prompt, 'utf8');
    else child.stdin.end();

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
        if (parsed.fatal) fatal = parsed.fatal;
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
      if (parsed.fatal) fatal = parsed.fatal;
      if (parsed.usage) yield { usage: parsed.usage };
      for (const text of parsed.chunks) yield { text };
    }

    const exitCode = await exitPromise;
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
    if (error instanceof ProviderError) throw error;
    const message = sanitizedDiagnostic(error instanceof Error ? error.message : String(error));
    throw new ProviderError(
      message || 'Subscription transport failed',
      statusForFailure(message),
      request.provider,
    );
  } finally {
    child?.kill();
    if (spec.promptFile && existsSync(spec.promptFile)) rmSync(spec.promptFile, { force: true });
  }
}

export class OfficialSubscriptionTransport implements SubscriptionTransport {
  readonly providers = new Set<SubscriptionProvider>(['openai', 'anthropic', 'grok']);

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
      return { provider, connected: existsSync(join(profileRoot(userId, provider), 'auth.json')) };
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
  }
}
