import { useState, useEffect, Dispatch, SetStateAction } from 'react';

type SerializationOptions<T> = {
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
};

/**
 * Custom hook for persisting state to localStorage
 * @param key - localStorage key
 * @param defaultValue - default value if nothing in localStorage
 * @param options - optional custom serialization/deserialization functions
 * @returns [state, setState] tuple like useState
 */
export function usePersistedState<T>(
  key: string, 
  defaultValue: T,
  options?: SerializationOptions<T>
): [T, Dispatch<SetStateAction<T>>] {
  const serialize = options?.serialize || ((value: T) => JSON.stringify(value));
  const deserialize = options?.deserialize || ((str: string) => JSON.parse(str) as T);

  const [state, setState] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? deserialize(item) : defaultValue;
    } catch (error) {
      console.error(`Error loading persisted state for key "${key}":`, error);
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, serialize(state));
    } catch (error) {
      console.error(`Error saving persisted state for key "${key}":`, error);
    }
  }, [key, state, serialize]);

  return [state, setState];
}
