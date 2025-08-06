import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext";
import { getFullImageUrl } from "../utils/imageUtils";
import { getCart, setCart, removeCart, getAuthToken } from "../utils/cookies";
import api from "../services/axiosConfig";

export const useCartData = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Cart query with caching
  const getCartData = useQuery({
    queryKey: ["cart", user?.id || "guest"],
    queryFn: async () => {
      if (user?.id) {
        // Fetch from database for authenticated users
        try {
          const response = await api.get("/cart");
          const dbCartItems = response.data.map((item) => ({
            cart_id: item.cart_id,
            id: item.product_id,
            product_id: item.product_id,
            variant_id: item.variant_id,
            name: item.product_name,
            product_name: item.product_name,
            price: parseFloat(item.price),
            discount_percentage: parseFloat(item.discount_percentage || 0),
            discounted_price: parseFloat(item.discounted_price || 0),
            quantity: item.quantity,
            stock: item.stock,
            image_url: getFullImageUrl(item.image_url),
            size: item.size,
            color: item.color,
            sku: item.sku,
            variant_attributes: item.variant_attributes || {},
            selected: true, // Default to selected
          }));
          console.log("[useCart] Loaded cart from database:", dbCartItems);
          console.log(
            "[useCart] Cart items with discount data:",
            dbCartItems.map((item) => ({
              name: item.name,
              price: item.price,
              discount_percentage: item.discount_percentage,
              discounted_price: item.discounted_price,
            }))
          );
          return dbCartItems;
        } catch (error) {
          console.error("[useCart] Error fetching cart from database:", error);

          // Check if it's a token/auth issue
          if (error.response?.status === 401) {
            console.log("[useCart] Authentication error, clearing user data");
            // Let the auth interceptor handle the redirect
            return [];
          }

          // For server errors, try to use local storage as fallback
          console.log("[useCart] Server error, falling back to local storage");
          const savedCart = getCart(user.id) || getCart("guest");
          if (Array.isArray(savedCart) && savedCart.length > 0) {
            console.log(
              "[useCart] Using fallback cart from storage:",
              savedCart.length,
              "items"
            );
            return savedCart;
          }
          return [];
        }
      } else {
        // Load from localStorage for guest users
        try {
          const savedCart = getCart("guest");
          console.log("[useCart] Loaded cart from storage:", savedCart);
          return Array.isArray(savedCart) ? savedCart : [];
        } catch (error) {
          console.error("[useCart] Error loading cart from storage:", error);
          return [];
        }
      }
    },
    // Cache for 10 minutes
    staleTime: 1000 * 60 * 10,
    // Keep in cache for 30 minutes
    cacheTime: 1000 * 60 * 30,
    // Refetch on mount only if data is stale
    refetchOnMount: "stale",
    // Don't refetch on window focus
    refetchOnWindowFocus: false,
    // Retry once on failure
    retry: 1,
    // Enable query when we have user info or we're checking guest cart
    enabled: true,
  });

  // Add to cart mutation
  const addToCartMutation = useMutation({
    mutationFn: async ({ product, quantity = 1 }) => {
      console.log("[useCart] Adding to cart:", { product, quantity });

      // Validate input parameters
      if (!product) {
        throw new Error("Product information is required");
      }

      if (!product.id && !product.product_id) {
        throw new Error("Product ID is required");
      }

      // Ensure image URL is properly formatted
      const productWithProperImageUrl = {
        ...product,
        image_url: product.image_url
          ? getFullImageUrl(product.image_url)
          : "/placeholder-product.jpg",
      };

      if (user?.id) {
        // User is logged in - sync with database
        const response = await api.post("/cart", {
          product_id: product.id || product.product_id,
          variant_id: product.variant_id || null,
          quantity: quantity,
        });
        console.log("[useCart] Item added to database cart:", response.data);
        return response.data;
      } else {
        // Guest user - update local storage
        const currentCart = queryClient.getQueryData(["cart", "guest"]) || [];

        const existingItemIndex = currentCart.findIndex((item) => {
          if (product.variant_id && item.variant_id) {
            return item.variant_id === product.variant_id;
          }
          return (
            (item.id || item.product_id) === (product.id || product.product_id)
          );
        });

        let updatedCart;
        if (existingItemIndex >= 0) {
          updatedCart = [...currentCart];
          updatedCart[existingItemIndex] = {
            ...updatedCart[existingItemIndex],
            quantity: updatedCart[existingItemIndex].quantity + quantity,
            selected: true,
          };
        } else {
          updatedCart = [
            ...currentCart,
            {
              ...productWithProperImageUrl,
              quantity,
              selected: true,
              id: product.id || product.product_id,
              product_id: product.id || product.product_id,
            },
          ];
        }

        // Save to localStorage
        setCart(updatedCart, "guest");
        console.log("[useCart] Updated guest cart:", updatedCart);
        return updatedCart;
      }
    },
    onSuccess: () => {
      // Invalidate and refetch cart data
      queryClient.invalidateQueries(["cart", user?.id || "guest"]);
    },
    onError: (error) => {
      console.error("[useCart] Error adding item to cart:", error);
    },
  });

  // Remove from cart mutation
  const removeFromCartMutation = useMutation({
    mutationFn: async ({ productId, variantId = null, cartId = null }) => {
      if (user?.id && cartId) {
        // User is logged in - remove from database ONLY
        await api.delete(`/cart/${cartId}`);
        console.log("[useCart] Item removed from database cart");
        return { cartId };
      } else if (!user?.id) {
        // Guest user ONLY - update local storage
        const currentCart = queryClient.getQueryData(["cart", "guest"]) || [];
        const updatedCart = currentCart.filter((item) => {
          if (variantId && item.variant_id) {
            return item.variant_id !== variantId;
          }
          return (item.id || item.product_id) !== productId;
        });

        setCart(updatedCart, "guest");
        console.log("[useCart] Updated guest cart after removal:", updatedCart);
        return updatedCart;
      } else {
        throw new Error(
          "Cannot remove item: missing cart_id for authenticated user"
        );
      }
    },
    onSuccess: () => {
      // Invalidate and refetch cart data
      queryClient.invalidateQueries(["cart", user?.id || "guest"]);
    },
    onError: (error) => {
      console.error("[useCart] Error removing item from cart:", error);
    },
  });

  // Update quantity mutation
  const updateQuantityMutation = useMutation({
    mutationFn: async ({
      productId,
      quantity,
      variantId = null,
      cartId = null,
    }) => {
      console.log("[useCart] updateQuantity called with:", {
        productId,
        quantity,
        variantId,
        cartId,
        userLoggedIn: !!user?.id,
      });

      if (quantity <= 0) {
        // Remove item if quantity is 0 or negative
        return removeFromCartMutation.mutateAsync({
          productId,
          variantId,
          cartId,
        });
      }

      if (user?.id && cartId) {
        // User is logged in - update in database ONLY
        console.log(
          "[useCart] Updating cart item in database, cart_id:",
          cartId
        );
        await api.put(`/cart/${cartId}`, { quantity });
        console.log("[useCart] Quantity updated in database cart");
        return { cartId, quantity };
      } else if (!user?.id) {
        // Guest user ONLY - update local storage
        console.log("[useCart] Updating guest cart in localStorage");
        const currentCart = queryClient.getQueryData(["cart", "guest"]) || [];
        const updatedCart = currentCart.map((item) => {
          if (variantId && item.variant_id) {
            return item.variant_id === variantId ? { ...item, quantity } : item;
          }
          return (item.id || item.product_id) === productId
            ? { ...item, quantity }
            : item;
        });

        setCart(updatedCart, "guest");
        console.log("[useCart] Updated guest cart quantity:", updatedCart);
        return updatedCart;
      } else {
        console.error(
          "[useCart] Cannot update quantity - user is logged in but cart_id is missing:",
          { userId: user?.id, cartId }
        );
        throw new Error(
          "Cannot update quantity: missing cart_id for authenticated user"
        );
      }
    },
    onSuccess: () => {
      // Invalidate and refetch cart data
      queryClient.invalidateQueries(["cart", user?.id || "guest"]);
    },
    onError: (error) => {
      console.error("[useCart] Error updating quantity:", error);
    },
  });

  // Remove selected items mutation
  const removeSelectedItemsMutation = useMutation({
    mutationFn: async () => {
      const currentCart =
        queryClient.getQueryData(["cart", user?.id || "guest"]) || [];
      const selectedItems = currentCart.filter((item) => item.selected);

      if (user?.id) {
        // User is logged in - remove from database
        for (const item of selectedItems) {
          if (item.cart_id) {
            await api.delete(`/cart/${item.cart_id}`);
          }
        }
        console.log("[useCart] Selected items removed from database cart");
      } else {
        // Guest user - update local storage
        const updatedCart = currentCart.filter((item) => !item.selected);
        setCart(updatedCart, "guest");
        console.log(
          "[useCart] Updated guest cart after removing selected items:",
          updatedCart
        );
      }

      return selectedItems;
    },
    onSuccess: () => {
      // Invalidate and refetch cart data
      queryClient.invalidateQueries(["cart", user?.id || "guest"]);
    },
    onError: (error) => {
      console.error("[useCart] Error removing selected items:", error);
    },
  });

  // Clear cart mutation
  const clearCartMutation = useMutation({
    mutationFn: async () => {
      if (user?.id) {
        // User is logged in - clear database cart
        await api.delete("/cart");
        console.log("[useCart] Database cart cleared");
      } else {
        // Guest user - clear storage
        removeCart("guest");
        console.log("[useCart] Guest cart cleared");
      }
      return [];
    },
    onSuccess: () => {
      // Update cache directly to empty array
      queryClient.setQueryData(["cart", user?.id || "guest"], []);
    },
    onError: (error) => {
      console.error("[useCart] Error clearing cart:", error);
    },
  });

  // Merge guest cart with user cart
  const mergeGuestCartMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) {
        throw new Error("Cannot merge carts: user not logged in");
      }

      const guestCart = getCart("guest");
      console.log(
        `[useCart] Merging guest cart (${
          guestCart?.length || 0
        } items) with user cart`
      );

      if (guestCart && guestCart.length > 0) {
        // Add each guest cart item to the database
        for (const item of guestCart) {
          try {
            await api.post("/cart", {
              product_id: item.id || item.product_id,
              variant_id: item.variant_id || null,
              quantity: item.quantity,
            });
          } catch (error) {
            console.error(
              "[useCart] Error adding guest cart item to database:",
              error
            );
          }
        }

        // Clear guest cart
        removeCart("guest");
        console.log("[useCart] Guest cart merged and removed");
      }

      return guestCart;
    },
    onSuccess: () => {
      // Invalidate both guest and user cart data
      queryClient.invalidateQueries(["cart", "guest"]);
      queryClient.invalidateQueries(["cart", user?.id]);
    },
    onError: (error) => {
      console.error(
        "[useCart] Error merging guest cart with user cart:",
        error
      );
    },
  });

  // Helper functions for cart calculations
  const getTotalPrice = () => {
    const cartItems = getCartData.data || [];
    return cartItems
      .filter((item) => item.selected)
      .reduce((total, item) => {
        // Use discounted price if available, otherwise use original price
        const itemPrice =
          item.discounted_price && item.discounted_price > 0
            ? parseFloat(item.discounted_price)
            : parseFloat(item.price);
        console.log(
          `[useCart] getTotalPrice - Item: ${item.name}, Original: ${item.price}, Discounted: ${item.discounted_price}, Using: ${itemPrice}`
        );
        return total + itemPrice * item.quantity;
      }, 0);
  };

  const getSelectedCount = () => {
    const cartItems = getCartData.data || [];
    return cartItems.filter((item) => item.selected).length;
  };

  const getTotalCount = () => {
    const cartItems = getCartData.data || [];
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  };

  // Toggle item selection (optimistic update)
  const toggleItemSelection = (productId, variantId = null, cartId = null) => {
    const currentCart = getCartData.data || [];
    const updatedCart = currentCart.map((item) => {
      if (cartId && item.cart_id === cartId) {
        return { ...item, selected: !item.selected };
      }
      if (variantId && item.variant_id) {
        return item.variant_id === variantId
          ? { ...item, selected: !item.selected }
          : item;
      }
      return (item.id || item.product_id) === productId
        ? { ...item, selected: !item.selected }
        : item;
    });

    // Optimistically update cache
    queryClient.setQueryData(["cart", user?.id || "guest"], updatedCart);

    // Save to storage for guest users
    if (!user?.id) {
      setCart(updatedCart, "guest");
    }
  };

  // Toggle select all (optimistic update)
  const toggleSelectAll = (selectAll) => {
    const currentCart = getCartData.data || [];
    const updatedCart = currentCart.map((item) => ({
      ...item,
      selected: selectAll,
    }));

    // Optimistically update cache
    queryClient.setQueryData(["cart", user?.id || "guest"], updatedCart);

    // Save to storage for guest users
    if (!user?.id) {
      setCart(updatedCart, "guest");
    }
  };

  return {
    // Query data and controls
    cartItems: getCartData.data || [],
    loading: getCartData.isLoading,
    error: getCartData.error,
    refetch: getCartData.refetch, // Add refetch function

    // Mutations
    addToCart: addToCartMutation.mutateAsync,
    removeFromCart: removeFromCartMutation.mutateAsync,
    updateQuantity: updateQuantityMutation.mutateAsync,
    removeSelectedItems: removeSelectedItemsMutation.mutateAsync,
    clearCart: clearCartMutation.mutateAsync,
    mergeGuestCart: mergeGuestCartMutation.mutateAsync,

    // Loading states
    addingToCart: addToCartMutation.isLoading,
    removingFromCart: removeFromCartMutation.isLoading,
    updatingQuantity: updateQuantityMutation.isLoading,
    removingSelectedItems: removeSelectedItemsMutation.isLoading,
    clearingCart: clearCartMutation.isLoading,
    mergingGuestCart: mergeGuestCartMutation.isLoading,

    // Helper functions
    getTotalPrice,
    getSelectedCount,
    getTotalCount,
    toggleItemSelection,
    toggleSelectAll,

    // Refetch function
    refetchCart: getCartData.refetch,
  };
};

