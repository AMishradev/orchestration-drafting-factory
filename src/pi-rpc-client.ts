import { z } from "zod";

const RpcResponseSchema = z.object({
  type: z.literal("response"),
  id: z.string().optional(),
  command: z.string(),
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});

const LastTextDataSchema = z.object({
  text: z.string().nullable(),
});

export type PiRpcEvent = {
  type: string;
  [key: string]: unknown;
};

type PendingResponse = {
  resolve: (response: z.infer<typeof RpcResponseSchema>) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EventWaiter = {
  matches: (event: PiRpcEvent) => boolean;
  resolve: (event: PiRpcEvent) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type EventWait = {
  promise: Promise<PiRpcEvent>;
  cancel: () => void;
};

export class PiRpcClient {
  private readonly process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly pending = new Map<string, PendingResponse>();
  private readonly eventWaiters = new Set<EventWaiter>();
  private readonly listeners = new Set<(event: PiRpcEvent) => void>();
  private stderr = "";
  private closed = false;
  private prompting = false;
  private readonly stdoutDone: Promise<void>;
  private readonly stderrDone: Promise<void>;

  constructor(
    command: string[],
    private readonly timeoutMs = 120_000,
  ) {
    this.process = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    this.stdoutDone = this.readStdout();
    this.stderrDone = this.readStderr();
    void this.monitorExit();
  }

  onEvent(listener: (event: PiRpcEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async prompt(message: string): Promise<string> {
    if (this.prompting) {
      throw new Error("Pi RPC session already has an active prompt");
    }

    this.prompting = true;
    try {
      const settled = this.waitForEvent((event) => event.type === "agent_settled");
      try {
        const promptResponse = this.sendCommand({ type: "prompt", message });
        await Promise.all([promptResponse, settled.promise]);
      } finally {
        settled.cancel();
      }

      const response = await this.sendCommand({ type: "get_last_assistant_text" });
      const data = LastTextDataSchema.parse(response.data);
      if (!data.text) throw new Error("Pi returned no assistant text");
      return data.text;
    } finally {
      this.prompting = false;
    }
  }

  async abort(): Promise<void> {
    if (!this.prompting || this.closed) return;
    await this.sendCommand({ type: "abort" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.process.stdin.end();
    if (this.process.exitCode === null) this.process.kill("SIGTERM");
    await this.process.exited;
    await Promise.allSettled([this.stdoutDone, this.stderrDone]);
  }

  private sendCommand(command: Record<string, unknown>) {
    if (this.closed || this.process.exitCode !== null) {
      throw new Error("Pi RPC process is not running");
    }

    const id = crypto.randomUUID();
    const response = new Promise<z.infer<typeof RpcResponseSchema>>(
      (resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error(`Timed out waiting for Pi RPC command ${String(command.type)}`));
        }, this.timeoutMs);
        this.pending.set(id, { resolve, reject, timeout });
      },
    );

    this.process.stdin.write(`${JSON.stringify({ ...command, id })}\n`);
    void this.process.stdin.flush();

    return response.then((result) => {
      if (!result.success) {
        throw new Error(result.error ?? `Pi RPC command ${result.command} failed`);
      }
      return result;
    });
  }

  private waitForEvent(matches: EventWaiter["matches"]): EventWait {
    let waiter: EventWaiter;
    const promise = new Promise<PiRpcEvent>((resolve, reject) => {
      waiter = {
        matches,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.eventWaiters.delete(waiter);
          reject(new Error("Timed out waiting for Pi RPC agent to settle"));
        }, this.timeoutMs),
      };
      this.eventWaiters.add(waiter);
    });
    return {
      promise,
      cancel: () => {
        if (!this.eventWaiters.delete(waiter)) return;
        clearTimeout(waiter.timeout);
      },
    };
  }

  private async readStdout() {
    const reader = this.process.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line) this.handleLine(line);
        newline = buffer.indexOf("\n");
      }
    }
  }

  private async readStderr() {
    this.stderr = await new Response(this.process.stderr).text();
  }

  private handleLine(line: string) {
    let event: PiRpcEvent;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
      event = parsed as PiRpcEvent;
    } catch {
      return;
    }

    for (const listener of this.listeners) listener(event);

    if (event.type === "extension_ui_request") {
      const title =
        typeof event.title === "string"
          ? event.title.replace(/\s+/g, " ").trim()
          : "Pi requested interactive configuration";
      this.rejectOutstanding(
        new Error(
          `Pi RPC requires interactive setup: ${title}. Initialize Pi on this VM before starting the runner.`,
        ),
      );
      return;
    }

    if (event.type === "response") {
      const response = RpcResponseSchema.safeParse(event);
      if (response.success && response.data.id) {
        const pending = this.pending.get(response.data.id);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pending.delete(response.data.id);
          pending.resolve(response.data);
        }
      }
    }

    for (const waiter of this.eventWaiters) {
      if (!waiter.matches(event)) continue;
      clearTimeout(waiter.timeout);
      this.eventWaiters.delete(waiter);
      waiter.resolve(event);
    }
  }

  private rejectOutstanding(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();

    for (const waiter of this.eventWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.eventWaiters.clear();
  }

  private async monitorExit(): Promise<void> {
    const code = await this.process.exited;
    await Promise.allSettled([this.stdoutDone, this.stderrDone]);
    if (this.closed) return;
    const detail = this.stderr.trim();
    const error = new Error(
      `Pi RPC process exited with code ${code}${detail ? `: ${detail}` : ""}`,
    );
    this.rejectOutstanding(error);
  }
}
