import Cookies from "js-cookie";

const COOKIE_OPTIONS = {
  expires: 7, // 7 days
  path: "/", // Make cookie available across the site
  secure: window.location.protocol === "https:", // Only use secure in HTTPS
  sameSite: "lax", // Less restrictive than 'strict' to allow better functionality
};

export const setCookie = (name, value) => {
  Cookies.set(name, value, COOKIE_OPTIONS);
};

export const getCookie = (name) => {
  return Cookies.get(name);
};

export const removeCookie = (name) => {
  Cookies.remove(name);
};

// Helper functions for common operations
export const setAuthToken = (token) => {
  setCookie("token", token);
};

export const getAuthToken = () => {
  return getCookie("token");
};

export const removeAuthToken = () => {
  removeCookie("token");
};

export const setUser = (user) => {
  setCookie("user", JSON.stringify(user));
};

export const getUser = () => {
  const userStr = getCookie("user");
  try {
    return userStr ? JSON.parse(userStr) : null;
  } catch (e) {
    console.error("Error parsing user cookie:", e);
    return null;
  }
};

export const removeUser = () => {
  removeCookie("user");
};

export const setCart = (cart, userId = "guest") => {
  const key = `cart_${userId}`;

  // Validate cart data
  if (!Array.isArray(cart)) {
    console.error("[Cookies] Invalid cart data, must be an array:", cart);
    return;
  }

  const cartData = JSON.stringify(cart);
  console.log("[Cookies] Attempting to save cart:", {
    userId,
    items: cart.length,
  });

  try {
    // Save to cookies
    setCookie(key, cartData);
    console.log("[Cookies] Cart saved to cookies successfully");

    // Save to localStorage
    localStorage.setItem(key, cartData);
    console.log("[Cookies] Cart saved to localStorage successfully");
  } catch (e) {
    console.error("[Cookies] Error saving cart to cookies:", e);

    // Try localStorage as fallback
    try {
      localStorage.setItem(key, cartData);
      console.log("[Cookies] Cart saved to localStorage as fallback");
    } catch (e2) {
      console.error("[Cookies] Failed to save cart to localStorage:", e2);
    }
  }
};

export const getCart = (userId = "guest") => {
  const key = `cart_${userId}`;
  console.log("[Cookies] Attempting to load cart for:", userId);

  try {
    // Try cookies first
    const cartStr = getCookie(key);
    if (cartStr) {
      const cartData = JSON.parse(cartStr);
      if (Array.isArray(cartData)) {
        console.log(
          "[Cookies] Cart loaded from cookies:",
          cartData.length,
          "items"
        );
        return cartData;
      }
      console.warn(
        "[Cookies] Invalid cart data in cookies, falling back to localStorage"
      );
    }

    // Try localStorage as fallback
    const localCartStr = localStorage.getItem(key);
    if (localCartStr) {
      const localCart = JSON.parse(localCartStr);
      if (Array.isArray(localCart)) {
        console.log(
          "[Cookies] Cart loaded from localStorage:",
          localCart.length,
          "items"
        );
        // Sync back to cookies
        setCookie(key, localCartStr);
        return localCart;
      }
      console.warn("[Cookies] Invalid cart data in localStorage");
    }

    console.log("[Cookies] No valid cart data found, returning empty array");
    return [];
  } catch (e) {
    console.error("[Cookies] Error loading cart:", e);
    return [];
  }
};

export const removeCart = (userId = "guest") => {
  const key = `cart_${userId}`;
  console.log("[Cookies] Removing cart for:", userId);

  try {
    removeCookie(key);
    localStorage.removeItem(key);
    console.log("[Cookies] Cart removed successfully");
  } catch (e) {
    console.error("[Cookies] Error removing cart:", e);
  }
};
