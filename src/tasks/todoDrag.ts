import type { Todo } from '../state/todos';

// The bridge between a to-do row being dragged out of the Tasks panel and
// the TimeGrid it lands on. HTML5 drag-and-drop hides dataTransfer contents
// until drop, so the panel parks the todo here on dragstart and the grid
// reads it to draw a live ghost while hovering.

export const TODO_DRAG_TYPE = 'application/x-seans-week-todo';

let dragged: Todo | null = null;

export function setDraggedTodo(todo: Todo | null): void {
  dragged = todo;
}

export function getDraggedTodo(): Todo | null {
  return dragged;
}
