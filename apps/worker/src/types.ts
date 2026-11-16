export interface Task {
  id: string;
  type: string;
  payload: unknown;
  organizationId: string | null;
  attempts: number;
  maxAttempts: number;
}

/** Contrato da fila de tarefas (implementado sobre PostgreSQL). */
export interface TaskQueue {
  /** Gera tarefas para o que está vencido (monitores, manutenção). Retorna quantas criou. */
  enqueueDue(now?: Date): Promise<number>;
  /** Reserva até `limit` tarefas com lease. Nunca entrega a mesma tarefa a dois workers. */
  claim(limit: number): Promise<Task[]>;
  complete(task: Task): Promise<void>;
  /** Reagenda com backoff ou marca como DEAD ao esgotar as tentativas. */
  fail(task: Task, error: unknown): Promise<'RETRY' | 'DEAD'>;
}

export type TaskHandler = (task: Task) => Promise<void>;
