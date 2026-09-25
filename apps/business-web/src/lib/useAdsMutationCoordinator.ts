import { useCallback, useState } from "react";
import { adsMutationCoordinator, type AdsMutationRunInput } from "./adsMutationCoordinator";

export type AdsMutationUiState =
  | { kind: "idle" }
  | { kind: "pending"; operation: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }
  | { kind: "uncertain"; message: string }
  | { kind: "conflict"; message: string };

type MutationPresentation<T> = {
  successMessage: string;
  errorMessage: (cause: unknown) => string;
  afterSuccess?: (value: T) => Promise<void> | void;
};

export function useAdsMutationCoordinator() {
  const [state, setState] = useState<AdsMutationUiState>({ kind: "idle" });
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);

  const run = useCallback(async <T,>(input: AdsMutationRunInput<T>, presentation: MutationPresentation<T>) => {
    setRefreshWarning(null);
    setState({ kind: "pending", operation: `${input.operation}:${input.scope}` });
    try {
      const result = await adsMutationCoordinator.run(input);
      if (result.state === "uncertain") {
        setState({ kind: "uncertain", message: result.message });
        return result;
      }
      if (result.state === "conflict") {
        setState({ kind: "conflict", message: result.message });
        return result;
      }

      setState({ kind: "success", message: result.message ?? presentation.successMessage });
      if (presentation.afterSuccess) {
        try { await presentation.afterSuccess(result.value); }
        catch { setRefreshWarning("Saved, but we couldn't refresh the latest view."); }
      }
      return result;
    } catch (cause) {
      setState({ kind: "error", message: presentation.errorMessage(cause) });
      return null;
    }
  }, []);

  return {
    state,
    refreshWarning,
    pending: state.kind === "pending",
    run,
  };
}
