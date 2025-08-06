export const initFacebookSDK = () => {
  return new Promise((resolve, reject) => {
    // Load the SDK asynchronously
    (function (d, s, id) {
      var js,
        fjs = d.getElementsByTagName(s)[0];
      if (d.getElementById(id)) return;
      js = d.createElement(s);
      js.id = id;
      js.src = "https://connect.facebook.net/en_US/sdk.js";
      fjs.parentNode.insertBefore(js, fjs);
    })(document, "script", "facebook-jssdk");

    window.fbAsyncInit = function () {
      FB.init({
        appId: import.meta.env.VITE_FACEBOOK_APP_ID,
        cookie: true,
        xfbml: true,
        version: "v18.0",
      });

      // Check login status if we're on HTTPS or localhost
      if (
        window.location.protocol === "https:" ||
        window.location.hostname === "localhost"
      ) {
        FB.getLoginStatus(function (response) {
          console.log("FB Login Status:", response.status);
          resolve(response);
        });
      } else {
        console.log(
          "Facebook SDK initialized without login status check (non-HTTPS environment)"
        );
        resolve(null);
      }
    };
  });
};

export const handleFacebookLoginStatus = async (response) => {
  const { status, authResponse } = response;

  if (!authResponse) {
    console.log("No auth response received from Facebook");
    return;
  }

  switch (status) {
    case "connected":
      // User is logged into Facebook and has authorized your app
      try {
        // Send the access token to your backend using the current domain
        console.log(
          "Sending FB access token to backend:",
          authResponse.accessToken
        );
        const currentDomain = window.location.origin;
        const result = await fetch(
          `${currentDomain}/api/auth/facebook?access_token=${authResponse.accessToken}`,
          {
            method: "GET",
            credentials: "include",
            headers: {
              Accept: "application/json",
            },
          }
        );

        if (result.ok) {
          const data = await result.json();
          // Store the JWT token from your backend
          localStorage.setItem("token", data.token);

          // Also store user data if available
          if (data.user) {
            localStorage.setItem("user", JSON.stringify(data.user));
          }

          // Redirect to home or dashboard if not already there
          if (
            window.location.pathname === "/login" ||
            window.location.pathname === "/signup"
          ) {
            window.location.href = "/";
          } else {
            // Force a page refresh to update the auth state
            window.location.reload();
          }
        } else {
          console.error("Backend returned error:", await result.text());
        }
      } catch (error) {
        console.error("Error authenticating with backend:", error);
      }
      break;

    case "not_authorized":
      // User is logged into Facebook but hasn't authorized your app
      console.log("Please authorize the application");
      break;

    default: // 'unknown'
      // User isn't logged into Facebook
      console.log("Please log into Facebook");
      break;
  }
};

export const initiateFacebookLogin = () => {
  return new Promise((resolve, reject) => {
    if (!window.FB) {
      reject(new Error("Facebook SDK not loaded"));
      return;
    }

    window.FB.login(
      (response) => {
        console.log("Facebook login response:", response);
        handleFacebookLoginStatus(response);
        resolve(response);
      },
      {
        scope: "email,public_profile",
        return_scopes: true,
      }
    );
  });
};
