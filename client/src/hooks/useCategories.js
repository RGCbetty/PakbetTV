import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

// In development, use relative paths to leverage Vite's proxy
const isDevelopment = process.env.NODE_ENV === "development";
const API_URL = isDevelopment ? "/api" : "https://michaeldemesa.com/api";

console.log("useCategories API_URL:", API_URL, "isDevelopment:", isDevelopment);

export const useCategories = () => {
  const queryClient = useQueryClient();

  // Fetch all categories with optimizations
  const getAllCategories = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      console.log("Fetching categories from:", `${API_URL}/categories`);
      try {
        const { data } = await axios.get(`${API_URL}/categories`);
        console.log("Categories API response:", data);
        // Ensure we always return an array
        return Array.isArray(data) ? data : [];
      } catch (error) {
        console.error("Categories API error:", error);
        // Log more details about the error
        if (error.response) {
          console.error(
            "Error response:",
            error.response.status,
            error.response.data
          );
        } else if (error.request) {
          console.error("No response received:", error.request);
        } else {
          console.error("Error setting up request:", error.message);
        }
        throw error;
      }
    },
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
    cacheTime: 1000 * 60 * 30, // Keep data in cache for 30 minutes
    refetchOnMount: true, // Allow refetch on mount to ensure data is loaded
    retry: 3, // Retry failed requests 3 times
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
    initialData: () => {
      // Only return cached data if it exists and has items
      const cached = queryClient.getQueryData(["categories"]);
      return Array.isArray(cached) && cached.length > 0 ? cached : undefined;
    },
  });

  // Create category mutation
  const createCategory = useMutation({
    mutationFn: async (categoryData) => {
      const { data } = await axios.post(`${API_URL}/categories`, categoryData);
      return data;
    },
    onSuccess: (newCategory) => {
      // Optimistically update the cache
      queryClient.setQueryData(["categories"], (old = []) => [
        ...old,
        newCategory,
      ]);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  // Update category mutation
  const updateCategory = useMutation({
    mutationFn: async ({ id, ...updateData }) => {
      const { data } = await axios.put(
        `${API_URL}/categories/${id}`,
        updateData
      );
      return data;
    },
    onSuccess: (updatedCategory, variables) => {
      // Optimistically update the cache
      queryClient.setQueryData(["categories"], (old = []) =>
        // Ensure old is an array before calling map
        Array.isArray(old)
          ? old.map((category) =>
              category.id === variables.id ? updatedCategory : category
            )
          : [updatedCategory]
      );
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  // Delete category mutation
  const deleteCategory = useMutation({
    mutationFn: async (id) => {
      await axios.delete(`${API_URL}/categories/${id}`);
    },
    onSuccess: (_, deletedId) => {
      // Optimistically update the cache
      queryClient.setQueryData(["categories"], (old = []) =>
        old.filter((category) => category.id !== deletedId)
      );
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });

  return {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  };
};
