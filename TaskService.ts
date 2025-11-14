import { Task, DomainEvent } from '../domain/Task';
import { CircuitBreaker } from '../infrastructure/CircuitBreaker';

export class TaskService {
  private tasks: Task[] = [];
  private eventStore: DomainEvent[] = [];
  private circuitBreaker = new CircuitBreaker();

  async createTask(title: string, priority: Task['priority']): Promise<Task> {
    return this.circuitBreaker.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title,
        status: 'pending',
        priority,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.tasks.push(task);
      this.publishEvent({
        type: 'TASK_CREATED',
        payload: task,
        timestamp: Date.now(),
        aggregateId: task.id
      });

      return task;
    });
  }

  async updateTaskStatus(taskId: string, status: Task['status']): Promise<Task> {
    return this.circuitBreaker.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const task = this.tasks.find(t => t.id === taskId);
      if (!task) throw new Error('Task not found');

      const updatedTask = {
        ...task,
        status,
        updatedAt: Date.now()
      };

      this.tasks = this.tasks.map(t => t.id === taskId ? updatedTask : t);
      
      this.publishEvent({
        type: status === 'completed' ? 'TASK_COMPLETED' : 'TASK_UPDATED',
        payload: updatedTask,
        timestamp: Date.now(),
        aggregateId: task.id
      });

      return updatedTask;
    });
  }

  getTasks(): Task[] {
    return [...this.tasks];
  }

  getEvents(): DomainEvent[] {
    return [...this.eventStore];
  }

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }

  private publishEvent(event: DomainEvent) {
    this.eventStore.push(event);
  }
}