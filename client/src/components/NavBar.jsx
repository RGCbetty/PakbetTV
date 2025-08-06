import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCartSummary } from '../hooks/useCart';
import API_BASE_URL from '../config';
import { getFullImageUrl } from '../utils/imageUtils';
import './NavBar.css';

const NavBar = () => {
  
  const [isToolsOpen, setIsToolsOpen] = useState(false);
  const [isBlogsOpen, setIsBlogsOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState({ products: [], blogs: [], zodiacs: [], guides: [] });
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);
  const { user, logout, loggingOut } = useAuth();
  const { totalCount: getTotalCount } = useCartSummary();
  const dropdownRef = useRef(null);
  const searchRef = useRef(null);
  const mobileMenuRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const isShopPage = location.pathname === '/shop';

  const toggleBlogsMenu = () => {
    setIsBlogsOpen(prev => {
      if (!prev) {
        // opening Blogs, close Tools
        setIsToolsOpen(false);
      }
      return !prev;
    });
  };

  const toggleToolsMenu = () => {
    setIsToolsOpen(prev => {
      if (!prev) {
        // opening Tools, close Blogs
        setIsBlogsOpen(false);
      }
      return !prev;
    });
  };


  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false);
      }
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchDropdown(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target)) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('scroll', handleScroll);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults({ products: [], blogs: [], zodiacs: [], guides: [] });
      setShowSearchDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowSearchDropdown(true);
    setError(null);

    try {
      // Create promises for all searches
      const searchPromises = [
        // Fetch products
        fetch(`${API_BASE_URL}/api/products/search?query=${encodeURIComponent(query)}`)
          .then(response => {
            if (!response.ok) throw new Error('Failed to fetch products');
            return response.json();
          })
          .catch(error => {
            console.error('Products search error:', error);
            return [];
          }),

        // Fetch blogs
        fetch(`${API_BASE_URL}/api/cms/blogs/search?query=${encodeURIComponent(query)}`)
          .then(response => {
            if (!response.ok) throw new Error('Failed to fetch blogs');
            return response.json();
          })
          .catch(error => {
            console.error('Blogs search error:', error);
            return [];
          }),

        // Fetch zodiacs
        fetch(`${API_BASE_URL}/api/cms/zodiacs?search=${encodeURIComponent(query)}`)
          .then(response => {
            if (!response.ok) throw new Error('Failed to fetch zodiacs');
            return response.json();
          })
          .catch(error => {
            console.error('Zodiacs search error:', error);
            return [];
          }),

        // Fetch product guides
        fetch(`${API_BASE_URL}/api/cms/product-guides/search?query=${encodeURIComponent(query)}`)
          .then(response => {
            if (!response.ok) throw new Error('Failed to fetch product guides');
            return response.json();
          })
          .catch(error => {
            console.error('Product guides search error:', error);
            return [];
          })
      ];

      // Execute all searches in parallel
      const [productsData, blogsData, zodiacsData, guidesData] = await Promise.all(searchPromises);

      setSearchResults({
        products: productsData || [],
        blogs: blogsData || [],
        zodiacs: zodiacsData || [],
        guides: guidesData || []
      });
    } catch (error) {
      console.error('Search error:', error);
      setError(error.message);
      setSearchResults({ products: [], blogs: [], zodiacs: [], guides: [] });
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const debounceTimeout = setTimeout(() => {
      handleSearch(searchQuery);
    }, 300);

    return () => clearTimeout(debounceTimeout);
  }, [searchQuery]);

  const toggleDropdown = () => {
    setDropdownOpen(!dropdownOpen);
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const handleLogout = () => {
    setDropdownOpen(false); 
    setMobileMenuOpen(false);
    logout(); 
  };

  const handleMobileNavClick = () => {
    setMobileMenuOpen(false);
  };

  const isHomePage = location.pathname === '/';
  const navClassName = `navbar-navbar ${
    !isHomePage || scrolled ? 'red' : 'transparent' 
  } ${scrolled ? 'scrolled' : ''}`;

  const handleSearchResultClick = (item, type) => {
    setSearchQuery('');
    setShowSearchDropdown(false);
    
    switch (type) {
      case 'product':
        navigate(`/product/${item.product_id}`);
        break;
      case 'blog':
        navigate(`/blog/${item.blogID}`);
        break;
      case 'zodiac':
        navigate(`/prosper-guide/${item.zodiacID.toLowerCase()}`);
        break;
      case 'guide':
        navigate('/product-guide');
        break;
      default:
        break;
    }
  };

  const renderSearchResults = () => {
    if (!showSearchDropdown) return null;
    
    return (
      
      <div className="search-dropdown">
        {searchResults.zodiacs.length > 0 && (
          <div className="search-section">
            <div className="search-section-header">Zodiac Guides</div>
            {searchResults.zodiacs.map((zodiac) => (
              <div
                key={zodiac.zodiacID}
                className="search-result-item"
                onClick={() => handleSearchResultClick(zodiac, 'zodiac')}
              >
                <div className="search-result-content">
                  <div className="search-result-title">{zodiac.zodiacID}</div>
                  <div className="search-result-subtitle">Prosper Guide</div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {searchResults.guides.length > 0 && (
          <div className="search-section">
            <div className="search-section-header">Product Guides</div>
            {searchResults.guides.map((guide) => (
              <div
                key={guide.id}
                className="search-result-item"
                onClick={() => handleSearchResultClick(guide, 'guide')}
              >
                {guide.previewImage && (
                  <div className="search-result-image">
                    <img 
                      src={getFullImageUrl(guide.previewImage)} 
                      alt={guide.title}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/placeholder-guide.jpg';
                      }}
                    />
                  </div>
                )}
                <div className="search-result-content">
                  <div className="search-result-title">{guide.title}</div>
                  <div className="search-result-subtitle">{guide.category}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchResults.products.length > 0 && (
          <div className="search-section">
            <div className="search-section-header">Products</div>
            {searchResults.products.map((product) => (
              <div
                key={product.product_id}
                className="search-result-item"
                onClick={() => handleSearchResultClick(product, 'product')}
              >
                {product.image && (
                  <div className="search-result-image">
                    <img 
                      src={getFullImageUrl(product.image)} 
                      alt={product.name}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/placeholder-product.jpg';
                      }}
                    />
                  </div>
                )}
                <div className="search-result-content">
                  <div className="search-result-title">{product.name}</div>
                  <div className="search-result-subtitle">₱{product.price}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {searchResults.blogs.length > 0 && (
          <div className="search-section">
            <div className="search-section-header">Blog Posts</div>
            {searchResults.blogs.map((blog) => (
              <div
                key={blog.blogID}
                className="search-result-item"
                onClick={() => handleSearchResultClick(blog, 'blog')}
              >
                {blog.cover_image && (
                  <div className="search-result-image">
                    <img 
                      src={getFullImageUrl(blog.cover_image)} 
                      alt={blog.title}
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '/placeholder-blog.jpg';
                      }}
                    />
                  </div>
                )}
                <div className="search-result-content">
                  <div className="search-result-title">{blog.title}</div>
                  <div className="search-result-subtitle">{blog.category}</div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {isSearching && (
          <div className="search-loading">
            Searching...
          </div>
        )}
        
        {!isSearching && searchResults.products.length === 0 && 
         searchResults.blogs.length === 0 && 
         searchResults.zodiacs.length === 0 && 
         searchResults.guides.length === 0 && (
          <div className="search-no-results">
            No results found for "{searchQuery}"
          </div>
        )}
      </div>
    );
  };

  return (
    <>

    <nav className={navClassName} style={{ position: "relative", overflow: "hidden" }}>                    {/* Background video */}
      <video
        id="video2"
        className="navbar-video-bg"
        src="/HomeHeroVideo.mp4"
        autoPlay
        muted
        loop
        playsInline
      />
      <div className="gradient-overlay"></div>

        {/* Second Row - Logo, Search, Actions */}
        <div className="navbar-main-row">
          <div className="navbar-main-container">
            {/* Mobile Menu Toggle */}
            <button 
              className="mobile-menu-toggle"
              onClick={toggleMobileMenu}
              aria-label="Toggle mobile menu"
            >
              <span className={`hamburger-line ${mobileMenuOpen ? 'active' : ''}`}></span>
              <span className={`hamburger-line ${mobileMenuOpen ? 'active' : ''}`}></span>
              <span className={`hamburger-line ${mobileMenuOpen ? 'active' : ''}`}></span>
            </button>

            {/* Logo */}
<table className="logo-table">
  <tbody>
    <tr>
      <td className="logo-img-cell">
        <img src="/Logo.png" alt="Logo" className="logo-img" />
      </td>
      <td className="logo-text-cell">
        <h3>MICHAEL DE MESA</h3>
        <p>BAZI & FENG SHUI CONSULTANCY</p>
      </td>
    </tr>
  </tbody>
</table>


            {/* Desktop Search */}
            <div className="navbar-search-container desktop-search" ref={searchRef}>
              <div className="navbar-search-bar">
                <input
                  type="text"
                  placeholder="Search for products, blogs, guides, and zodiac signs..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => {
                    if (searchQuery.trim()) {
                      setShowSearchDropdown(true);
                    }
                  }}
                />  <button className="search-button">Search</button>
              </div>
              {renderSearchResults()}
            </div>

            {/* Actions */}
            <div className="navbar-navbar-actions">
              <div className="navbar-navbar-buttons">
                {/* Desktop Auth/Profile */}
                {user ? (
                  <div className="navbar-user-menu desktop-auth" ref={dropdownRef}>
                    <button className="navbar-profile-button" onClick={toggleDropdown} disabled={loggingOut}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                        <circle cx="12" cy="7" r="4"></circle>
                      </svg>
                      <span>{user.firstName}  {user.lastName}</span>
                      <svg className="navbar-dropdown-arrow" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                    {dropdownOpen && (
                      <div className="navbar-dropdown-menu">
                        <Link to="/account" className="navbar-dropdown-item" onClick={() => setDropdownOpen(false)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                            <circle cx="12" cy="7" r="4"></circle>
                          </svg>
                          <span>My Account</span>
                        </Link>
                        <Link to="/purchases" className="navbar-dropdown-item" onClick={() => setDropdownOpen(false)}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <path d="M16 10a4 4 0 0 1-8 0"></path>
                          </svg>
                          <span>My Purchase</span>
                        </Link>
                        <button onClick={handleLogout} className="navbar-dropdown-item navbar-logout-item" disabled={loggingOut}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                            <polyline points="16 17 21 12 16 7"></polyline>
                            <line x1="21" y1="12" x2="9" y2="12"></line>
                          </svg>
                          <span>Logout</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="navbar-auth-buttons desktop-auth">
                    <Link to="/login" className="navbar-login-button">LOGIN</Link>
                    <Link to="/signup" className="navbar-signup-button">SIGN UP</Link>
                  </div>
                )}
                
                {/* Cart Button */}
                <button 
                  className="navbar-cart-button"
                  disabled={loggingOut}
                  onClick={() => navigate('/cart')}
                >
                  <span className="cart-text">({getTotalCount})</span>
                  <span className="cart-count-mobile">({getTotalCount})</span>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="navbar-cart-icon">
                    <circle cx="9" cy="21" r="1"></circle>
                    <circle cx="20" cy="21" r="1"></circle>
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Third Row - Navigation Links */}
        <div className="navbar-nav-row">
          <div className="navbar-nav-container">
            <ul className="navbar-navbar-menu">
              <li className="navbar-navbar-item">
                <Link to="/" className="navbar-navbar-link">Home</Link>
              </li>
              <li className="navbar-navbar-item">
                <Link to="/shop" className="navbar-navbar-link">Shop</Link>
              </li>
              <li className="navbar-navbar-item">
                <Link to="/consultation" className="navbar-navbar-link">Consultation</Link>
              </li>
              <li className="navbar-navbar-item">
                <Link to="/horoscope" className="navbar-navbar-link">Horoscope</Link>
              </li>
              <li className="navbar-navbar-item navbar-dropdown-wrapper">
                <button type="button" className="navbar-navbar-link" onClick={toggleBlogsMenu}>Blogs</button>
                <div className={`navbar-submenu ${isBlogsOpen ? 'open' : ''}`}>

                    <Link to="/blog" className="navbar-submenu-link">Dream Meaning</Link>
                    <Link to="/blog" className="navbar-submenu-link">Face Reading</Link>
                    <Link to="/blog" className="navbar-submenu-link">Feng Shui</Link>
                    <Link to="/blog" className="navbar-submenu-link">Palmistry</Link>
                  </div>
              </li>

              
              <li className="navbar-navbar-item navbar-dropdown-wrapper">
                <button type="button" className="navbar-navbar-link" onClick={toggleToolsMenu}>Free Tools</button>
                  <div className={`navbar-submenu ${isToolsOpen ? 'open' : ''}`}>

                    <Link to="/bazi-calculator" className="navbar-submenu-link">BaZi Calculator</Link>
                    <Link to="/product-guide" className="navbar-submenu-link">Product Guide</Link>
                  </div>
              </li>

              <li className="navbar-navbar-item">
                <Link to="/contact" className="navbar-navbar-link">Contact Us</Link>
              </li>
            </ul>

            {/* Phone Number */}
            <div className="navbar-phone-info">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
                  <Link to="/contact" className="navbar-navbar-link">0981-194-9999</Link>
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileMenuOpen && (
        <div 
          className="mobile-menu-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Sidebar */}
      <div className={`mobile-menu-sidebar ${mobileMenuOpen ? 'open' : ''}`} ref={mobileMenuRef}>
        <div className="mobile-menu-header">
          <div className="mobile-menu-logo">
            <h3>MICHAEL DE MESA</h3>
            <p>BAZI & FENG SHUI CONSULTANCY</p>
          </div>
          <button 
            className="mobile-menu-close"
            onClick={() => setMobileMenuOpen(false)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Mobile Search */}
        <div className="mobile-search-container">
          <div className="mobile-search-bar">
            <input
              type="text"
              placeholder="Search for products, blogs, guides, and zodiac signs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Mobile Navigation Links */}
        <div className="mobile-menu-nav">
          <Link to="/" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9,22 9,12 15,12 15,22"></polyline>
            </svg>
            <span>Home</span>
          </Link>
          <Link to="/shop" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <path d="M16 10a4 4 0 0 1-8 0"></path>
            </svg>
            <span>Shop</span>
          </Link>
          <Link to="/consultation" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14,2 14,8 20,8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10,9 9,9 8,9"></polyline>
            </svg>
            <span>Consultation</span>
          </Link>
          <Link to="/horoscope" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
            <span>Horoscope</span>
          </Link>
          <Link to="/blog" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14,2 14,8 20,8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
              <polyline points="10,9 9,9 8,9"></polyline>
            </svg>
            <span>Blogs</span>
          </Link>
          <Link to="/blog" className="mobile-nav-link" onClick={handleMobileNavClick} style={{paddingLeft: '40px', fontSize: '14px'}}>
            <span>Dream Meaning</span>
          </Link>
          <Link to="/blog" className="mobile-nav-link" onClick={handleMobileNavClick} style={{paddingLeft: '40px', fontSize: '14px'}}>
            <span>Face Reading</span>
          </Link>
          <Link to="/blog" className="mobile-nav-link" onClick={handleMobileNavClick} style={{paddingLeft: '40px', fontSize: '14px'}}>
            <span>Feng Shui</span>
          </Link>
          <Link to="/blog" className="mobile-nav-link" onClick={handleMobileNavClick} style={{paddingLeft: '40px', fontSize: '14px'}}>
            <span>Palmistry</span>
          </Link>
          <Link to="/bazi-calculator" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
            <span>BaZi Calculator</span>
          </Link>
          <Link to="/product-guide" className="mobile-nav-link" onClick={handleMobileNavClick} style={{paddingLeft: '40px', fontSize: '14px'}}>
            <span>Product Guide</span>
          </Link>
          <Link to="/contact" className="mobile-nav-link" onClick={handleMobileNavClick}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
              <polyline points="22,6 12,13 2,6"></polyline>
            </svg>
            <span>Contact Us</span>
          </Link>

          {/* Mobile Phone Section */}
          <div className="mobile-phone-section">
            <div className="mobile-phone-info">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              <span>Call Us: 0981-194-9999</span>
            </div>
          </div>
        </div>

        {/* Mobile Auth Section */}
        <div className="mobile-auth-section">
          {user ? (
            <div className="mobile-user-info">
              <div className="mobile-user-details">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <div className="mobile-user-text">
                  <span className="mobile-user-name">{user.firstName} {user.lastName}</span>
                  <span className="mobile-user-email">{user.email}</span>
                </div>
              </div>
              <Link to="/account" className="mobile-nav-link" onClick={handleMobileNavClick}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>My Account</span>
              </Link>
              <Link to="/purchases" className="mobile-nav-link" onClick={handleMobileNavClick}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <path d="M16 10a4 4 0 0 1-8 0"></path>
                </svg>
                <span>My Purchases</span>
              </Link>
              <button onClick={handleLogout} className="mobile-nav-link mobile-logout" disabled={loggingOut}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                <span>Logout</span>
              </button>
            </div>
          ) : (
            <div className="mobile-auth-buttons">
              <Link to="/login" className="mobile-auth-btn login" onClick={handleMobileNavClick}>Login</Link>
              <Link to="/signup" className="mobile-auth-btn signup" onClick={handleMobileNavClick}>Sign Up</Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default NavBar; 