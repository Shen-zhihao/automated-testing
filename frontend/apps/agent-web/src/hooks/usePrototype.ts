import { useSyncExternalStore } from 'react';
import { prototypeApi } from '@project/shared-api';

export function usePrototype() {
  return useSyncExternalStore(prototypeApi.subscribe, prototypeApi.getSnapshot);
}
