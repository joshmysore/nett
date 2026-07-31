import { spawn } from "node:child_process";

export interface CredentialVault {
  get(key: string): Promise<Uint8Array | undefined>;
  set(key: string, secret: Uint8Array): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export interface StringCredentialVault {
  getString(key: string): Promise<string | undefined>;
  setString(key: string, secret: string): Promise<void>;
  delete(key: string): Promise<boolean>;
}

export class VaultError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "NOT_FOUND" | "INVALID_KEY" | "IO",
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "VaultError";
  }
}

function validateKey(key: string): void {
  if (!key || key.length > 512 || /[\0\r\n]/.test(key)) {
    throw new VaultError("Credential key is invalid", "INVALID_KEY");
  }
}

function quoteSecurityArgument(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}

interface ProcessResult {
  code: number;
  stdout: Buffer;
  stderr: Buffer;
}

function runSecurity(
  args: readonly string[],
  options: { stdin?: Buffer; timeoutMs: number; maxOutputBytes: number }
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, {
      env: { PATH: "/usr/bin:/bin" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const finish = (error?: Error, result?: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result!);
    };

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > options.maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new VaultError("Keychain command exceeded output limit", "IO"));
        return;
      }
      target.push(Buffer.from(chunk));
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", (error) => finish(new VaultError("macOS Keychain is unavailable", "UNAVAILABLE", { cause: error })));
    child.once("close", (code) => finish(undefined, {
      code: code ?? -1,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr)
    }));

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new VaultError("Keychain command timed out", "IO"));
    }, options.timeoutMs);
    timer.unref();

    if (options.stdin) child.stdin.end(options.stdin);
    else child.stdin.end();
  });
}

/**
 * Stores opaque values as base64 in the user's macOS login Keychain.
 * Secrets are supplied to `security -i` over stdin, never argv or env.
 */
export class MacOSKeychainCredentialVault implements CredentialVault, StringCredentialVault {
  constructor(
    private readonly service: string,
    private readonly accountPrefix = "nett",
    private readonly timeoutMs = 15_000
  ) {
    if (!service || /[\0\r\n]/.test(service)) {
      throw new VaultError("Keychain service is invalid", "INVALID_KEY");
    }
  }

  private account(key: string): string {
    validateKey(key);
    return `${this.accountPrefix}:${key}`;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    this.assertDarwin();
    const result = await runSecurity(
      ["find-generic-password", "-w", "-a", this.account(key), "-s", this.service],
      { timeoutMs: this.timeoutMs, maxOutputBytes: 4 * 1024 * 1024 }
    );
    if (result.code === 44) return undefined;
    if (result.code !== 0) throw new VaultError("Could not read credential from Keychain", "IO");

    const encoded = result.stdout.toString("utf8").trim();
    result.stdout.fill(0);
    try {
      return Buffer.from(encoded, "base64");
    } catch (error) {
      throw new VaultError("Stored credential is not valid", "IO", { cause: error });
    }
  }

  async set(key: string, secret: Uint8Array): Promise<void> {
    this.assertDarwin();
    const encoded = Buffer.from(secret).toString("base64");
    const command = [
      "add-generic-password",
      "-U",
      "-a", quoteSecurityArgument(this.account(key)),
      "-s", quoteSecurityArgument(this.service),
      "-w", quoteSecurityArgument(encoded)
    ].join(" ");
    const input = Buffer.from(`${command}\n`, "utf8");
    try {
      const result = await runSecurity(["-i"], {
        stdin: input,
        timeoutMs: this.timeoutMs,
        maxOutputBytes: 64 * 1024
      });
      result.stdout.fill(0);
      result.stderr.fill(0);
      if (result.code !== 0) throw new VaultError("Could not save credential to Keychain", "IO");
    } finally {
      input.fill(0);
    }
  }

  async delete(key: string): Promise<boolean> {
    this.assertDarwin();
    const result = await runSecurity(
      ["delete-generic-password", "-a", this.account(key), "-s", this.service],
      { timeoutMs: this.timeoutMs, maxOutputBytes: 64 * 1024 }
    );
    if (result.code === 44) return false;
    if (result.code !== 0) throw new VaultError("Could not delete credential from Keychain", "IO");
    return true;
  }

  async getString(key: string): Promise<string | undefined> {
    const value = await this.get(key);
    if (!value) return undefined;
    try {
      return new TextDecoder().decode(value);
    } finally {
      if (Buffer.isBuffer(value)) value.fill(0);
    }
  }

  async setString(key: string, secret: string): Promise<void> {
    const bytes = new TextEncoder().encode(secret);
    try {
      await this.set(key, bytes);
    } finally {
      bytes.fill(0);
    }
  }

  private assertDarwin(): void {
    if (process.platform !== "darwin") {
      throw new VaultError("macOS Keychain is only available on macOS", "UNAVAILABLE");
    }
  }
}

export class InMemoryCredentialVault implements CredentialVault, StringCredentialVault {
  private readonly values = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | undefined> {
    validateKey(key);
    const value = this.values.get(key);
    return value ? Uint8Array.from(value) : undefined;
  }

  async set(key: string, secret: Uint8Array): Promise<void> {
    validateKey(key);
    this.values.get(key)?.fill(0);
    this.values.set(key, Uint8Array.from(secret));
  }

  async delete(key: string): Promise<boolean> {
    validateKey(key);
    const existing = this.values.get(key);
    existing?.fill(0);
    return this.values.delete(key);
  }

  async getString(key: string): Promise<string | undefined> {
    const value = await this.get(key);
    if (!value) return undefined;
    try {
      return new TextDecoder().decode(value);
    } finally {
      value.fill(0);
    }
  }

  async setString(key: string, secret: string): Promise<void> {
    const bytes = new TextEncoder().encode(secret);
    try {
      await this.set(key, bytes);
    } finally {
      bytes.fill(0);
    }
  }

  clear(): void {
    for (const value of this.values.values()) value.fill(0);
    this.values.clear();
  }
}