// Simple cart summary hook for components that only need basic cart info (like navbar)
export const useCartSummary = () => {
  const { user } = useAuth();

  const { data: cartItems = [], isLoading } = useQuery({
    queryKey: ["cart", user?.id || "guest"],
    queryFn: async () => {
      if (user?.id) {
        try {
          const response = await api.get("/cart");
          return response.data.map((item) => ({
            cart_id: item.cart_id,
            quantity: item.quantity,
            price: parseFloat(item.price),
          }));
        } catch (error) {
          console.error(
            "[useCartSummary] Error fetching cart from database:",
            error
          );
          const savedCart = getCart("guest");
          return Array.isArray(savedCart) ? savedCart : [];
        }
      } else {
        try {
          const savedCart = getCart("guest");
          return Array.isArray(savedCart) ? savedCart : [];
        } catch (error) {
          console.error(
            "[useCartSummary] Error loading cart from storage:",
            error
          );
          return [];
        }
      }
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    cacheTime: 1000 * 60 * 15, // 15 minutes
    refetchOnMount: "stale",
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: true,
  });

  const getTotalCount = () => {
    return cartItems.reduce((total, item) => total + item.quantity, 0);
  };

  const getTotalPrice = () => {
    return cartItems.reduce((total, item) => {
      // Use discounted price if available, otherwise use original price
      const itemPrice =
        item.discount_percentage && item.discounted_price > 0
          ? parseFloat(item.discounted_price)
          : parseFloat(item.price);
      return total + itemPrice * item.quantity;
    }, 0);
  };

  return {
    totalCount: getTotalCount(),
    totalPrice: getTotalPrice(),
    itemCount: cartItems.length,
    loading: isLoading,
  };
};
