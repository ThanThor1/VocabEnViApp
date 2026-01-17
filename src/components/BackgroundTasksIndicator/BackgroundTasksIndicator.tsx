import React, { useState } from 'react'
import { useBackgroundTasks, BackgroundTranslationTask } from '../../contexts/BackgroundTasksContext'
import './BackgroundTasksIndicator.css'

export default function BackgroundTasksIndicator() {
  const { tasks, runningCount, completedCount, removeTask, clearCompletedTasks } = useBackgroundTasks()
  const [expanded, setExpanded] = useState(false)

  // Don't show if no tasks
  if (tasks.length === 0) return null

  const pendingTasks = tasks.filter(t => t.status === 'pending' || t.status === 'running')
  const completedTasks = tasks.filter(t => t.status === 'completed')
  const errorTasks = tasks.filter(t => t.status === 'error')

  return (
    <div className="background-tasks-indicator">
      {/* Collapsed button */}
      <button
        className={`tasks-toggle-btn ${runningCount > 0 ? 'has-running' : completedCount > 0 ? 'has-completed' : ''}`}
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Thu gọn' : 'Xem các tác vụ nền'}
      >
        {runningCount > 0 ? (
          <>
            <div className="spinner" />
            <span className="count">{runningCount}</span>
          </>
        ) : (
          <>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="count">{completedCount}</span>
          </>
        )}
      </button>

      {/* Expanded panel */}
      {expanded && (
        <div className="tasks-panel">
          <div className="tasks-header">
            <h3>Tác vụ dịch nền</h3>
            <div className="tasks-actions">
              {completedTasks.length > 0 && (
                <button
                  className="clear-btn"
                  onClick={clearCompletedTasks}
                  title="Xóa hoàn tất"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
              <button
                className="close-btn"
                onClick={() => setExpanded(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <div className="tasks-list">
            {tasks.length === 0 ? (
              <div className="no-tasks">Không có tác vụ nào</div>
            ) : (
              <>
                {/* Running tasks */}
                {pendingTasks.map(task => (
                  <TaskItem key={task.id} task={task} onRemove={removeTask} />
                ))}

                {/* Completed tasks */}
                {completedTasks.map(task => (
                  <TaskItem key={task.id} task={task} onRemove={removeTask} />
                ))}

                {/* Error tasks */}
                {errorTasks.map(task => (
                  <TaskItem key={task.id} task={task} onRemove={removeTask} />
                ))}
              </>
            )}
          </div>

          {/* Summary */}
          <div className="tasks-summary">
            {runningCount > 0 && <span className="running">⏳ {runningCount} đang chạy</span>}
            {completedCount > 0 && <span className="completed">✅ {completedCount} hoàn tất</span>}
            {errorTasks.length > 0 && <span className="error">❌ {errorTasks.length} lỗi</span>}
          </div>
        </div>
      )}
    </div>
  )
}

function TaskItem({ task, onRemove }: { task: BackgroundTranslationTask; onRemove: (id: string) => void }) {
  const isRunning = task.status === 'pending' || task.status === 'running'
  const isCompleted = task.status === 'completed'
  const isError = task.status === 'error'

  return (
    <div className={`task-item ${task.status}`}>
      <div className="task-info">
        <div className="task-word">{task.word}</div>
        <div className="task-status">
          {isRunning && <span className="status-running">{task.progress}</span>}
          {isCompleted && task.meaning && (
            <span className="status-completed">{task.meaning}</span>
          )}
          {isError && <span className="status-error">{task.error || 'Lỗi'}</span>}
        </div>
      </div>
      <div className="task-actions">
        {isRunning ? (
          <div className="mini-spinner" />
        ) : isCompleted ? (
          <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : isError ? (
          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        ) : null}
        <button
          className="remove-btn"
          onClick={() => onRemove(task.id)}
          title="Xóa"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}
