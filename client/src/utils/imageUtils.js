import API_BASE_URL from "../config";

// Use a reliable placeholder image service or existing image
const PLACEHOLDER_IMAGE = "/ImageFallBack.png"; // Using the same fallback image consistently

export const getFullImageUrl = (url) => {
  if (!url) {
    return PLACEHOLDER_IMAGE;
  }

  // Debug logging
  console.log("Processing image URL:", { url, type: typeof url });

  // Handle case where url is an object (longblob from database)
  if (typeof url === "object") {
    console.log("Processing BLOB object:", {
      hasData: !!url.data,
      type: url.type,
    });

    if (url.data) {
      // Handle Uint8Array or Array data
      if (url.data instanceof Uint8Array || Array.isArray(url.data)) {
        try {
          // Convert to Uint8Array if it's a regular array
          const uint8Array =
            url.data instanceof Uint8Array
              ? url.data
              : new Uint8Array(url.data);
          console.log("Converting BLOB to base64, size:", uint8Array.length);

          // Use a more efficient method for base64 conversion
          const chunks = [];
          const chunkSize = 8192;

          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.slice(i, i + chunkSize);
            chunks.push(String.fromCharCode.apply(null, chunk));
          }

          const binary = chunks.join("");
          const base64 = btoa(binary);
          const dataUrl = `data:${url.type || "image/jpeg"};base64,${base64}`;

          console.log("Successfully converted BLOB to base64 URL");
          return dataUrl;
        } catch (error) {
          console.error("Error converting image data to base64:", error);
          return PLACEHOLDER_IMAGE;
        }
      }

      // Handle base64 string data
      if (typeof url.data === "string") {
        console.log("Processing base64 string data");
        const dataUrl = `data:${url.type || "image/jpeg"};base64,${url.data}`;
        return dataUrl;
      }
    }

    // If the object itself is a Uint8Array
    if (url instanceof Uint8Array) {
      try {
        console.log("Processing direct Uint8Array, size:", url.length);
        const chunks = [];
        const chunkSize = 8192;

        for (let i = 0; i < url.length; i += chunkSize) {
          const chunk = url.slice(i, i + chunkSize);
          chunks.push(String.fromCharCode.apply(null, chunk));
        }

        const binary = chunks.join("");
        const base64 = btoa(binary);
        const dataUrl = `data:image/jpeg;base64,${base64}`;

        console.log("Successfully converted Uint8Array to base64 URL");
        return dataUrl;
      } catch (error) {
        console.error("Error converting Uint8Array to base64:", error);
        return PLACEHOLDER_IMAGE;
      }
    }

    console.log("Unknown object format, using placeholder");
    return PLACEHOLDER_IMAGE;
  }

  // Handle string URLs
  if (typeof url === "string") {
    console.log("Processing string URL:", url.substring(0, 50) + "...");

    // Handle base64 encoded images
    if (url.startsWith("data:")) {
      console.log("Already a data URL");
      return url; // Already a full data URL
    }

    // Handle absolute URLs
    if (url.startsWith("http")) {
      console.log("Using absolute URL");
      return url;
    }

    // Handle uploads paths
    if (url.startsWith("/uploads/")) {
      const fullUrl = `${API_BASE_URL}${url}`;
      console.log("Using uploads path:", fullUrl);
      return fullUrl;
    }

    // Handle other relative paths
    if (url.startsWith("/")) {
      const fullUrl = `${API_BASE_URL}${url}`;
      console.log("Using relative path:", fullUrl);
      return fullUrl;
    }

    // Any other format
    const fullUrl = `${API_BASE_URL}/uploads/${url}`;
    console.log("Using default uploads path:", fullUrl);
    return fullUrl;
  }

  console.log("Unknown URL format, using placeholder");
  return PLACEHOLDER_IMAGE;
};
