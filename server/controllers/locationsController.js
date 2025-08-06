const axios = require("axios");

// PSGC API base URL
const PSGC_BASE_URL = "https://psgc.gitlab.io/api";

// Cache for PSGC data to reduce API calls
const psgcCache = {
  regions: null,
  provinces: {},
  cities: {},
  barangays: {},
  cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours
  lastUpdated: null,
};

// Helper function to check if cache is valid
const isCacheValid = () => {
  return (
    psgcCache.lastUpdated &&
    Date.now() - psgcCache.lastUpdated < psgcCache.cacheExpiry
  );
};

// Helper function to make PSGC API calls with error handling
const makePSGCCall = async (endpoint) => {
  try {
    console.log("🔍 [SERVER] Making PSGC API call to:", endpoint);

    // Create axios instance with better configuration
    const axiosConfig = {
      timeout: 30000, // Increase timeout to 30 seconds
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      // Add these options to handle network issues
      httpAgent: new (require("http").Agent)({
        keepAlive: true,
        timeout: 30000,
        maxSockets: 10,
      }),
      httpsAgent: new (require("https").Agent)({
        keepAlive: true,
        timeout: 30000,
        maxSockets: 10,
        rejectUnauthorized: false, // Allow self-signed certificates if needed
      }),
      maxRedirects: 5,
      validateStatus: (status) => status < 500, // Accept all status codes less than 500
    };

    const response = await axios.get(
      `${PSGC_BASE_URL}${endpoint}`,
      axiosConfig
    );

    if (response.status === 404) {
      // Propagate a custom error for 404
      const err = new Error("Not found");
      err.status = 404;
      throw err;
    }

    console.log("🔍 [SERVER] PSGC API response received for:", endpoint);
    return response.data;
  } catch (error) {
    // More specific error handling
    if (error.code === "ECONNABORTED") {
      console.error(`❌ [SERVER] PSGC API timeout for ${endpoint}`);
      throw new Error("Request timeout - please try again");
    } else if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
      console.error(`❌ [SERVER] DNS resolution failed for ${endpoint}`);
      throw new Error(
        "Network connectivity issue - please check your internet connection"
      );
    } else if (
      error.code === "ECONNRESET" ||
      error.message.includes("socket hang up")
    ) {
      console.error(`❌ [SERVER] Connection reset for ${endpoint}`);
      throw new Error("Connection was reset - please try again");
    } else if (error.response && error.response.status === 404) {
      // Propagate a custom error for 404
      const err = new Error("Not found");
      err.status = 404;
      throw err;
    }

    console.error(`❌ [SERVER] PSGC API error for ${endpoint}:`, error.message);
    throw new Error(`Failed to fetch location data: ${error.message}`);
  }
};

