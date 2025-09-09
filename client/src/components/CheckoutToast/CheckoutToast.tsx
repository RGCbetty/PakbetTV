import React, { useEffect } from "react";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./toast.css";

export default function CheckoutToast() {
  useEffect(() => {
    // Function to show a random checkout toast
    const showRandomToast = () => {
      const messages = [
        "🎉 Someone just checked out! Hurry before it sells out!",
        "🛒 A shopper just placed an order!",
        "🔥 Limited stock left! Don't miss out!",
        "💳 Someone purchased their cart just now!",
      ];

      const randomMsg = messages[Math.floor(Math.random() * messages.length)];

      toast(randomMsg, {
        position: "top-right", // 👈 upper right
        autoClose: 4000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        className: "homepage-toast", // 👈 match CSS

        progressClassName: "custom-progress",
        draggable: true,
        theme: "dark",
        icon: false, // 👈 remove default blue info icon
      });
    };

    const timeout = setTimeout(() => {
      showRandomToast();
    }, 3000);

    // Then show randomly every 20–40 seconds
    const interval = setInterval(() => {
      showRandomToast();
    }, Math.floor(Math.random() * (25000 - 15000) + 15000));

    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, []);

  return <ToastContainer />;
}
