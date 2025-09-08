import { useEffect } from "react";
import Swal from "sweetalert2";
import withReactContent from "sweetalert2-react-content";
import "./consentStyle.css"; // import your custom CSS
import NewsletterPopup from "../Newsletter/Newsletter";

const MySwal = withReactContent(Swal);

export default function ConsentManager() {
  useEffect(() => {
       const cookieChoice = localStorage.getItem("cookieConsent");
    const notificationChoice = localStorage.getItem("notificationConsent");
 const hasSubscribed = localStorage.getItem("newsletterSubscribed");

     if (!cookieChoice) {

    MySwal.fire({
        toast: true, // enables toast mode
      position: "bottom-end", // bottom right corner
      title: "We use cookies 🍪",
      html: `
        <p class="cookie-text">
          This website uses cookies to ensure you get the best experience on our site. 
          By continuing, you agree to our 
          <a href="/privacy-policy" class="cookie-link">
            Privacy Policy
          </a>.
        </p>
      `,
      background: "#1e1e2f",
      color: "#fff",
      showCancelButton: true,
      confirmButtonText: "Accept",
      cancelButtonText: "Decline",
      buttonsStyling: false, // important to use our own styles
      customClass: {
        popup: "cookie-popup",
        confirmButton: "cookie-accept",
        cancelButton: "cookie-decline",
      },
      allowOutsideClick: false,
    }).then((result) => {
       if (result.isConfirmed) {
        console.log("Cookies accepted ✅");
        localStorage.setItem("cookieConsent", "accepted");
       setTimeout(() => showNotificationConsent(notificationChoice, hasSubscribed), 1000);

      } else if (result.dismiss === Swal.DismissReason.cancel) {
        console.log("Cookies declined ❌");
        localStorage.setItem("cookieConsent", "declined");
      }
    });
  }else {
      // Skip cookies, check notification directly
        setTimeout(() => showNotificationConsent(notificationChoice, hasSubscribed), 2000);
    }
  }, []);
 const showNotificationConsent = (notificationChoice, hasSubscribed) => {
    if (!notificationChoice) {
      MySwal.fire({
        title: "Enable Notifications 🔔",
        html: `
          <p class="consent-text">
            Would you like to receive notifications for updates, offers, and Feng Shui tips? 
            You can change this later in your browser settings.
          </p>
        `,
        background: "#1e1e2f",
        color: "#fff",
        showCancelButton: true,
        confirmButtonText: "Allow",
        cancelButtonText: "Block",
        buttonsStyling: false,
        customClass: {
          popup: "consent-popup",
          confirmButton: "notify-allow",
          cancelButton: "notify-block",
        },
        allowOutsideClick: false,
      }).then((result) => {
         if (result.isConfirmed) {
        console.log("Notifications allowed ✅");
        localStorage.setItem("notificationConsent", "accepted");
        setTimeout(() => NewsletterPopup(hasSubscribed), 1000);
        if ("Notification" in window) {
          Notification.requestPermission().then((permission) => {
            console.log("Browser permission:", permission);
          });
        }
      } else if (result.dismiss === Swal.DismissReason.cancel) {
        console.log("Notifications blocked ❌");
        localStorage.setItem("notificationConsent", "declined");
      }
      });
    } else {
         setTimeout(() => NewsletterPopup(hasSubscribed), 2000);
    }
  };
  return null;
}



 