// Handler for GET /api/locations/regions
async function getRegions(req, res) {
  try {
    console.log("🔍 [SERVER] getRegions called");

    // Return cached data if valid
    if (psgcCache.regions && isCacheValid()) {
      console.log("🔍 [SERVER] Returning cached regions data");
      return res.json(psgcCache.regions);
    }

    console.log("🔍 [SERVER] Fetching regions from PSGC API...");
    const regions = await makePSGCCall("/regions/");

    // Transform PSGC data to match expected format
    const transformedRegions = regions.map((region) => ({
      region_id: region.code,
      region_name: region.regionName || region.name,
      psgc_code: region.code,
      original_data: region,
    }));

    console.log("🔍 [SERVER] Transformed regions data:", {
      count: transformedRegions.length,
      sample: transformedRegions.slice(0, 3),
    });

    // Update cache
    psgcCache.regions = transformedRegions;
    psgcCache.lastUpdated = Date.now();

    res.json(transformedRegions);
    console.log("🔍 [SERVER] Regions sent to client successfully");
  } catch (error) {
    console.error("❌ [SERVER] Error fetching regions:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// Handler for GET /api/locations/provinces/:regionId
async function getProvinces(req, res) {
  try {
    const { regionId } = req.params;
    console.log("🔍 [SERVER] getProvinces called with regionId:", regionId);

    if (!regionId) {
      return res.status(400).json({ message: "Region ID is required" });
    }

    // Special case for NCR (130000000): Return districts instead of provinces
    if (regionId === "130000000") {
      try {
        const districts = await makePSGCCall(`/regions/${regionId}/districts/`);
        const transformedDistricts = districts.map((district) => ({
          province_id: district.code, // Use district code as province_id for NCR
          province_name: district.name, // Use district name as province name
          region_id: regionId,
          psgc_code: district.code,
          original_data: district,
          is_district: true, // Flag to identify this is actually a district
        }));
        console.log("🔍 [SERVER] Returning NCR districts as provinces");
        return res.json(transformedDistricts);
      } catch (error) {
        console.error("❌ [SERVER] Error fetching NCR districts:", error);
        return res.json([]); // Fallback to empty array if districts fetch fails
      }
    }

    // Check cache first for non-NCR regions
    if (psgcCache.provinces[regionId] && isCacheValid()) {
      console.log(
        "🔍 [SERVER] Returning cached provinces data for region:",
        regionId
      );
      return res.json(psgcCache.provinces[regionId]);
    }

    console.log(
      "🔍 [SERVER] Fetching provinces for region",
      regionId,
      "from PSGC API..."
    );
    let provinces;
    try {
      provinces = await makePSGCCall(`/regions/${regionId}/provinces/`);
    } catch (error) {
      if (error.status === 404) {
        console.log("🔍 [SERVER] No provinces found for region:", regionId);
        return res.json([]); // Return empty array if no provinces found
      }
      throw error;
    }

    // Transform PSGC data to match expected format
    const transformedProvinces = provinces.map((province) => ({
      province_id: province.code,
      province_name: province.name,
      region_id: regionId,
      psgc_code: province.code,
      original_data: province,
    }));

    console.log("🔍 [SERVER] Transformed provinces data:", {
      regionId,
      count: transformedProvinces.length,
      sample: transformedProvinces.slice(0, 3),
    });

    // Update cache
    psgcCache.provinces[regionId] = transformedProvinces;

    res.json(transformedProvinces);
    console.log("🔍 [SERVER] Provinces sent to client successfully");
  } catch (error) {
    console.error("❌ [SERVER] Error fetching provinces:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// Handler for GET /api/locations/cities/:provinceId
async function getCities(req, res) {
  try {
    const { provinceId } = req.params;
    console.log("🔍 [SERVER] getCities called with provinceId:", provinceId);

    if (!provinceId) {
      return res.status(400).json({ message: "Province ID is required" });
    }

    // Check cache first
    if (psgcCache.cities[provinceId] && isCacheValid()) {
      console.log(
        "🔍 [SERVER] Returning cached cities data for province:",
        provinceId
      );
      return res.json(psgcCache.cities[provinceId]);
    }

    console.log(
      "🔍 [SERVER] Fetching cities for province/district",
      provinceId,
      "from PSGC API..."
    );

    // Try both provinces and districts endpoints for better compatibility
    let cities;
    try {
      // First try the provinces endpoint
      cities = await makePSGCCall(
        `/provinces/${provinceId}/cities-municipalities/`
      );
    } catch (error) {
      if (error.status === 404) {
        try {
          // If provinces endpoint fails, try districts endpoint (for NCR districts)
          console.log(
            "🔍 [SERVER] Provinces endpoint failed, trying districts endpoint for:",
            provinceId
          );
          cities = await makePSGCCall(
            `/districts/${provinceId}/cities-municipalities/`
          );
        } catch (districtError) {
          if (districtError.status === 404) {
            console.log(
              "🔍 [SERVER] Both provinces and districts endpoints failed for:",
              provinceId
            );
            return res
              .status(404)
              .json({ message: "No cities found for this location" });
          }
          throw districtError;
        }
      } else {
        throw error;
      }
    }

    // Transform PSGC data to match expected format
    const transformedCities = cities.map((city) => ({
      city_id: city.code,
      city_name: city.name,
      province_id: provinceId, // Keep the original ID regardless of whether it's province or district
      psgc_code: city.code,
      original_data: city,
    }));

    console.log("🔍 [SERVER] Transformed cities data:", {
      provinceId,
      count: transformedCities.length,
      sample: transformedCities.slice(0, 3),
    });

    // Update cache
    psgcCache.cities[provinceId] = transformedCities;

    res.json(transformedCities);
    console.log("🔍 [SERVER] Cities sent to client successfully");
  } catch (error) {
    console.error("❌ [SERVER] Error fetching cities:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// Handler for GET /api/locations/barangays/:cityId
async function getBarangays(req, res) {
  try {
    const { cityId } = req.params;
    console.log("🔍 [SERVER] getBarangays called with cityId:", cityId);

    if (!cityId) {
      return res.status(400).json({ message: "City ID is required" });
    }

    // Check cache first
    if (psgcCache.barangays[cityId] && isCacheValid()) {
      console.log(
        "🔍 [SERVER] Returning cached barangays data for city:",
        cityId
      );
      return res.json(psgcCache.barangays[cityId]);
    }

    console.log(
      "🔍 [SERVER] Fetching barangays for city",
      cityId,
      "from PSGC API..."
    );
    let barangays;

    try {
      // First try the regular city/municipality endpoint
      barangays = await makePSGCCall(
        `/cities-municipalities/${cityId}/barangays/`
      );
    } catch (error) {
      if (error.status === 404) {
        try {
          // If regular endpoint fails, try the districts endpoint (for NCR)
          console.log(
            "🔍 [SERVER] City endpoint failed, trying district endpoint for:",
            cityId
          );
          barangays = await makePSGCCall(`/districts/${cityId}/barangays/`);
        } catch (districtError) {
          if (districtError.status === 404) {
            console.log(
              "🔍 [SERVER] Both city and district endpoints failed for:",
              cityId
            );
            return res.json([]); // Return empty array if no barangays found
          }
          throw districtError;
        }
      } else {
        throw error;
      }
    }

    // Transform PSGC data to match expected format
    const transformedBarangays = barangays.map((barangay) => ({
      barangay_id: barangay.code,
      barangay_name: barangay.name,
      city_id: cityId,
      psgc_code: barangay.code,
      original_data: barangay,
    }));

    console.log("🔍 [SERVER] Transformed barangays data:", {
      cityId,
      count: transformedBarangays.length,
      sample: transformedBarangays.slice(0, 3),
    });

    // Update cache
    psgcCache.barangays[cityId] = transformedBarangays;

    res.json(transformedBarangays);
    console.log("🔍 [SERVER] Barangays sent to client successfully");
  } catch (error) {
    console.error("❌ [SERVER] Error fetching barangays:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// Handler for POST /api/locations/validate-address
async function validateAddress(req, res) {
  try {
    const db = require("../config/db");
    const { region, province, city, barangay } = req.body;
    console.log("🔍 [SERVER] validateAddress called with:", {
      region,
      province,
      city,
      barangay,
    });

    // Only require province
    if (!province) {
      return res.status(400).json({
        message: "Missing required address field: province",
        required: ["province"],
      });
    }

    // Format address for NinjaVan compatibility
    const formattedAddress = {
      region: region || "",
      province: province,
      city: city || "",
      barangay: barangay || "",
      area: barangay || city || "",
      formatted_for_ninjavan: true,
    };

    // Special handling for Metro Manila addresses
    const mmAliases = [
      "ncr",
      "metro manila",
      "national capital region",
      "metropolitan manila",
    ];
    const mmCities = [
      "manila",
      "quezon city",
      "caloocan",
      "las piñas",
      "las pinas",
      "makati",
      "malabon",
      "mandaluyong",
      "marikina",
      "muntinlupa",
      "navotas",
      "parañaque",
      "paranaque",
      "pasay",
      "pasig",
      "san juan",
      "taguig",
      "valenzuela",
      "pateros",
    ];

    const isMetroManila =
      mmAliases.includes(province.toLowerCase()) ||
      mmAliases.includes(region?.toLowerCase()) ||
      (city && mmCities.includes(city.toLowerCase()));

    if (isMetroManila) {
      console.log("✅ [SERVER] Metro Manila address detected");
      return res.json({
        success: true,
        address: formattedAddress,
        serviceable: true,
        message: "Address is serviceable (Metro Manila)",
        dbResult: { status: "SERVICEABLE", region: "NCR" },
      });
    }

    // For non-Metro Manila addresses, check the database
    let serviceable = false;
    let dbResult = null;

    try {
      // First try exact match on province and barangay if both are provided
      if (barangay) {
        const [rows] = await db.query(
          `SELECT status FROM Shipping_Locations_Ninjavan 
           WHERE LOWER(barangay_name) LIKE LOWER(?) 
           AND LOWER(province_name) LIKE LOWER(?) 
           LIMIT 1`,
          [`%${barangay}%`, `%${province}%`]
        );
        dbResult = rows && rows.length > 0 ? rows[0] : null;
      }

      // If no match found or no barangay provided, check just the province
      if (!dbResult) {
        const [rows] = await db.query(
          `SELECT status FROM Shipping_Locations_Ninjavan 
           WHERE LOWER(province_name) LIKE LOWER(?) 
           LIMIT 1`,
          [`%${province}%`]
        );
        dbResult = rows && rows.length > 0 ? rows[0] : null;
      }

      if (
        dbResult &&
        dbResult.status &&
        dbResult.status.toLowerCase().includes("serviceable")
      ) {
        serviceable = true;
      }
    } catch (err) {
      console.error(
        "❌ [SERVER] Error querying Shipping_Locations_Ninjavan:",
        err
      );
    }

    console.log(
      "🔍 [SERVER] Address validated successfully:",
      formattedAddress,
      "Serviceable:",
      serviceable
    );

    res.json({
      success: true,
      address: formattedAddress,
      serviceable,
      message: serviceable
        ? "Address is serviceable"
        : "Address is not serviceable",
      dbResult,
    });
  } catch (error) {
    console.error("❌ [SERVER] Error validating address:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// Handler for POST /api/locations/clear-cache (admin only)
async function clearPSGCCache(req, res) {
  try {
    console.log("🔍 [SERVER] clearPSGCCache called");

    psgcCache.regions = null;
    psgcCache.provinces = {};
    psgcCache.cities = {};
    psgcCache.barangays = {};
    psgcCache.lastUpdated = null;

    res.json({
      success: true,
      message: "PSGC cache cleared successfully",
    });
  } catch (error) {
    console.error("❌ [SERVER] Error clearing PSGC cache:", error);
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
}

// List all provinces
async function listProvinces(req, res) {
  try {
    const provinces = await makePSGCCall("/provinces/");
    res.json(provinces);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific province
async function getProvince(req, res) {
  try {
    const { province } = req.params;
    let data;
    try {
      data = await makePSGCCall(`/provinces/${province}`);
    } catch (error) {
      if (error.status === 404) {
        return res.status(404).json({ message: "Province not found" });
      }
      throw error;
    }
    res.json(data);
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({ message: "Province not found" });
    }
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// List all cities
async function listCities(req, res) {
  try {
    const cities = await makePSGCCall("/cities/");
    res.json(cities);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific city
async function getCity(req, res) {
  try {
    const { city } = req.params;
    const data = await makePSGCCall(`/cities/${city}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// List all municipalities
async function listMunicipalities(req, res) {
  try {
    const municipalities = await makePSGCCall("/municipalities/");
    res.json(municipalities);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific municipality
async function getMunicipality(req, res) {
  try {
    const { municipality } = req.params;
    const data = await makePSGCCall(`/municipalities/${municipality}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// List all barangays
async function listBarangays(req, res) {
  try {
    const barangays = await makePSGCCall("/barangays/");
    res.json(barangays);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific barangay
async function getBarangay(req, res) {
  try {
    const { barangay } = req.params;
    const data = await makePSGCCall(`/barangays/${barangay}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// List all districts
async function listDistricts(req, res) {
  try {
    const districts = await makePSGCCall("/districts/");
    res.json(districts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get districts by region (e.g., for NCR)
async function getDistrictsByRegion(req, res) {
  try {
    const { regionId } = req.params;
    if (!regionId) {
      return res.status(400).json({ message: "Region ID is required" });
    }
    let districts;
    try {
      districts = await makePSGCCall(`/regions/${regionId}/districts/`);
    } catch (error) {
      if (error.status === 404) {
        return res
          .status(404)
          .json({ message: "Region or districts not found" });
      }
      // Handle socket hang up or PSGC API errors
      return res
        .status(500)
        .json({ message: "Failed to fetch districts", error: error.message });
    }
    // Transform PSGC data to match expected format
    const transformedDistricts = districts.map((district) => ({
      district_id: district.code,
      district_name: district.name,
      region_id: regionId,
      psgc_code: district.code,
      original_data: district,
    }));
    res.json(transformedDistricts);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific district
async function getDistrict(req, res) {
  try {
    const { district } = req.params;
    const data = await makePSGCCall(`/districts/${district}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// List all sub-municipalities
async function listSubMunicipalities(req, res) {
  try {
    const subMunicipalities = await makePSGCCall("/sub-municipalities/");
    res.json(subMunicipalities);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific sub-municipality
async function getSubMunicipality(req, res) {
  try {
    const { subMunicipality } = req.params;
    const data = await makePSGCCall(`/sub-municipalities/${subMunicipality}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Get specific region
async function getRegion(req, res) {
  try {
    const { region } = req.params;
    const data = await makePSGCCall(`/regions/${region}`);
    res.json(data);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
}

// Export all handlers
module.exports = {
  getRegions,
  getRegion,
  getProvinces,
  getProvincesWithinRegion: getProvinces, // Alias for the same function
  listProvinces,
  getProvince,
  getCities,
  getCitiesWithinProvince: getCities, // Alias for the same function
  listCities,
  getCity,
  getBarangays,
  getBarangaysWithinCity: getBarangays, // Alias for the same function
  listMunicipalities,
  getMunicipality,
  listBarangays,
  getBarangay,
  listDistricts,
  getDistrictsByRegion,
  getDistrict,
  listSubMunicipalities,
  getSubMunicipality,
  validateAddress,
  clearPSGCCache,
};
