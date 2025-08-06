import axios from "axios";
import { notify, handleApiError } from "../utils/notifications";
import {
  getAuthToken,
  setAuthToken,
  removeAuthToken,
  removeUser,
} from "../utils/cookies";
import API_BASE_URL from "../config";

// Create a custom axios instance
const api = axios.create({
  baseURL: "/api", // Use relative path to trigger the proxy
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// Track if we're currently redirecting to login to prevent multiple redirects
let isRedirectingToLogin = false;
// Track if we're currently refreshing token
let isRefreshingToken = false;
// Store pending requests that wait for token refresh
let pendingRequests = [];

// Add request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = getAuthToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Log the request for debugging
    console.log("[API Request]:", {
      method: config.method,
      url: config.url,
      data: config.data,
    });

    return config;
  },
  (error) => {
    console.error("[API Request Error]:", error);
    return Promise.reject(error);
  }
);

// Add response interceptor to handle token expiration and refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    const isAuthEndpoint = originalRequest.url.includes("/auth/");
    const currentPath = window.location.pathname;

    // Log the error for debugging
    console.log("[API Error]:", {
      status: error.response?.status,
      url: originalRequest.url,
      message: error.response?.data?.message,
    });

    // If we get a 401 and we're not already refreshing the token
    if (
      error.response?.status === 401 &&
      !isRefreshingToken &&
      !isAuthEndpoint
    ) {
      try {
        isRefreshingToken = true;
        console.log("Token expired, attempting refresh...");

        const currentToken = getAuthToken();
        if (!currentToken) {
          throw new Error("No token to refresh");
        }

        // Create a new request without the interceptor's Authorization header
        const refreshResponse = await axios.post("/api/auth/refresh", {
          token: currentToken,
        });

        if (refreshResponse?.data?.token) {
          const newToken = refreshResponse.data.token;
          setAuthToken(newToken);

          // Update the original request with new token
          originalRequest.headers.Authorization = `Bearer ${newToken}`;

          // Retry the original request
          return api(originalRequest);
        } else {
          throw new Error("Token refresh failed - no token in response");
        }
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError);

        // Clear auth data
        removeAuthToken();
        removeUser();

        // Only redirect if not on a public route and not already redirecting
        if (!isRedirectingToLogin) {
          isRedirectingToLogin = true;
          const isPublicRoute = [
            "/",
            "/login",
            "/signup",
            "/shop",
            "/product",
          ].some((route) => currentPath.startsWith(route));

          if (!isPublicRoute) {
            notify.error("Your session has expired. Please log in again.");
            window.location.href = "/login";
          }
        }

        // Reject the original request
        return Promise.reject(error);
      } finally {
        isRefreshingToken = false;
      }
    }

    // Handle 403 errors specifically
    if (error.response?.status === 403) {
      console.error("Access forbidden:", error.response?.data?.message);
      // Don't show error for canDeleteAccount endpoint as it's an expected state
      if (!originalRequest.url.includes("/users/can-delete-account")) {
        notify.error("You do not have permission to perform this action");
      }
    }

    return Promise.reject(error);
  }
);

