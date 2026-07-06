import { useSyncExternalStore } from 'react';

// Uses the legacy localStorage key + item shape ({ id, text, done, urgent? })
// so to-dos captured in the old app carry straight over. Phase 3's Tasks
// panel reads this same store.
const STORAGE_KEY = 'upennTodos';

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  urgent?: boolean;
}

function load(): Todo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Todo[]) : [];
  } catch {
    return [];
  }
}

let todos: Todo[] = load();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  } catch {
    /* storage unavailable — keep the in-memory copy */
  }
  listeners.forEach((fn) => fn());
}

export function getTodos(): Todo[] {
  return todos;
}

export function addTodo(text: string): Todo {
  const todo: Todo = { id: `t${Date.now()}`, text, done: false };
  todos = [...todos, todo];
  persist();
  return todo;
}

export function toggleTodo(id: string): void {
  todos = todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t));
  persist();
}

export function removeTodo(id: string): void {
  todos = todos.filter((t) => t.id !== id);
  persist();
}

export function subscribeTodos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** React hook: the current to-do list, reactive to all mutations. */
export function useTodos(): Todo[] {
  return useSyncExternalStore(subscribeTodos, getTodos);
}
