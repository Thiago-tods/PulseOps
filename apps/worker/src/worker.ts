import type { WorkerEnv } from './env';
import type { Logger } from './logger';
import type { Task, TaskHandler, TaskQueue } from './types';

export interface WorkerDeps {
  queue: TaskQueue;
  handlers: Record<string, TaskHandler>;
}

/**
 * Loop do worker: a cada ciclo agenda o que venceu, reserva tarefas (até a concorrência
 * configurada) e as executa sem bloquear o ciclo seguinte. Encerra esperando as em andamento.
 */
export class Worker {
  private timer: NodeJS.Timeout | undefined;
  private stopping = false;
  private started = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly env: WorkerEnv,
    private readonly log: Logger,
    private readonly deps: WorkerDeps,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.log.info('worker iniciado', {
      pollIntervalMs: this.env.WORKER_POLL_INTERVAL_MS,
      concurrency: this.env.WORKER_CONCURRENCY,
    });
    void this.cycle();
  }

  private schedule(): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => void this.cycle(), this.env.WORKER_POLL_INTERVAL_MS);
  }

  /** Um ciclo completo. Exposto para testes. */
  async cycle(): Promise<void> {
    if (this.stopping) return;
    try {
      const enqueued = await this.deps.queue.enqueueDue();
      if (enqueued > 0) this.log.debug('tarefas agendadas', { enqueued });
      const capacity = this.env.WORKER_CONCURRENCY - this.inFlight.size;
      for (const task of await this.deps.queue.claim(capacity)) this.dispatch(task);
    } catch (err) {
      // Falha de infraestrutura (ex.: banco indisponível): registra e tenta no próximo ciclo.
      this.log.error('falha no ciclo do worker', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.schedule();
    }
  }

  private dispatch(task: Task): void {
    const run = this.execute(task).finally(() => this.inFlight.delete(run));
    this.inFlight.add(run);
  }

  private async execute(task: Task): Promise<void> {
    const handler = this.deps.handlers[task.type];
    try {
      if (!handler) throw new Error(`Tipo de tarefa desconhecido: ${task.type}`);
      await handler(task);
      await this.deps.queue.complete(task);
    } catch (err) {
      const outcome = await this.deps.queue.fail(task, err).catch(() => 'RETRY' as const); // se até o registro falhar, o lease expira e a tarefa volta
      this.log[outcome === 'DEAD' ? 'error' : 'warn']('tarefa falhou', {
        taskId: task.id,
        type: task.type,
        attempt: task.attempts,
        outcome,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Modo de execução única: agenda o que venceu, processa até a fila esvaziar (inclusive tarefas
   * criadas durante a execução, como notificações) ou até o limite de tempo, e retorna.
   */
  async runOnce(maxDurationMs: number): Promise<{ processed: number; timedOut: boolean }> {
    const deadline = Date.now() + maxDurationMs;
    let processed = 0;
    let timedOut = false;
    await this.deps.queue.enqueueDue();
    for (;;) {
      if (Date.now() >= deadline) {
        timedOut = true;
        break;
      }
      const capacity = this.env.WORKER_CONCURRENCY - this.inFlight.size;
      const tasks = await this.deps.queue.claim(capacity);
      for (const task of tasks) {
        this.dispatch(task);
        processed += 1;
      }
      if (tasks.length === 0) {
        if (this.inFlight.size === 0) break; // fila vazia e nada em andamento
        await Promise.race([...this.inFlight]); // espera uma terminar e tenta de novo
      }
    }
    await this.stop();
    return { processed, timedOut };
  }

  get running(): number {
    return this.inFlight.size;
  }

  /** Para de pegar tarefas e espera as em andamento (até o limite configurado). */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    const pending = Promise.allSettled([...this.inFlight]);
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), this.env.SHUTDOWN_TIMEOUT_MS).unref();
    });
    const result = await Promise.race([pending, timeout]);
    if (result === 'timeout') {
      this.log.warn('encerramento forçado: tarefas ainda em andamento', {
        running: this.inFlight.size,
      });
    }
    this.started = false;
    this.log.info('worker encerrado');
  }
}
