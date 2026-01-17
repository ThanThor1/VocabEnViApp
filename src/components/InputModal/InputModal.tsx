import React, { useState, useEffect } from "react";

export default function InputModal({
  title,
  placeholder,
  onClose,
  onConfirm,
}: {
  title: string;
  placeholder: string;
  onClose: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  const [errorMessage, setErrorMessage] = useState<string>('')

  useEffect(() => {
    setValue("");
  }, [title]);

  function handleConfirm() {
    if (!value.trim()) {
      setErrorMessage('Please enter a value')
      setTimeout(() => setErrorMessage(''), 3000)
      return;
    }
    onConfirm(value.trim());
    setValue("");
  }

  function handleClose() {
    setValue("");
    onClose();
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        {/* Header */}
        <div className="modal-header bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/30">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </div>
            <h3 className="modal-title">{title}</h3>
          </div>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {errorMessage && (
            <div className="alert-error animate-slide-up">
              <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <span>{errorMessage}</span>
            </div>
          )}
          
          <div className="relative">
            <input
              type="text"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleConfirm();
                if (e.key === "Escape") handleClose();
              }}
              autoFocus
              className="input-field w-full pl-11"
            />
            <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={handleClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={handleConfirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
