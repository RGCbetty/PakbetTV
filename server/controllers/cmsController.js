const db = require("../config/db");

// Handler for GET /api/cms/blogs
async function getBlogs(req, res) {
  try {
    const [results] = await db.query(
      `SELECT DISTINCT 
        b.blogID, 
        b.title, 
        b.category, 
        b.tags, 
        b.content, 
        b.publish_date, 
        b.status, 
        b.created_at, 
        b.updated_at, 
        b.cover_image 
      FROM blogs b
      WHERE b.status = 'published'
      GROUP BY b.blogID
      ORDER BY b.publish_date DESC`,
      []
    );

    const blogs = results.map((blog) => {
      if (blog.cover_image) {
        blog.cover_image = `data:image/jpeg;base64,${blog.cover_image.toString(
          "base64"
        )}`;
      }
      return blog;
    });

    res.json(blogs);
  } catch (err) {
    console.error("Error fetching blogs:", err);
    res.status(500).json({ error: err.message });
  }
}

// Handler for GET /api/cms/blogs/search
async function searchBlogs(req, res) {
  try {
    const searchQuery = req.query.query;
    console.log("Blog search query received:", searchQuery);
    if (!searchQuery) {
      return res.json([]);
    }
    const searchTerm = `%${searchQuery}%`;
    const [results] = await db.query(
      `SELECT blogID, title, category, tags, content, publish_date, status, created_at, updated_at, cover_image 
       FROM blogs 
       WHERE (LOWER(title) LIKE LOWER(?) 
          OR LOWER(content) LIKE LOWER(?) 
          OR LOWER(category) LIKE LOWER(?) 
          OR LOWER(tags) LIKE LOWER(?))
       AND status = 'published'
       ORDER BY 
         CASE 
           WHEN LOWER(title) LIKE LOWER(?) THEN 1
           WHEN LOWER(category) LIKE LOWER(?) THEN 2
           ELSE 3
         END,
         publish_date DESC 
       LIMIT 5`,
      [searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm]
    );
    console.log(`Found ${results.length} blog results`);
    const blogs = results.map((blog) => {
      try {
        if (blog.cover_image) {
          if (Buffer.isBuffer(blog.cover_image)) {
            blog.cover_image = `data:image/jpeg;base64,${blog.cover_image.toString(
              "base64"
            )}`;
          } else if (typeof blog.cover_image === "string") {
            blog.cover_image = blog.cover_image.startsWith("/")
              ? blog.cover_image
              : `/${blog.cover_image}`;
          }
        }
        return {
          ...blog,
          tags: blog.tags ? blog.tags.split(",").map((tag) => tag.trim()) : [],
        };
      } catch (err) {
        console.error(`Error processing blog ${blog.blogID}:`, err.message);
        return {
          ...blog,
          cover_image: null,
          tags: [],
        };
      }
    });
    res.json(blogs);
  } catch (err) {
    console.error("Error searching blogs:", err.message);
    res.status(500).json({
      error: "Server error during blog search",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

// Handler for GET /api/cms/product-guides/search
async function searchProductGuides(req, res) {
  try {
    const searchQuery = req.query.query;
    console.log("Product guides search query received:", searchQuery);
    if (!searchQuery) {
      return res.json([]);
    }
    const productGuides = [
      {
        id: "bracelet",
        title: "Bracelet Guide",
        description:
          "Complete guide for feng shui bracelets and their benefits",
        filename: "Bracelet.pdf",
        category: "Accessories",
        previewImage: "/PDF-Previews/Bracelet.png",
        keywords: "bracelet, feng shui, jewelry, accessories, wristband",
      },
      {
        id: "coins",
        title: "Coins Guide",
        description: "Traditional feng shui coins and their proper usage",
        filename: "Coins.pdf",
        category: "Traditional Items",
        previewImage: "/PDF-Previews/Coins.png",
        keywords: "coins, feng shui, traditional, money, prosperity",
      },
      {
        id: "crystal-bottles",
        title: "Crystal Bottles Guide",
        description: "Crystal bottles for energy enhancement and protection",
        filename: "CrystalBottles.pdf",
        category: "Crystals",
        previewImage: "/PDF-Previews/CrystalBottles.png",
        keywords: "crystal, bottles, energy, protection, healing",
      },
      {
        id: "fashion",
        title: "Fashion Guide",
        description: "Feng shui fashion items and styling tips",
        filename: "Fashion.pdf",
        category: "Fashion",
        previewImage: "/PDF-Previews/Fashion.png",
        keywords: "fashion, feng shui, clothing, style, jewelry",
      },
      {
        id: "fountain",
        title: "Fountain Guide",
        description: "Water fountains for wealth and prosperity",
        filename: "Fountain.pdf",
        category: "Water Elements",
        previewImage: "/PDF-Previews/Fountains.png",
        keywords: "fountain, water, wealth, prosperity, flow",
      },
      {
        id: "home-decor",
        title: "Home Decor Guide",
        description: "Feng shui home decoration essentials",
        filename: "HomeDecor.pdf",
        category: "Home & Living",
        previewImage: "/PDF-Previews/HomeDecor.png",
        keywords: "home, decor, feng shui, decoration, interior",
      },
      {
        id: "incense",
        title: "Incense Guide",
        description: "Incense types and their spiritual benefits",
        filename: "Incense.pdf",
        category: "Spiritual Items",
        previewImage: "/PDF-Previews/Incense.png",
        keywords: "incense, spiritual, aromatherapy, cleansing, meditation",
      },
      {
        id: "keychains",
        title: "Keychains Guide",
        description: "Protective and lucky feng shui keychains",
        filename: "Keychains.pdf",
        category: "Accessories",
        previewImage: "/PDF-Previews/Keychains.png",
        keywords: "keychain, feng shui, protection, luck, accessories",
      },
      {
        id: "medallions",
        title: "Medallions Guide",
        description: "Sacred medallions and amulets for protection",
        filename: "Medallions.pdf",
        category: "Protection Items",
        previewImage: "/PDF-Previews/Medallions.png",
        keywords: "medallions, amulets, protection, sacred, spiritual",
      },
      {
        id: "prosperity-bowl",
        title: "Prosperity Bowl Guide",
        description: "Wealth bowls for attracting abundance",
        filename: "ProsperityBowl.pdf",
        category: "Wealth Items",
        previewImage: "/PDF-Previews/ProsperityBowl.png",
        keywords: "prosperity, bowl, wealth, abundance, money",
      },
      {
        id: "smudge-kit",
        title: "Smudge Kit Guide",
        description: "Cleansing and purification smudge kits",
        filename: "SmudgeKit.pdf",
        category: "Cleansing Items",
        previewImage: "/PDF-Previews/SmudgeKit.png",
        keywords: "smudge, cleansing, purification, sage, spiritual",
      },
      {
        id: "talisman-cards",
        title: "Talisman Cards Guide",
        description: "Protective talisman cards and their meanings",
        filename: "TalismanCards.pdf",
        category: "Protection Items",
        previewImage: "/PDF-Previews/TalismanCards.png",
        keywords: "talisman, cards, protection, meanings, spiritual",
      },
      {
        id: "wallet",
        title: "Wallet Guide",
        description: "Feng shui wallets for wealth attraction",
        filename: "Wallet.pdf",
        category: "Accessories",
        previewImage: "/PDF-Previews/Wallet.png",
        keywords: "wallet, feng shui, wealth, money, prosperity",
      },
      {
        id: "wind-chimes",
        title: "Wind Chimes Guide",
        description: "Feng shui wind chimes and their placement",
        filename: "WindChimes.pdf",
        category: "Sound Elements",
        previewImage: "/PDF-Previews/WindChimes.png",
        keywords: "wind chimes, feng shui, sound, placement, harmony",
      },
      {
        id: "wishing-paper",
        title: "Wishing Paper Guide",
        description: "Manifestation papers and ritual instructions",
        filename: "WishingPaper.pdf",
        category: "Spiritual Items",
        previewImage: "/PDF-Previews/WishingPaper.png",
        keywords: "wishing paper, manifestation, ritual, spiritual, intention",
      },
    ];
    const searchTerm = searchQuery.toLowerCase();
    const scoredGuides = productGuides
      .map((guide) => {
        let score = 0;
        let matchedIn = [];
        if (guide.title.toLowerCase().includes(searchTerm)) {
          score += 10;
          matchedIn.push("title");
        }
        if (guide.category.toLowerCase() === searchTerm) {
          score += 8;
          matchedIn.push("category");
        }
        if (guide.category.toLowerCase().includes(searchTerm)) {
          score += 6;
          matchedIn.push("category");
        }
        if (guide.description.toLowerCase().includes(searchTerm)) {
          score += 4;
          matchedIn.push("description");
        }
        if (guide.keywords.toLowerCase().includes(searchTerm)) {
          score += 2;
          matchedIn.push("keywords");
        }
        return { ...guide, score, matchedIn };
      })
      .filter((guide) => guide.score > 0);
    const sortedGuides = scoredGuides.sort((a, b) => b.score - a.score);
    console.log(`Found ${sortedGuides.length} product guide results`);
    const results = sortedGuides.slice(0, 5).map((guide) => ({
      id: guide.id,
      title: guide.title,
      description: guide.description,
      filename: guide.filename,
      category: guide.category,
      previewImage: guide.previewImage,
      matchedIn: guide.matchedIn,
      score: guide.score,
    }));
    res.json(results);
  } catch (err) {
    console.error("Error searching product guides:", err.message);
    res.status(500).json({
      error: "Server error during product guides search",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

// Handler for GET /api/cms/blogs/:blogID
async function getBlogById(req, res) {
  try {
    const blogID = req.params.blogID;
    const [results] = await db.query("SELECT * FROM blogs WHERE blogID = ?", [
      blogID,
    ]);
    if (results.length === 0) {
      return res.status(404).json({ error: "Blog not found" });
    }
    const blog = results[0];
    if (blog.cover_image) {
      blog.cover_image = `data:image/jpeg;base64,${blog.cover_image.toString(
        "base64"
      )}`;
    }
    res.json(blog);
  } catch (err) {
    console.error("Error fetching blog by ID:", err);
    res.status(500).json({ error: "Database error: " + err.message });
  }
}

// Handler for GET /api/cms/faqs
async function getFaqs(req, res) {
  try {
    const [results] = await db.query(
      "SELECT faqID, question, answer, publish_date, status, created_at, updated_at FROM faqs",
      []
    );
    res.json(results);
  } catch (err) {
    console.error("Error fetching FAQs:", err);
    res.status(500).json({ error: err.message });
  }
}

// Handler for GET /api/cms/zodiacs/:zodiacID
// Handler for GET /api/cms/zodiacs/:zodiacID
async function getZodiacById(req, res) {
  try {
    const zodiacID = req.params.zodiacID.toLowerCase();

    const [results] = await db.query(
      `SELECT 
         p.zodiacID, p.overview, p.career, p.health, p.love, p.wealth, p.status,
         h.daily, h.weekly, h.monthly, h.is_updated, h.is_read
       FROM prosper_guides p
       LEFT JOIN horoscope_readings h ON LOWER(p.zodiacID) = LOWER(h.sign)
       WHERE LOWER(p.zodiacID) = ?
         AND LOWER(p.zodiacID) IN ('rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig')
      `,
      [zodiacID]
    );

    if (results.length === 0) {
      return res.status(404).json({ error: "Zodiac not found" });
    }

    await db.query(
      `UPDATE horoscope_readings SET is_read = TRUE WHERE LOWER(sign) = ?`,
      [zodiacID]
    );

    res.json(results[0]);
  } catch (err) {
    console.error("Error fetching zodiac:", err);
    res.status(500).json({ error: "Database error: " + err.message });
  }
}

// Handler for GET /api/cms/zodiacs (search)
async function searchZodiacs(req, res) {
  try {
    const searchQuery = req.query.search;
    console.log("Zodiac search query received:", searchQuery);
    if (!searchQuery) {
      return res.json([]);
    }
    const searchTerm = `%${searchQuery.toLowerCase()}%`;
    const [results] = await db.query(
      `SELECT zodiacID, overview, career, health, love, wealth, status
       FROM prosper_guides 
       WHERE zodiacID IN ('Rat', 'Ox', 'Tiger', 'Rabbit', 'Dragon', 'Snake', 'Horse', 'Goat', 'Monkey', 'Rooster', 'Dog', 'Pig')
         AND status = 'published'
         AND (LOWER(zodiacID) LIKE ? 
           OR LOWER(overview) LIKE ? 
           OR LOWER(career) LIKE ? 
           OR LOWER(health) LIKE ? 
           OR LOWER(love) LIKE ? 
           OR LOWER(wealth) LIKE ?)
       ORDER BY 
         CASE 
           WHEN LOWER(zodiacID) LIKE ? THEN 1
           WHEN LOWER(overview) LIKE ? THEN 2
           ELSE 3
         END`,
      [
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
        searchTerm,
      ]
    );
    console.log(`Found ${results.length} zodiac results`);
    res.json(results);
  } catch (err) {
    console.error("Error searching zodiacs:", err);
    res.status(500).json({
      error: "Server error during zodiac search",
      details: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
}

module.exports = {
  getBlogs,
  searchBlogs,
  searchProductGuides,
  getBlogById,
  getFaqs,
  getZodiacById,
  searchZodiacs,
};
