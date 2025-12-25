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

  useEffect(() => {
    setValue("");
  }, [title]);

  function handleConfirm() {
    if (!value.trim()) {
      alert("Please enter a value");
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
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-50">
      <div className="bg-white p-6 w-96 rounded shadow-lg">
        <h3 className="font-semibold text-lg mb-4">{title}</h3>
        <input
          type="text"
          placeholder={placeholder}
          className="border p-2 w-full rounded mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleConfirm();
            if (e.key === "Escape") handleClose();
          }}
          autoFocus
        />
        <div className="flex gap-2 justify-end">
          <button
            className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={handleConfirm}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
