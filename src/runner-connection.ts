import type { RemoteRunnerRole } from "./runner-role";

export type RunnerConnectionState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "stopped";

type RunnerConnectionOptions = {
  role: RemoteRunnerRole;
  url: string;
  authToken?: string;
  onMessage: (role: RemoteRunnerRole, rawEvent: string) => void;
  onDisconnect: (role: RemoteRunnerRole, reason: string) => void;
};

export class RunnerConnection {
  private socket?: WebSocket;
  private connecting?: Promise<void>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private stopped = false;
  private wasConnected = false;
  private currentState: RunnerConnectionState = "disconnected";

  constructor(private readonly options: RunnerConnectionOptions) {}

  get role(): RemoteRunnerRole {
    return this.options.role;
  }

  get state(): RunnerConnectionState {
    return this.currentState;
  }

  ready(): Promise<void> {
    return this.connect();
  }

  async send(payload: unknown): Promise<void> {
    await this.connect();
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error(`${this.role} runner is not connected`);
    }
    this.socket.send(JSON.stringify(payload));
  }

  stop(): void {
    this.stopped = true;
    this.currentState = "stopped";
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = undefined;
  }

  private connect(): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error(`${this.role} runner connection stopped`));
    }
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.connecting) return this.connecting;

    this.currentState = "connecting";
    this.connecting = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.authenticatedUrl());
      this.socket = socket;
      let opened = false;
      let settled = false;

      socket.addEventListener("open", () => {
        opened = true;
        settled = true;
        this.wasConnected = true;
        this.reconnectAttempt = 0;
        this.currentState = "connected";
        this.connecting = undefined;
        resolve();
      });
      socket.addEventListener("message", (event) => {
        this.options.onMessage(this.role, String(event.data));
      });
      socket.addEventListener("error", () => {
        if (opened || settled) return;
        settled = true;
        this.connecting = undefined;
        this.currentState = "disconnected";
        reject(new Error(`Unable to connect to ${this.role} runner`));
      });
      socket.addEventListener("close", (event) => {
        const connectedBeforeClose = opened || this.wasConnected;
        this.socket = undefined;
        this.connecting = undefined;
        if (this.stopped) return;
        this.currentState = "disconnected";
        if (!settled) {
          settled = true;
          reject(new Error(`${this.role} runner closed before connecting`));
        }
        if (connectedBeforeClose) {
          this.options.onDisconnect(
            this.role,
            event.reason || `WebSocket closed with code ${event.code}`,
          );
        }
        this.scheduleReconnect();
      });
    });

    return this.connecting;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = Math.min(30_000, 500 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch(() => this.scheduleReconnect());
    }, delay);
  }

  private authenticatedUrl(): string {
    const url = new URL(this.options.url);
    if (this.options.authToken) {
      url.searchParams.set("token", this.options.authToken);
    }
    return url.toString();
  }
}
