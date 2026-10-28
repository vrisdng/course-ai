export class ChatTiming {
  private readonly startedAt: number;
  private readonly values: Record<string, number[]> = {};

  constructor(private readonly clock: () => number = () => performance.now()) {
    this.startedAt = clock();
  }

  mark(name: string): void {
    this.add(name, this.clock() - this.startedAt);
  }

  async measure<T>(name: string, work: () => Promise<T>): Promise<T> {
    const start = this.clock();
    try { return await work(); } finally { this.add(name, this.clock() - start); }
  }

  record(name: string, duration: number): void { this.add(name, duration); }

  snapshot(): Record<string, number[]> { return this.values; }

  private add(name: string, value: number): void {
    (this.values[name] ??= []).push(Math.max(0, Math.round(value)));
  }
}
