import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useCartData } from '../../hooks/useCart';
import { useAuth } from '../../context/AuthContext';
import './Checkout.css';
import API_BASE_URL from '../../config';
import NavBar from '../NavBar';
import Footer from '../Footer';
import { notify } from '../../utils/notifications';
import { authService } from '../../services/api';
import ninjaVanService from '../../services/ninjaVanService';
import LegalModal from '../common/LegalModal';
import { getAuthToken } from '../../utils/cookies';
import api from '../../services/axiosConfig';

const Checkout = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [shippingDetails, setShippingDetails] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    postal_code: '',
    phone: '',
    region: '',
    barangay: '',
  });
  const [profileLoading, setProfileLoading] = useState(false);
  const [hasShippingAddress, setHasShippingAddress] = useState(false);
  
  // Address serviceability state
  const [isAddressServiceable, setIsAddressServiceable] = useState(null);
  const [serviceabilityChecking, setServiceabilityChecking] = useState(false);
  const [serviceabilityMessage, setServiceabilityMessage] = useState('');
  
  // Shipping fee calculation state
  const [shippingFee, setShippingFee] = useState(0);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState(null);
  
  // Legal terms state
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalModal, setLegalModal] = useState({ isOpen: false, type: 'terms' });
  
  const [paymentUrl, setPaymentUrl] = useState(null);
  const [showManualRedirect, setShowManualRedirect] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('dragonpay');
  
  // Promotion state
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherDiscount, setVoucherDiscount] = useState(0);
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherError, setVoucherError] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState(null);
  
  const navigate = useNavigate();
  const { user } = useAuth();
  const { 
    cartItems, 
    getTotalPrice,
    getSelectedCount,
    updateQuantity
  } = useCartData();

  const selectedItems = cartItems.filter(item => item.selected);


  // Helper function to get the effective price (discounted if available)
  const getEffectivePrice = (item) => {
    // Use discounted price if it exists and is greater than 0, otherwise use original price
    return (item.discounted_price && item.discounted_price > 0) 
      ? parseFloat(item.discounted_price) 
      : parseFloat(item.price);
  };

  // Create order function
  const createOrder = async (userId, shippingFee = 0, shippingDetails = {}, paymentMethod = 'dragonpay', voucherCode = null) => {
    try {
      // Validate inputs
      if (selectedItems.length === 0) {
        throw new Error('No items selected for order');
      }

      if (!shippingDetails.address || !shippingDetails.phone) {
        throw new Error('Shipping address and phone number are required');
      }

      // Transform cart items for the backend
      const orderItems = selectedItems.map(item => ({
        product_id: item.id || item.product_id,
        variant_id: item.variant_id || null,
        quantity: item.quantity,
        // Use discounted price if available, otherwise use original price
        price: getEffectivePrice(item),
        variant_attributes: item.variant_attributes || {}
      }));

      const subtotal = getTotalPrice();
      const totalAmount = subtotal + shippingFee;

      const orderData = {
        user_id: userId,
        items: orderItems,
        subtotal: subtotal,
        shipping_fee: shippingFee,
        total_amount: totalAmount,
        shipping_details: shippingDetails,
        payment_method: paymentMethod,
        voucher_code: voucherCode
      };

      const token = getAuthToken();
      if (!token) {
        throw new Error('Please log in to place an order');
      }

      console.log('[Checkout] Creating order with data:', orderData);

      const response = await api.post('/transactions/orders', orderData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('[Checkout] Order created successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('[Checkout] Error creating order:', error);
      
      if (error.response) {
        const errorMessage = error.response.data?.message || error.message;
        
        if (errorMessage.includes('stock')) {
          throw new Error('Some items in your cart are no longer available in the requested quantity. Please update your cart.');
        } else if (errorMessage.includes('phone')) {
          throw new Error('Please provide a valid phone number (e.g., +63 912 345 6789 or 09123456789)');
        } else if (errorMessage.includes('shipping details')) {
          throw new Error('Please provide complete shipping details including address and contact information');
        } else {
          throw new Error(errorMessage);
        }
      } else if (error.request) {
        throw new Error('Unable to connect to the server. Please check your internet connection and try again.');
      } else {
        throw new Error('An error occurred while creating your order. Please try again.');
      }
    }
  };

  // Process payment function
  const processPayment = async (orderId, userEmail, paymentMethod = 'dragonpay') => {
    try {
      const token = getAuthToken();
      if (!token) {
        throw new Error('No authentication token found');
      }

      const paymentData = {
        order_id: orderId,
        payment_method: paymentMethod,
        payment_details: {
          email: userEmail
        }
      };

      console.log('[Checkout] Processing payment with data:', paymentData);

      const response = await api.post('/transactions/payment', paymentData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log('[Checkout] Payment processed successfully:', response.data);
      return response.data;
    } catch (error) {
      console.error('[Checkout] Error processing payment:', error);
      throw error;
    }
  };

  // Check address serviceability with NinjaVan shipping locations
  const checkAddressServiceability = async (addressDetails) => {
    if (!addressDetails.region || !addressDetails.state || !addressDetails.city) {
      console.log('Address incomplete for serviceability check:', addressDetails);
      setServiceabilityChecking(false);
      return;
    }

    setServiceabilityChecking(true);
    setServiceabilityMessage('');

    try {
      console.log('Checking address serviceability:', addressDetails);
      
      const addressData = {
        region: addressDetails.region,
        province: addressDetails.state, // state is province in our context
        city: addressDetails.city,
        barangay: addressDetails.barangay || '',
      };

      const validationResult = await authService.validateAddress(addressData);
      
      if (validationResult.data) {
        const { serviceable, message } = validationResult.data;
        setIsAddressServiceable(serviceable);
        setServiceabilityMessage(serviceable ? 
          '✅ This address is serviceable for delivery' : 
          '❌ This address is not serviceable. Orders cannot proceed to this location.'
        );
        console.log('Address serviceability result:', { serviceable, message });
      }
    } catch (error) {
      console.error('Error checking address serviceability:', error);
      setIsAddressServiceable(false);
      setServiceabilityMessage('❌ Unable to verify address serviceability. Please contact support.');
    } finally {
      setServiceabilityChecking(false);
    }
  };

  // Calculate shipping fee based on address and items
  const calculateShippingFee = async (address) => {
    if (!address || !address.city || !address.state || !address.postal_code) {
      console.log('Address incomplete for shipping calculation:', address);
      return;
    }

    setShippingLoading(true);
    setShippingError(null);

    try {
      console.log('Calculating shipping fee for address:', address);
      
      // Calculate total weight based on items (assuming 0.5kg per item)
      const totalWeight = selectedItems.reduce((total, item) => {
        return total + (item.quantity * 0.5);
      }, 0);

      // Prepare address data for NinjaVan
      const addressData = {
        address: {
          address1: address.address,
          city: address.city,
          state: address.state,
          postcode: address.postal_code,
          country: 'PH' // Default to Philippines
        },
        weight: Math.max(totalWeight, 1.0), // Minimum 1kg
        dimensions: {
          length: 20,
          width: 15,
          height: 10
        }
      };

      const shippingEstimate = await ninjaVanService.getShippingEstimate(addressData);
      
      if (shippingEstimate.success) {
        setShippingFee(shippingEstimate.estimatedFee);
        console.log('Shipping fee calculated:', shippingEstimate.estimatedFee);
      } else {
        // Handle authentication errors
        if (shippingEstimate.error?.includes('Authentication required')) {
          notify.error('Your session has expired. Please log in again.');
          navigate('/login');
          return;
        }
        
        console.warn('Using fallback shipping rate:', shippingEstimate.error);
        setShippingFee(250.00); // Fallback fee for Philippines
        setShippingError('Using standard shipping rate for your location');
      }
    } catch (error) {
      console.error('Error calculating shipping fee:', error);
      setShippingFee(250.00); // Fallback fee for Philippines
      setShippingError('Unable to calculate exact shipping. Using standard rate.');
    } finally {
      setShippingLoading(false);
    }
  };

  const getFullImageUrl = (url) => {
    if (!url) return '/ImageFallBack.png';
    
    // Type check to prevent errors
    if (typeof url !== 'string') {
      console.warn('URL is not a string:', url);
      return '/ImageFallBack.png';
    }
    
    // Handle base64 encoded images (longblob from database)
    if (url.startsWith('data:')) {
      return url; // Already a full data URL
    }
    
    // Handle absolute URLs
    if (url.startsWith('http')) {
      return url;
    }
    
    // Handle uploads paths
    if (url.startsWith('/uploads/')) {
      return `${API_BASE_URL}${url}`;
    }
    
    // Handle other relative paths
    if (url.startsWith('/')) {
      return `${API_BASE_URL}${url}`;
    }
    
    // Any other format
    return `${API_BASE_URL}/uploads/${url}`;
  };

  useEffect(() => {
    // Redirect to cart if no items are selected
    if (selectedItems.length === 0) {
      navigate('/cart');
      return;
    }

    // Fetch user profile data including shipping details
    const fetchUserProfile = async () => {
      if (!user) return;
      
      try {
        setProfileLoading(true);
        const response = await authService.getProfile();
        const profileData = response.data;
        
        console.log('Profile data received:', profileData);
        
        // Format the address from shipping_details
        let formattedAddress = '';
        let hasAddress = false;
        let phoneNumber = '';
        
        // First try to get shipping addresses from the dedicated endpoint
        try {
          const shippingResponse = await authService.getShippingAddresses();
          console.log("Shipping addresses received:", shippingResponse.data);
          
          const addresses = shippingResponse.data;
          if (addresses && addresses.length > 0) {
            const defaultAddress = addresses.find(addr => addr.is_default) || addresses[0];
            console.log("Using default address from shipping addresses:", defaultAddress);
            
            hasAddress = true;
            phoneNumber = defaultAddress.phone || profileData.phone || '';
            
            const streetAddressParts = [
              defaultAddress.house_number,
              defaultAddress.building,
              defaultAddress.street_name
            ].filter(Boolean);

            let streetAddress = streetAddressParts.join(', ');
            if (!streetAddress && defaultAddress.address1) {
              streetAddress = defaultAddress.address1;
            }
            if (defaultAddress.address2) {
              streetAddress += `, ${defaultAddress.address2}`;
            }

            const shippingDetailsPayload = {
              name: `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
              phone: phoneNumber,
              email: profileData.email || '',
              address: streetAddress,
              barangay: defaultAddress.barangay || '',
              city: defaultAddress.city_municipality || defaultAddress.city || '',
              state: defaultAddress.province || defaultAddress.state || '',
              region: defaultAddress.region || '',
              postal_code: defaultAddress.postcode || '',
            };
            
            setShippingDetails(shippingDetailsPayload);
            
            // Check address serviceability
            checkAddressServiceability(shippingDetailsPayload);
            calculateShippingFee(shippingDetailsPayload);
          }
        } catch (addressError) {
          console.error("Error fetching shipping addresses:", addressError);
          // Continue with profile data if shipping addresses fetch fails
        }
        
        // Fall back to profile shipping_details if no shipping addresses found
        if (!hasAddress && profileData.shipping_details) {
          const sd = profileData.shipping_details;
          hasAddress = true;
          phoneNumber = sd.phone || profileData.phone || '';
          
          // Build address components
          const addressParts = [];
          
          // Primary address (house number, building, street, barangay)
          const address1Parts = [];
          if (sd.house_number) address1Parts.push(sd.house_number);
          if (sd.building) address1Parts.push(sd.building);
          if (sd.street_name) address1Parts.push(sd.street_name);
          
          if (address1Parts.length > 0) {
            addressParts.push(address1Parts.join(', '));
          } else if (sd.address1) {
            addressParts.push(sd.address1);
          }
          
          // Secondary address parts
          if (sd.address2) addressParts.push(sd.address2);
          
          formattedAddress = addressParts.join(', ');
          
          // Only set shipping details if we haven't already set them from shipping addresses
          if (!shippingDetails.address) {
            const fallbackDetails = {
              name: `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
              phone: phoneNumber,
              email: profileData.email || '',
              address: formattedAddress,
              barangay: sd.barangay || '',
              city: sd.city || '',
              state: sd.state || '',
              region: sd.region || '',
              postal_code: sd.postal_code || '',
            };
            setShippingDetails(fallbackDetails);
            
            // Check address serviceability
            checkAddressServiceability(fallbackDetails);
            calculateShippingFee(fallbackDetails);
          }
        } else if (!hasAddress && profileData.address) {
          // Fallback to user's main address field if available
          formattedAddress = profileData.address;
          hasAddress = !!formattedAddress;
          phoneNumber = profileData.phone || '';
          
          if (!shippingDetails.address) {
            setShippingDetails({
              name: `${profileData.firstName || ''} ${profileData.lastName || ''}`.trim(),
              phone: phoneNumber,
              email: profileData.email || '',
              address: formattedAddress,
              city: '',
              state: '',
              region: '',
              barangay: '',
              postal_code: '',
            });
            
            // Note: Cannot calculate shipping fee or check serviceability without complete address
            console.log('Cannot calculate shipping fee or check serviceability - missing address details');
          }
        }
        
        setHasShippingAddress(hasAddress);
      } catch (err) {
        console.error('Error fetching user profile:', err);
      } finally {
        setProfileLoading(false);
      }
    };

    fetchUserProfile();
  }, [user, navigate, selectedItems.length]);

  const handlePlaceOrder = async (e) => {
    e.preventDefault();

    // Validate shipping details
    if (!shippingDetails.name) {
      notify.error('Recipient name is required for checkout');
      return;
    }

    if (!shippingDetails.phone) {
      notify.error('Mobile number is required for checkout');
      return;
    }

    if (!shippingDetails.address) {
      notify.error('Delivery address is required for checkout');
      return;
    }

    // Check address serviceability before proceeding
    if (isAddressServiceable === false) {
      notify.error('Cannot proceed with checkout. The delivery address is not serviceable by our shipping partner.');
      return;
    }

    if (isAddressServiceable === null && !serviceabilityChecking) {
      notify.error('Please wait while we verify your delivery address serviceability.');
      return;
    }

    if (serviceabilityChecking) {
      notify.error('Please wait while we verify your delivery address.');
      return;
    }

    // Ensure we have a complete address with all components
    const completeAddress = getFormattedAddress();
    const updatedShippingDetails = {
      ...shippingDetails,
      address: completeAddress
    };

    setLoading(true);
    setError(null);
    
    try {
      console.log('[Checkout] Starting order process for user:', user.id);
      console.log('[Checkout] Selected items:', selectedItems.length);
      console.log('[Checkout] Shipping fee:', shippingFee);
      console.log('[Checkout] Shipping details:', updatedShippingDetails);
      console.log('[Checkout] Address serviceable:', isAddressServiceable);
      
      // Create the order with shipping fee, payment method, and promotion code
      const orderResult = await createOrder(
        user.id, 
        shippingFee, 
        updatedShippingDetails, 
        selectedPaymentMethod,
        voucherCode.trim() || null
      );
      console.log('[Checkout] Order created:', orderResult);
      
      if (!orderResult || !orderResult.order || !orderResult.order.order_id) {
        throw new Error('Failed to create order: Invalid response from server');
      }
      
      // Process payment based on selected method
      if (selectedPaymentMethod === 'cod') {
        // For COD orders, no payment processing is needed
        console.log('[Checkout] COD order created successfully');
        
        // Show success message and redirect to order confirmation
        notify.success('Order placed successfully! You will pay upon delivery.');
        navigate('/account', { 
          state: { 
            showOrderConfirmation: true, 
            orderId: orderResult.order.order_id 
          } 
        });
      } else {
        // Process payment with DragonPay (total includes shipping fee)
        const paymentResult = await processPayment(
          orderResult.order.order_id, 
          user.email || 'customer@example.com',
          selectedPaymentMethod
        );
        console.log('[Checkout] Payment processing result:', paymentResult);
        
        if (paymentResult.payment_url) {
          console.log('[Checkout] Redirecting to DragonPay:', paymentResult.payment_url);
          
          // Store the payment URL for manual redirect if needed
          setPaymentUrl(paymentResult.payment_url);
          sessionStorage.setItem('dragonpay_redirect_url', paymentResult.payment_url);
          
          // Try multiple redirect methods to ensure it works
          try {
            // Method 1: Direct window.location.href
            console.log('[Checkout] Attempting redirect method 1: window.location.href');
            window.location.href = paymentResult.payment_url;
            
            // Set a timeout to show manual redirect if automatic redirect fails
            setTimeout(() => {
              if (document.location.href !== paymentResult.payment_url) {
                console.log('[Checkout] Automatic redirect may have failed, showing manual redirect');
                setShowManualRedirect(true);
              }
            }, 3000);
            
          } catch (redirectError) {
            console.error('[Checkout] Redirect error:', redirectError);
            setShowManualRedirect(true);
            
            // Method 2: Try window.location.replace
            try {
              console.log('[Checkout] Attempting redirect method 2: window.location.replace');
              window.location.replace(paymentResult.payment_url);
            } catch (replaceError) {
              console.error('[Checkout] Replace error:', replaceError);
              
              // Method 3: Create a form and submit it (fallback)
              console.log('[Checkout] Attempting redirect method 3: form submission');
              const form = document.createElement('form');
              form.method = 'GET';
              form.action = paymentResult.payment_url;
              document.body.appendChild(form);
              form.submit();
            }
          }
        } else {
          throw new Error('No payment URL received from payment gateway');
        }
      }
      
    } catch (err) {
      console.error('[Checkout] Error during checkout:', err);
      
      // Handle specific error cases
      let errorMessage = err.message || 'An error occurred during checkout';
      
      if (errorMessage.includes('serviceable') || errorMessage.includes('shipping location')) {
        notify.error('Your delivery address is not serviceable. Please update your address or contact support.');
      } else if (errorMessage.includes('stock')) {
        notify.error('Some items in your cart are no longer available. Please review your cart.');
      } else if (errorMessage.includes('phone')) {
        notify.error('Please provide a valid phone number in the format: +63 912 345 6789 or 09123456789');
      } else if (errorMessage.includes('shipping')) {
        notify.error('Please complete all shipping details including address and contact information');
      } else if (errorMessage.includes('payment gateway') || errorMessage.includes('DragonPay')) {
        notify.error('There was an issue with the payment gateway. Please try again or choose a different payment method.');
      } else if (errorMessage.includes('internet') || errorMessage.includes('connect')) {
        notify.error('Unable to connect to the server. Please check your internet connection and try again.');
      } else if (errorMessage.includes('log in')) {
        notify.error('Please log in to complete your purchase');
        navigate('/auth/login', { state: { returnTo: '/checkout' } });
      } else {
        notify.error(errorMessage);
      }
      
      setError(errorMessage);
      setLoading(false);
      
      // Log detailed error for debugging
      console.error('[Checkout] Error details:', {
        message: err.message,
        stack: err.stack,
        response: err.response?.data
      });
    }
  };

  const handleBackToCart = () => {
    navigate('/cart');
  };
  
  const handleUpdateAddress = () => {
    navigate('/account');
  };

  const openLegalModal = (type) => {
    setLegalModal({ isOpen: true, type });
  };

  const closeLegalModal = () => {
    setLegalModal({ isOpen: false, type: 'terms' });
  };

  const formatPrice = (price) => {
    if (isNaN(price)) return '₱--.--';
    return '₱' + parseFloat(price).toFixed(2);
  };

  const handleError = (err) => {
    const errorMessage = err.message || 'An error occurred during checkout';
    setError(errorMessage);
    notify.error(errorMessage);
    
    // Log detailed error for debugging
    console.error('[Checkout] Error details:', {
      message: err.message,
      stack: err.stack,
      response: err.response?.data
    });
    
    // Handle specific error cases
    if (errorMessage.includes('DragonPay')) {
      notify.error('Payment gateway error. Please try again or contact support if the issue persists.');
    } else if (errorMessage.includes('shipping')) {
      notify.error('There was an issue with the shipping details. Please verify your address and try again.');
    } else if (errorMessage.includes('stock')) {
      notify.error('Some items in your cart are no longer available in the requested quantity.');
    } else {
      notify.error('There was an issue processing your order. Please try again or contact support.');
    }
  };

  // Promotion validation function
  const validateVoucher = async () => {
    if (!voucherCode.trim()) {
      setVoucherError('Please enter a promotion code');
      return;
    }

    setVoucherLoading(true);
    setVoucherError('');

    try {
      const token = getAuthToken();
      const response = await fetch(`${API_BASE_URL}/api/promotions/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          code: voucherCode.trim(),
          order_amount: getTotalPrice(),
          shipping_fee: shippingFee, // Include actual shipping fee
          items: cartItems.map(item => ({
            product_id: item.product_id,
            // Use discounted price if available, otherwise use original price
            price: getEffectivePrice(item),
            quantity: item.quantity
          }))
        })
      });

      const data = await response.json();

      if (response.ok && data.valid) {
        // Transform the new promotion response to match old voucher format
        const promotionAsVoucher = {
          code: data.promotion.code,
          name: data.promotion.name,
          description: data.promotion.description,
          discount_amount: data.discount.total_discount,
          type: data.promotion.type,
          // Additional promotion data
          product_discount: data.discount.product_discount,
          shipping_discount: data.discount.shipping_discount
        };
        
        setAppliedVoucher(promotionAsVoucher);
        setVoucherDiscount(data.discount.total_discount);
        
        // Show more detailed success message
        const shippingDiscount = parseFloat(data.discount.shipping_discount) || 0;
        const productDiscount = parseFloat(data.discount.product_discount) || 0;
        
        if (shippingDiscount > 0) {
          notify.success(`Promotion applied! Shipping discount: ₱${shippingDiscount.toFixed(2)}`);
        } else if (productDiscount > 0) {
          notify.success(`Promotion applied! Product discount: ₱${productDiscount.toFixed(2)}`);
        } else {
          notify.success('Promotion applied successfully!');
        }
      } else {
        setVoucherError(data.message || 'Invalid promotion code');
        setAppliedVoucher(null);
        setVoucherDiscount(0);
      }
    } catch (error) {
      console.error('Error validating promotion:', error);
      setVoucherError('Failed to validate promotion code. Please try again.');
      setAppliedVoucher(null);
      setVoucherDiscount(0);
    } finally {
      setVoucherLoading(false);
    }
  };

  const removeVoucher = () => {
    setVoucherCode('');
    setVoucherDiscount(0);
    setAppliedVoucher(null);
    setVoucherError('');
  };

  const getTotalWithVoucher = () => {
    const subtotal = getTotalPrice();
    const total = subtotal + shippingFee - voucherDiscount;
    return Math.max(0, total);
  };

  if (selectedItems.length === 0) {
    return null; // Will redirect in useEffect
  }

  // Format the complete address for display
  const getFormattedAddress = () => {
    const { address, barangay, city, state, postal_code } = shippingDetails;
    return [address, barangay, city, state, postal_code].filter(Boolean).join(', ');
  };

  // Handle quantity change for an item
  const handleQuantityChange = async (item, newQuantity) => {
    if (newQuantity < 1) return;
    
    try {
      console.log('[Checkout] Updating quantity for item:', item, 'new quantity:', newQuantity);
      
      await updateQuantity({
        productId: item.id || item.product_id,
        quantity: newQuantity,
        variantId: item.variant_id,
        cartId: item.cart_id
      });
      
      // The cart context will handle updating the state and recalculating totals
    } catch (error) {
      console.error('Failed to update quantity:', error);
      notify.error('Failed to update quantity. Please try again.');
    }
  };

  return (
    <div className="checkout-page">
      <NavBar />
      <section className="blog-hero" role="banner" tabIndex={0}>
        <div className="blog-hero-text">Checkout Page</div>
      </section>  
      <div className="checkout-container">  
        <div className="checkout-section">
          <h3>Shipping Details</h3>
          <div className="shipping-details">
            <div className="info-group">
              <label>Recipient</label>
              <input
                type="text"
                placeholder="Enter recipient name"
                className="info-value"
                value={shippingDetails.name}
                onChange={(e) =>
                  setShippingDetails((prev) => ({ ...prev, name: e.target.value }))
                }
              />
            </div>

            <div className="info-group">
              <label>Contact Number</label>
              <input
                type="text"
                placeholder="Enter mobile number"
                className="info-value"
                value={shippingDetails.phone}
                onChange={(e) =>
                  setShippingDetails((prev) => ({ ...prev, phone: e.target.value }))
                }
              />
            </div>


            
            <div className="info-group">
              <label>Delivery Address</label>
              <div className="info-value address-text">
                {getFormattedAddress()}
              </div>
              
              {/* Address Serviceability Status */}
              {hasShippingAddress && (
                <div className="address-serviceability">
                  {serviceabilityChecking ? (
                    <div className="serviceability-checking">

                      Verifying delivery serviceability...
                    </div>
                  ) : serviceabilityMessage && (
                    <div className={`serviceability-status ${isAddressServiceable ? 'serviceable' : 'not-serviceable'}`}>
                      {serviceabilityMessage}
                    </div>
                  )}
                </div>
              )}
              
              {!hasShippingAddress && !profileLoading && (
                <>
                  <div className="address-warning">
                    Please add a shipping address to continue with checkout
                  </div>
                  <button 
                    className="update-address-button primary" 
                    onClick={handleUpdateAddress}
                  >
                    Update Address
                  </button>
                </>
              )}
              {hasShippingAddress && (
                <button 
                  className="update-address-button" 
                  onClick={handleUpdateAddress}
                >
                  Change Address
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Order Items Section */}
        <div className="checkout-section">
          <h3>Order Summary</h3>
          <div className="checkout-items">
            {selectedItems.map((item, index) => (
              <div key={index} className="checkout-item">
                <img 
                  src={getFullImageUrl(item.image_url)} 
                  alt={item.name}
                  className="item-image"
                  onError={(e) => e.target.src = '/ImageFallBack.png'}
                />
                <div className="item-details">
                  <div className="item-name">{item.name}</div>
                  {item.variant_attributes && (
                    <div className="item-variant">
                      {Object.entries(item.variant_attributes)
                        .map(([key, value]) => `${key}: ${value}`)
                        .join(', ')}
                    </div>
                  )}
                  <div className="item-quantity-controls">
                    <label>Quantity:</label>
                    <div className="quantity-control">
                      <button 
                        className="quantity-btn decrement" 
                        onClick={() => handleQuantityChange(item, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                      >
                        <i className="fas fa-minus"></i>
                      </button>
                      <span className="quantity-display">{item.quantity}</span>
                      <button 
                        className="quantity-btn increment"
                        onClick={() => handleQuantityChange(item, item.quantity + 1)}
                        disabled={item.quantity >= (item.stock || 999)}
                      >
                        <i className="fas fa-plus"></i>
                      </button>
                    </div>
                  </div>
                  <div className="item-price">{formatPrice(getEffectivePrice(item) * item.quantity)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Payment Method Section */}
        <div className="checkout-section">
          <h3>Payment Method</h3>
          <div className="payment-methods">
            <div className="payment-method">
              <input 
                type="radio" 
                id="dragonpay" 
                name="payment-method" 
                value="dragonpay"
                checked={selectedPaymentMethod === 'dragonpay'}
                onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              />
              <label htmlFor="dragonpay">
                <span className="payment-label">DragonPay</span>
                <span className="payment-description">Pay securely via DragonPay's payment channels</span>
              </label>
            </div>
            
            <div className="payment-method">
              <input 
                type="radio" 
                id="cod" 
                name="payment-method" 
                value="cod"
                checked={selectedPaymentMethod === 'cod'}
                onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              />
              <label htmlFor="cod">
                <span className="payment-label">Cash on Delivery (COD)</span>
                <span className="payment-description">Pay with cash when your order is delivered</span>
              </label>
            </div>
            {selectedPaymentMethod === 'cod' && (
              <div className="cod-notice">
                <p><strong>Note:</strong> For COD orders, you will pay the full amount in cash when your order is delivered. Please have the exact amount ready.</p>
              </div>
            )}
          </div>
        </div>

        {/* Promotion Section */}
        <div className="checkout-section">
          <h3>Promotion Code</h3>
          <div className="voucher-section">
            {!appliedVoucher ? (
              <div className="voucher-input-group">
                <input
                  type="text"
                  placeholder="Enter promotion code"
                  value={voucherCode}
                  onChange={(e) => setVoucherCode(e.target.value.toUpperCase())}
                  className="voucher-input"
                  disabled={voucherLoading}
                />
                <button
                  type="button"
                  onClick={validateVoucher}
                  className="apply-voucher-btn"
                  disabled={voucherLoading || !voucherCode.trim()}
                >
                  {voucherLoading ? 'Validating...' : 'Apply'}
                </button>
              </div>
            ) : (
              <div className="applied-voucher">
                <div className="voucher-info">
                  {appliedVoucher.image_url && (
                    <img 
                      src={getFullImageUrl(appliedVoucher.image_url)} 
                      alt={appliedVoucher.name}
                      className="applied-voucher-image"
                    />
                  )}
                  <div className="voucher-details">
                    <span className="voucher-code">{appliedVoucher.code}</span>
                    <span className="voucher-name">{appliedVoucher.name}</span>
                    <span className="voucher-discount">
                      -{formatPrice(appliedVoucher.discount_amount)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeVoucher}
                  className="remove-voucher-btn"
                >
                  Remove
                </button>
              </div>
            )}
            {voucherError && (
              <div className="voucher-error">{voucherError}</div>
            )}
          </div>
        </div>

        {/* Order Total Section */}
        <div className="checkout-section">
          <div className="order-summary">
            <div className="summary-row">
              <span>Subtotal</span>
              <span>{formatPrice(getTotalPrice())}</span>
            </div>
            <div className="summary-row">
              <span>Shipping Fee</span>
              <div className="shipping-fee-section">
                {shippingLoading ? (
                  <span className="shipping-loading">Calculating...</span>
                ) : (
                  <span>{formatPrice(shippingFee)}</span>
                )}
              </div>
            </div>
            {voucherDiscount > 0 && (
              <div className="summary-row voucher-discount">
                <span>Voucher Discount</span>
                <span>-{formatPrice(voucherDiscount)}</span>
              </div>
            )}
            <div className="summary-row total">
              <span>Total</span>
              <span>{formatPrice(getTotalWithVoucher())}</span>
            </div>
          </div>
        </div>

        {/* Terms and Conditions Section */}
        <div className="checkout-section">
          <div className="terms-acceptance">
            <label className="terms-checkbox-label">
              <input 
                type="checkbox" 
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="terms-checkbox"
              />
              <span className="checkmark"></span>
              <span className="terms-text">
                By checking this box, you confirm that you have read and agree to our{' '}
                <button 
                  type="button"
                  className="terms-link" 
                  onClick={() => openLegalModal('terms')}
                >
                  Terms and Conditions
                </button>
                {' '}and{' '}
                <button 
                  type="button"
                  className="terms-link" 
                  onClick={() => openLegalModal('refund')}
                >
                  Refund Policy
                </button>
              </span>
            </label>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="checkout-actions">
          <button 
            className="back-to-cart-button" 
            onClick={handleBackToCart}
            disabled={loading}
          >
            Back to Cart
          </button>
          <button 
            className="place-order-button" 
            onClick={handlePlaceOrder}
            disabled={loading || !hasShippingAddress || !termsAccepted || isAddressServiceable === false || serviceabilityChecking}
          >
            {loading ? 'Processing...' : selectedPaymentMethod === 'cod' ? 'Place COD Order' : 'Place Order'}
          </button>
        </div>
        
        {/* Manual Redirect Button */}
        {showManualRedirect && paymentUrl && (
          <div className="manual-redirect-section">
            <div className="redirect-warning">
              <p>Automatic redirect to DragonPay may have failed. Please click the button below to proceed to payment:</p>
              <button 
                className="manual-redirect-button"
                onClick={() => window.open(paymentUrl, '_self')}
              >
                Proceed to DragonPay Payment
              </button>
              <p className="redirect-note">
                If the button doesn't work, please copy and paste this URL into your browser:<br />
                <code className="payment-url">{paymentUrl}</code>
              </p>
            </div>
          </div>
        )}
        
        {!hasShippingAddress && !profileLoading && (
          <div className="address-warning">
            Please update your shipping address before placing an order.
          </div>
        )}
      </div>
      <Footer forceShow={false} />
      
      <LegalModal 
        isOpen={legalModal.isOpen} 
        onClose={closeLegalModal} 
        type={legalModal.type} 
      />
    </div>
  );
};

export default Checkout;