import { useState } from 'react';
import { appendLedger } from '../hermes/ledgerStore';
import {
  addTodo,
  removeTodo,
  toggleTodo,
  toggleTodoUrgent,
  useTodos,
  type Todo,
} from '../state/todos';
import { Panel } from '../ui';
import { setDraggedTodo, TODO_DRAG_TYPE } from './todoDrag';

interface TasksPanelProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The Tasks panel: UPenn to-dos, docked without a backdrop so open tasks
 * can be dragged straight onto the grid — dropping stages a pending create
 * the user confirms in place.
 */
export function TasksPanel({ open, onClose }: TasksPanelProps) {
  const todos = useTodos();
  const [text, setText] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addTodo(trimmed);
    appendLedger('todo', `Captured a to-do: “${trimmed}”.`);
    setText('');
  }

  function onDragStart(e: React.DragEvent, todo: Todo) {
    setDraggedTodo(todo);
    e.dataTransfer.setData(TODO_DRAG_TYPE, JSON.stringify({ id: todo.id, text: todo.text }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  const openTodos = todos.filter((t) => !t.done);
  const doneTodos = todos.filter((t) => t.done);

  function row(todo: Todo) {
    return (
      <li
        key={todo.id}
        className={`todo-row${todo.done ? ' done' : ''}${todo.urgent ? ' urgent' : ''}`}
        draggable={!todo.done}
        onDragStart={(e) => onDragStart(e, todo)}
        onDragEnd={() => setDraggedTodo(null)}
      >
        <input
          type="checkbox"
          checked={todo.done}
          onChange={() => toggleTodo(todo.id)}
          aria-label={`Mark “${todo.text}” ${todo.done ? 'not done' : 'done'}`}
        />
        <span className="todo-text">{todo.text}</span>
        <button
          className="todo-flag"
          title={todo.urgent ? 'Remove urgency' : 'Mark urgent'}
          aria-label={todo.urgent ? 'Remove urgency' : 'Mark urgent'}
          aria-pressed={Boolean(todo.urgent)}
          onClick={() => toggleTodoUrgent(todo.id)}
        >
          !
        </button>
        <button
          className="todo-remove"
          title="Remove"
          aria-label={`Remove “${todo.text}”`}
          onClick={() => removeTodo(todo.id)}
        >
          ✕
        </button>
      </li>
    );
  }

  return (
    <Panel open={open} onClose={onClose} title="Tasks" width={340} modal={false}>
      <form className="todo-add" onSubmit={submit}>
        <input
          type="text"
          value={text}
          placeholder="Add a to-do…"
          onChange={(e) => setText(e.target.value)}
          aria-label="New to-do"
        />
        <button className="btn primary" type="submit">
          Add
        </button>
      </form>
      {todos.length === 0 ? (
        <p className="scrolls-note">Nothing owed. A rare and enviable state.</p>
      ) : (
        <>
          <p className="tasks-hint">Drag a task onto the grid to give it an hour.</p>
          <ul className="todo-list">{openTodos.map(row)}</ul>
          {doneTodos.length > 0 && (
            <>
              <h3 className="scrolls-heading">Done</h3>
              <ul className="todo-list">{doneTodos.map(row)}</ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}
