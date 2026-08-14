export type FactoryEvent = {
  id: number;
  workflowId: string;
  type: string;
  data: unknown;
  createdAt: string;
};

type Listener = (event: FactoryEvent) => void;

export class EventHub {
  private nextId = 1;
  private readonly history = new Map<string, FactoryEvent[]>();
  private readonly listeners = new Map<string, Set<Listener>>();

  publish(workflowId: string, type: string, data: unknown): FactoryEvent {
    const event: FactoryEvent = {
      id: this.nextId++,
      workflowId,
      type,
      data,
      createdAt: new Date().toISOString(),
    };

    const events = this.history.get(workflowId) ?? [];
    events.push(event);
    this.history.set(workflowId, events.slice(-200));

    for (const listener of this.listeners.get(workflowId) ?? []) {
      listener(event);
    }

    return event;
  }

  eventsFor(workflowId: string): FactoryEvent[] {
    return [...(this.history.get(workflowId) ?? [])];
  }

  subscribe(workflowId: string, listener: Listener): () => void {
    const listeners = this.listeners.get(workflowId) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(workflowId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(workflowId);
    };
  }
}

export function formatSse(event: FactoryEvent): string {
  return [
    `id: ${event.id}`,
    `event: ${event.type}`,
    `data: ${JSON.stringify(event)}`,
    "",
    "",
  ].join("\n");
}