export const authService = {
  signup: async (userData) => {
    try {
      const response = await api.post("/auth/signup", userData);
      notify.success("Account created successfully! Please log in.");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  login: async (credentials) => {
    try {
      const response = await api.post("/auth/login", credentials);
      const { token, user } = response.data;
      setAuthToken(token);
      notify.success("Welcome back!");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  refreshToken: async () => {
    const token = getAuthToken();
    if (!token) {
      throw new Error("No token to refresh");
    }
    return api.post("/auth/refresh", { token });
  },

  getProfile: async () => {
    try {
      return await api.get("/auth/me");
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  updateProfile: async (userData) => {
    try {
      const response = await api.put("/users/profile", userData);
      notify.success("Profile updated successfully!");
      return response;
    } catch (error) {
      if (error.response?.data?.message) {
        notify.error(error.response.data.message);
      } else {
        notify.error("Failed to update profile");
      }
      throw error;
    }
  },

  getShippingAddresses: async () => {
    try {
      return await api.get("/users/shipping-addresses");
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  addShippingAddress: async (addressData) => {
    try {
      const response = await api.post("/users/shipping-address", addressData);
      notify.success("Shipping address saved successfully!");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  updateShippingAddress: async (addressId, addressData) => {
    try {
      const response = await api.put(
        `/users/shipping-address/${addressId}`,
        addressData
      );
      notify.success("Shipping address saved successfully!");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  deleteShippingAddress: async (addressId) => {
    try {
      const response = await api.delete(`/users/shipping-address/${addressId}`);
      notify.success("Shipping address deleted successfully!");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  updateUsername: async (username) => {
    try {
      const response = await api.put("/users/update-username", { username });
      notify.success("Username updated successfully!");
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  updatePassword: async (currentPassword, newPassword) => {
    try {
      // Verify token exists before making request
      const token = getAuthToken();
      if (!token) {
        notify.error("You must be logged in to update your password");
        window.location.href = "/login";
        throw new Error("No authentication token");
      }

      const response = await api.put("/auth/update-password", {
        currentPassword,
        newPassword,
      });
      notify.success("Password updated successfully!");
      return response;
    } catch (error) {
      console.error(
        "Password update error:",
        error.response?.data || error.message
      );

      // Handle specific error cases
      if (error.response?.status === 401) {
        notify.error("Your session has expired. Please log in again.");
        removeAuthToken();
        removeUser();
        window.location.href = "/login";
      } else if (error.response?.status === 403) {
        notify.error(
          "Not authorized to update password. Please try again or contact support."
        );
      } else if (error.response?.data?.message) {
        notify.error(error.response.data.message);
      } else {
        notify.error("Failed to update password. Please try again.");
      }
      throw error;
    }
  },

  deleteAccount: async () => {
    try {
      const response = await api.delete("/users/account");
      removeAuthToken();
      removeUser();
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  canDeleteAccount: async () => {
    try {
      const response = await api.get("/users/can-delete-account");
      return response.data;
    } catch (error) {
      // Log the error for debugging
      console.error("Error checking if account can be deleted:", {
        status: error.response?.status,
        message: error.response?.data?.message,
      });

      // Don't show error notification for 403 as it's an expected state
      if (!error.response?.status === 403) {
        handleApiError(error);
      }
      throw error;
    }
  },

  getRegions: async () => {
    try {
      console.log("🔍 [API] Making GET request to /locations/regions");
      const response = await api.get("/locations/regions");
      console.log("🔍 [API] Regions response:", response);
      return response;
    } catch (error) {
      console.error("❌ [API] Error fetching regions:", error);
      handleApiError(error);
      throw error;
    }
  },

  getProvinces: async (regionId) => {
    try {
      console.log(
        "🔍 [API] Making GET request to /locations/provinces/" + regionId
      );
      const response = await api.get(`/locations/provinces/${regionId}`);
      console.log("🔍 [API] Provinces response:", response);
      return response;
    } catch (error) {
      console.error("❌ [API] Error fetching provinces:", error);
      handleApiError(error);
      throw error;
    }
  },

  getCities: async (provinceId) => {
    try {
      console.log(
        "🔍 [API] Making GET request to /locations/cities/" + provinceId
      );
      const response = await api.get(`/locations/cities/${provinceId}`);
      console.log("🔍 [API] Cities response:", response);
      return response;
    } catch (error) {
      console.error("❌ [API] Error fetching cities:", error);
      handleApiError(error);
      throw error;
    }
  },

  getBarangays: async (cityId) => {
    try {
      return await api.get(`/locations/barangays/${cityId}`);
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  getDistricts: async (regionId = "130000000") => {
    try {
      console.log(
        "🔍 [API] Making GET request to /locations/districts/" + regionId
      );
      const response = await api.get(`/locations/districts/${regionId}`);
      console.log("🔍 [API] Districts response:", response);
      return response;
    } catch (error) {
      console.error("❌ [API] Error fetching districts:", error);
      handleApiError(error);
      throw error;
    }
  },

  validateAddress: async (addressData) => {
    try {
      return await api.post("/locations/validate-address", addressData);
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  clearPSGCCache: async () => {
    try {
      return await api.post("/locations/clear-cache");
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },
};

// Order and Transaction Services
export const orderService = {
  createOrder: async (orderData) => {
    try {
      const response = await api.post("/transactions/orders", orderData);
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  processPayment: async (paymentData) => {
    try {
      const response = await api.post("/transactions/payment", paymentData);
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  verifyTransaction: async (txnId, refNo, status) => {
    try {
      const response = await api.get("/transactions/verify", {
        params: { txnId, refNo, status },
      });
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  getOrders: async () => {
    try {
      return await api.get("/orders");
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  getOrderById: async (orderId) => {
    try {
      return await api.get(`/orders/${orderId}`);
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },

  cancelOrder: async (trackingId) => {
    try {
      const response = await api.delete(
        `/delivery/ninjavan/orders/${trackingId}`
      );
      return response;
    } catch (error) {
      handleApiError(error);
      throw error;
    }
  },
};

export default api;
