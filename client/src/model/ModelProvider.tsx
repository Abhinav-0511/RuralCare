import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { useOnline } from '../lib/connectivity';
import { loadStoredPredictor, type Predictor, updateModel } from './modelManager';

interface ModelState {
  predictor: Predictor | null;
  status: 'loading' | 'ready' | 'none' | 'updating';
}

const ModelContext = createContext<ModelState>({ predictor: null, status: 'loading' });

/** Loads the model from IndexedDB, and checks for a newer one whenever the app comes online. */
export function ModelProvider({ children }: { children: ReactNode }) {
  const online = useOnline();
  const [state, setState] = useState<ModelState>({ predictor: null, status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    loadStoredPredictor()
      .then(
        (p) => !cancelled && setState((s) => ({ predictor: p ?? s.predictor, status: p ? 'ready' : 'none' })),
      )
      .catch(() => !cancelled && setState({ predictor: null, status: 'none' }));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    updateModel()
      .then(async (r) => {
        if (cancelled) return;
        if (r.status === 'unavailable') {
          setState((s) => ({ ...s, status: s.predictor ? 'ready' : 'none' }));
          return;
        }
        const predictor = await loadStoredPredictor();
        if (!cancelled) setState({ predictor, status: predictor ? 'ready' : 'none' });
      })
      .catch(() => !cancelled && setState((s) => ({ ...s, status: s.predictor ? 'ready' : 'none' })));
    return () => {
      cancelled = true;
    };
  }, [online]);

  return <ModelContext.Provider value={state}>{children}</ModelContext.Provider>;
}

export const useModel = () => useContext(ModelContext);
