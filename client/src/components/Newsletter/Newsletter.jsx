import React from "react";
import Swal from "sweetalert2";
import "sweetalert2/dist/sweetalert2.min.css";
import API_BASE_URL from "../../config";

const NewsletterPopup = (hasSubscribed) => {
    if (hasSubscribed) return;

      Swal.fire({
        title: '<span style="color:#FFD700;">NEWSLETTER</span>',
        html: `
          <p style="font-size:16px; color:#fff;">
            Subscribe now to get <b>10% off</b> on your next 😊 purchase.
          </p>
          <p style="font-size:14px; color:#ddd;">
            Stay updated on Feng Shui tips, Zodiac insights, and exciting promotions.
          </p>
          <input id="emailInput" type="email" class="swal2-input" placeholder="Enter your email address">
        `,
        background: "#8B0000", // dark red
        color: "#fff",
        showCancelButton: true,
        confirmButtonText: "Subscribe",
        cancelButtonText: "Later",
        confirmButtonColor: "#FFD700", // gold
        focusConfirm: false,
        preConfirm: async () => {
          const email = document.getElementById("emailInput").value;
          if (!email) {
            Swal.showValidationMessage("Please enter your email address");
            return false;
          }
        try {
            const response = await fetch(`${API_BASE_URL}/api/subscribe`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const data = await response.json();

            localStorage.setItem("newsletterSubscribed", "accepted");
            if (!response.ok) throw new Error(data.message);
            return email;
          } catch (error) {
            Swal.showValidationMessage(error.message);
            return false;
          }
        },
      }).then((result) => {
        if (result.isConfirmed) {
          Swal.fire({
            icon: "success",
            title: "Subscribed!",
            text: `Thank you for subscribing with ${result.value}.`,
            confirmButtonColor: "#FFD700",
          });
        }
      });


  return null; // this component doesn’t render anything
};

export default NewsletterPopup;
