import React, { useState, useEffect, useCallback, useReducer } from 'react';
import { AlertCircle, CheckCircle, Clock, TrendingUp, Database, Activity } from 'lucide-react';

// ============================================================================
// DOMAIN LAYER - Domain-Driven Design
// ============================================================================

interface Task {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'low' | 'medium' | 'high';
  createdAt: number;
  updatedAt: number;
}

interface DomainEvent {
  type: 'TASK_CREATED' | 'TASK_UPDATED' | 'TASK_COMPLETED' | 'TASK_FAILED';
  payload: Task;
  timestamp: number;
  aggregateId: string;
}

// ============================================================================
// INFRASTRUCTURE LAYER - Circuit Breaker Pattern
// ============================================================================

class CircuitBreaker {
  private failureCount = 0;
  private successCount = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private nextAttempt = Date.now();
  
  constructor(
    private threshold = 3,
    private timeout = 5000,
    private successThreshold = 2
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() < this.nextAttempt) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = 'HALF_OPEN';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = 'CLOSED';
        this.successCount = 0;
      }
    }
  }

  private onFailure() {
    this.failureCount++;
    this.successCount = 0;
    
    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }

  getState() {
    return this.state;
  }
}

// ============================================================================
// APPLICATION LAYER - CQRS Pattern
// ============================================================================

class TaskCommandService {
  private eventStore: DomainEvent[] = [];
  private circuitBreaker = new CircuitBreaker();

  async createTask(title: string, priority: Task['priority']): Promise<Task> {
    return this.circuitBreaker.execute(async () => {
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        title,
        status: 'pending',
        priority,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      this.publishEvent({
        type: 'TASK_CREATED',
        payload: task,
        timestamp: Date.now(),
        aggregateId: task.id
      });

      return task;
    });
  }

  async updateTaskStatus(task: Task, status: Task['status']): Promise<Task> {
    return this.circuitBreaker.execute(async () => {
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const updatedTask = {
        ...task,
        status,
        updatedAt: Date.now()
      };

      this.publishEvent({
        type: status === 'completed' ? 'TASK_COMPLETED' : 'TASK_UPDATED',
        payload: updatedTask,
        timestamp: Date.now(),
        aggregateId: task.id
      });

      return updatedTask;
    });
  }

  private publishEvent(event: DomainEvent) {
    this.eventStore.push(event);
  }

  getEvents(): DomainEvent[] {
    return [...this.eventStore];
  }

  getCircuitBreakerState() {
    return this.circuitBreaker.getState();
  }
}

class TaskQueryService {
  async getTaskMetrics(tasks: Task[]) {
    return {
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      inProgress: tasks.filter(t => t.status === 'in_progress').length,
      pending: tasks.filter(t => t.status === 'pending').length,
      failed: tasks.filter(t => t.status === 'failed').length,
      highPriority: tasks.filter(t => t.priority === 'high').length
    };
  }

  async getRecentEvents(events: DomainEvent[], limit = 5) {
    return events.slice(-limit).reverse();
  }
}

// ============================================================================
// PRESENTATION LAYER - React Components
// ============================================================================

type AppState = {
  tasks: Task[];
  isLoading: boolean;
  error: string | null;
};

type AppAction =
  | { type: 'ADD_TASK'; payload: Task }
  | { type: 'UPDATE_TASK'; payload: Task }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'ADD_TASK':
      return { ...state, tasks: [...state.tasks, action.payload], isLoading: false };
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map(t => t.id === action.payload.id ? action.payload : t),
        isLoading: false
      };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

