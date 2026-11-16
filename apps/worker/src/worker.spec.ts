import { loadEnv } from './env';
import { createLogger } from './logger';
import type { Task, TaskQueue } from './types';
import { Worker } from './worker';

const silent = createLogger('error');
const env = (extra: Record<string, string> = {}) =>
  loadEnv({ LOG_LEVEL: 'error', WORKER_POLL_INTERVAL_MS: '500', ...extra });

function task(id: string, type = 'T', attempts = 1, maxAttempts = 3): Task {
  return { id, type, payload: {}, organizationId: null, attempts, maxAttempts };
}

class FakeQueue implements TaskQueue {
  completed: string[] = [];
  failed: { id: string; error: unknown }[] = [];
  claimLimits: number[] = [];
  constructor(private pending: Task[]) {}
  push(t: Task) {
    this.pending.push(t);
  }
  async enqueueDue() {
    return 0;
  }
  async claim(limit: number) {
    this.claimLimits.push(limit);
    return this.pending.splice(0, limit);
  }
  async complete(t: Task) {
    this.completed.push(t.id);
  }
  async fail(t: Task, error: unknown) {
    this.failed.push({ id: t.id, error });
    return t.attempts >= t.maxAttempts ? ('DEAD' as const) : ('RETRY' as const);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe('Worker', () => {
  it('executa tarefas e as marca como concluídas', async () => {
    const queue = new FakeQueue([task('a'), task('b')]);
    const seen: string[] = [];
    const w = new Worker(env(), silent, {
      queue,
      handlers: { T: async (t) => void seen.push(t.id) },
    });
    await w.cycle();
    await settle();
    expect(seen.sort()).toEqual(['a', 'b']);
    expect(queue.completed.sort()).toEqual(['a', 'b']);
    await w.stop();
  });

  it('registra falha do handler sem derrubar o worker', async () => {
    const queue = new FakeQueue([task('x'), task('ok')]);
    const w = new Worker(env(), silent, {
      queue,
      handlers: {
        T: async (t) => {
          if (t.id === 'x') throw new Error('boom');
        },
      },
    });
    await w.cycle();
    await settle();
    expect(queue.failed.map((f) => f.id)).toEqual(['x']);
    expect(queue.completed).toEqual(['ok']);
    await w.stop();
  });

  it('trata tipo de tarefa desconhecido como falha', async () => {
    const queue = new FakeQueue([task('u', 'DESCONHECIDO')]);
    const w = new Worker(env(), silent, { queue, handlers: {} });
    await w.cycle();
    await settle();
    expect(String(queue.failed[0]?.error)).toMatch(/desconhecido/);
    await w.stop();
  });

  it('respeita a concorrência: pede só a capacidade livre', async () => {
    const queue = new FakeQueue([task('1'), task('2'), task('3'), task('4')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const w = new Worker(env({ WORKER_CONCURRENCY: '2' }), silent, {
      queue,
      handlers: { T: () => gate },
    });
    await w.cycle(); // pega 2
    await w.cycle(); // capacidade 0
    expect(queue.claimLimits).toEqual([2, 0]);
    expect(w.running).toBe(2);
    release();
    await w.stop();
  });

  it('sobrevive a falha da fila (ex.: banco fora do ar)', async () => {
    const queue = new FakeQueue([]);
    queue.claim = async () => {
      throw new Error('banco indisponível');
    };
    const w = new Worker(env(), silent, { queue, handlers: {} });
    await expect(w.cycle()).resolves.toBeUndefined();
    await w.stop();
  });

  it('no encerramento espera as tarefas em andamento', async () => {
    const queue = new FakeQueue([task('lenta')]);
    let finished = false;
    const w = new Worker(env(), silent, {
      queue,
      handlers: {
        T: async () => {
          await new Promise((r) => setTimeout(r, 100));
          finished = true;
        },
      },
    });
    w.start();
    await settle();
    await w.stop();
    expect(finished).toBe(true);
    expect(queue.completed).toEqual(['lenta']);
  });

  it('rejeita configuração inválida', () => {
    expect(() => loadEnv({ WORKER_CONCURRENCY: '0' })).toThrow(/WORKER_CONCURRENCY/);
  });
});

describe('Worker.runOnce', () => {
  const quiet = () => env({ WORKER_CONCURRENCY: '2' });

  it('processa tudo, inclusive tarefas criadas durante a execução, e retorna', async () => {
    const queue = new FakeQueue([task('a'), task('b'), task('c')]);
    const seen: string[] = [];
    const w = new Worker(quiet(), silent, {
      queue,
      handlers: {
        T: async (t) => {
          seen.push(t.id);
          if (t.id === 'a') queue.push(task('derivada')); // ex.: notificação criada por um incidente
        },
      },
    });
    const r = await w.runOnce(5000);
    expect(seen.sort()).toEqual(['a', 'b', 'c', 'derivada']);
    expect(r).toEqual({ processed: 4, timedOut: false });
    expect(queue.completed.sort()).toEqual(['a', 'b', 'c', 'derivada']);
    expect(w.running).toBe(0);
  });

  it('retorna imediatamente com a fila vazia', async () => {
    const w = new Worker(quiet(), silent, { queue: new FakeQueue([]), handlers: {} });
    expect(await w.runOnce(5000)).toEqual({ processed: 0, timedOut: false });
  });

  it('respeita o limite de tempo e aguarda o que já está em andamento', async () => {
    const queue = new FakeQueue(Array.from({ length: 50 }, (_, i) => task(`t${i}`)));
    const w = new Worker(quiet(), silent, {
      queue,
      handlers: { T: () => new Promise((r) => setTimeout(r, 30)) },
    });
    const r = await w.runOnce(100);
    expect(r.timedOut).toBe(true);
    expect(r.processed).toBeLessThan(50);
    expect(w.running).toBe(0);
    expect(queue.completed.length).toBe(r.processed);
  });

  it('falha de tarefa não impede o restante', async () => {
    const queue = new FakeQueue([task('ruim'), task('boa')]);
    const w = new Worker(quiet(), silent, {
      queue,
      handlers: {
        T: async (t) => {
          if (t.id === 'ruim') throw new Error('x');
        },
      },
    });
    await w.runOnce(5000);
    expect(queue.failed.map((f) => f.id)).toEqual(['ruim']);
    expect(queue.completed).toEqual(['boa']);
  });
});
