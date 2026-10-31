import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/operations";
import type { EmployeeSummary } from "@/lib/types";

/** Active staff list (basic fields), used by pickers and the roster. */
export function useEmployees() {
  return useQuery({ queryKey: ["employees"], queryFn: () => api.get<EmployeeSummary[]>("/employees"), staleTime: 5 * 60_000 });
}

/**
 * Mutation helper: runs the request, refreshes the listed query groups,
 * and shows a success or error toast.
 */
export function useApiMutation<TInput, TResult = unknown>(
  fn: (input: TInput) => Promise<TResult>,
  options: {
    invalidate?: string[];
    success?: string | ((result: TResult, input: TInput) => string);
    errorTitle?: string;
  } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (result, input) => {
      await Promise.all(
        [...(options.invalidate ?? []), "dashboard"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })),
      );
      const message = typeof options.success === "function" ? options.success(result, input) : options.success;
      if (message) toast.success(message);
    },
    onError: (error) => {
      toast.error(options.errorTitle ?? "Something went wrong", { description: errorMessage(error) });
    },
  });
}

export { api };