export default function TaskManagementSystem() {
  const [state, dispatch] = useReducer(appReducer, {
    tasks: [],
    isLoading: false,
    error: null
  });

  const [commandService] = useState(() => new TaskCommandService());
  const [queryService] = useState(() => new TaskQueryService());
  const [metrics, setMetrics] = useState<any>(null);
  const [recentEvents, setRecentEvents] = useState<DomainEvent[]>([]);
  const [circuitState, setCircuitState] = useState<string>('CLOSED');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<Task['priority']>('medium');

  useEffect(() => {
    updateMetrics();
    updateEvents();
    const interval = setInterval(() => {
      setCircuitState(commandService.getCircuitBreakerState());
    }, 1000);
    return () => clearInterval(interval);
  }, [state.tasks]);

  const updateMetrics = useCallback(async () => {
    const m = await queryService.getTaskMetrics(state.tasks);
    setMetrics(m);
  }, [state.tasks, queryService]);

  const updateEvents = useCallback(async () => {
    const events = await queryService.getRecentEvents(commandService.getEvents());
    setRecentEvents(events);
  }, [commandService, queryService]);

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim()) return;
    
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      const task = await commandService.createTask(newTaskTitle, newTaskPriority);
      dispatch({ type: 'ADD_TASK', payload: task });
      setNewTaskTitle('');
      updateEvents();
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Erro ao criar tarefa' });
    }
  };

  const handleUpdateStatus = async (task: Task, newStatus: Task['status']) => {
    dispatch({ type: 'SET_LOADING', payload: true });
    
    try {
      const updatedTask = await commandService.updateTaskStatus(task, newStatus);
      dispatch({ type: 'UPDATE_TASK', payload: updatedTask });
      updateEvents();
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: error instanceof Error ? error.message : 'Erro ao atualizar tarefa' });
    }
  };

  const getStatusColor = (status: Task['status']) => {
    const colors = {
      pending: 'bg-gray-100 text-gray-700',
      in_progress: 'bg-blue-100 text-blue-700',
      completed: 'bg-green-100 text-green-700',
      failed: 'bg-red-100 text-red-700'
    };
    return colors[status];
  };

  const getPriorityColor = (priority: Task['priority']) => {
    const colors = {
      low: 'bg-gray-200',
      medium: 'bg-yellow-200',
      high: 'bg-red-200'
    };
    return colors[priority];
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-slate-800 mb-2">
            Sistema de Gerenciamento de Tarefas
          </h1>
          <p className="text-slate-600">
            Arquitetura Enterprise: DDD + CQRS + Event Sourcing + Circuit Breaker
          </p>
        </div>

        {/* System Health */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Circuit Breaker</p>
                <p className={`text-2xl font-bold ${
                  circuitState === 'CLOSED' ? 'text-green-600' : 
                  circuitState === 'HALF_OPEN' ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {circuitState}
                </p>
              </div>
              <Activity className={`w-8 h-8 ${
                circuitState === 'CLOSED' ? 'text-green-600' : 
                circuitState === 'HALF_OPEN' ? 'text-yellow-600' : 'text-red-600'
              }`} />
            </div>
          </div>

          {metrics && (
            <>
              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Total de Tarefas</p>
                    <p className="text-2xl font-bold text-slate-800">{metrics.total}</p>
                  </div>
                  <Database className="w-8 h-8 text-slate-600" />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Concluídas</p>
                    <p className="text-2xl font-bold text-green-600">{metrics.completed}</p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-600" />
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Alta Prioridade</p>
                    <p className="text-2xl font-bold text-red-600">{metrics.highPriority}</p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-red-600" />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Task Creation */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h2 className="text-xl font-semibold text-slate-800 mb-4">Criar Nova Tarefa</h2>
              
              {state.error && (
                <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <span className="text-red-700">{state.error}</span>
                </div>
              )}

              <div className="space-y-4">
                <input
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  placeholder="Digite o título da tarefa..."
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={state.isLoading}
                />
                
                <div className="flex gap-4">
                  <select
                    value={newTaskPriority}
                    onChange={(e) => setNewTaskPriority(e.target.value as Task['priority'])}
                    className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={state.isLoading}
                  >
                    <option value="low">Baixa Prioridade</option>
                    <option value="medium">Média Prioridade</option>
                    <option value="high">Alta Prioridade</option>
                  </select>
                  
                  <button
                    onClick={handleCreateTask}
                    disabled={state.isLoading || !newTaskTitle.trim()}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                  >
                    {state.isLoading ? 'Criando...' : 'Criar Tarefa'}
                  </button>
                </div>
              </div>
            </div>

            {/* Task List */}
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-slate-800 mb-4">Lista de Tarefas</h2>
              
              <div className="space-y-3">
                {state.tasks.length === 0 ? (
                  <p className="text-slate-500 text-center py-8">Nenhuma tarefa criada ainda</p>
                ) : (
                  state.tasks.map(task => (
                    <div key={task.id} className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h3 className="font-medium text-slate-800 mb-1">{task.title}</h3>
                          <div className="flex gap-2">
                            <span className={`text-xs px-2 py-1 rounded-full ${getStatusColor(task.status)}`}>
                              {task.status.replace('_', ' ')}
                            </span>
                            <span className={`text-xs px-2 py-1 rounded-full ${getPriorityColor(task.priority)}`}>
                              {task.priority}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        {task.status === 'pending' && (
                          <button
                            onClick={() => handleUpdateStatus(task, 'in_progress')}
                            className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                          >
                            Iniciar
                          </button>
                        )}
                        {task.status === 'in_progress' && (
                          <>
                            <button
                              onClick={() => handleUpdateStatus(task, 'completed')}
                              className="text-xs px-3 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                            >
                              Concluir
                            </button>
                            <button
                              onClick={() => handleUpdateStatus(task, 'failed')}
                              className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                            >
                              Falhar
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Event Sourcing Log */}
          <div>
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-semibold text-slate-800 mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Event Sourcing Log
              </h2>
              
              <div className="space-y-2">
                {recentEvents.length === 0 ? (
                  <p className="text-slate-500 text-sm text-center py-4">Nenhum evento registrado</p>
                ) : (
                  recentEvents.map((event, idx) => (
                    <div key={idx} className="border-l-4 border-blue-500 pl-3 py-2 bg-slate-50 rounded">
                      <p className="text-xs font-semibold text-slate-700">{event.type}</p>
                      <p className="text-xs text-slate-600 truncate">{event.payload.title}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(event.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}